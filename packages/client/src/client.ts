// One connection to an aweft server, for the life of a page (design 183).
//
// The ordering is what this owns. A server speaks first: its hooks run at the handshake and
// its frames are on the wire before the browser fires `open`, so the link, the request
// channel and every share are attached the moment the socket is made and never after it
// opens. The other half is the drop: a new socket carries the same document objects and
// pulls the server's state onto them, so the page keeps everything it holds (design 184).

import { codecError } from '@aweftjs/codec';
import { type Derived, immutable, mutable } from '@aweftjs/core';
import {
	type AskOptions, type Link, type Requests, type ShareHandlers, type Shared, type SocketLike,
	connect, fromWebSocket, requests,
} from '@aweftjs/sync';

import { pageUrl } from './url.ts';
import { wake } from './wake.ts';

/** Where the connection is: `connecting` while a socket is coming up, `closed` between attempts. */
export type ClientStatus = 'connecting' | 'open' | 'closed';

/** What a client may be told about how it runs. Every field has a default. */
export interface ClientOptions {
	/** The server's address. Defaults to the page's own origin as a WebSocket address. */
	readonly url?: string | undefined;
	/** Makes the socket. Defaults to `new WebSocket(url)`; a Node program hands in one that carries a cookie header. */
	readonly open?: ((url: string) => SocketLike) | undefined;
	/** Come back on a drop. On by default; `false` leaves every attempt to `reconnect()`. */
	readonly reconnect?: boolean | undefined;
	/** The default `timeout` for every ask, in milliseconds. None ships, as `sync` ships none. */
	readonly timeout?: number | undefined;
}

/** One document shared over a client, across every socket the client opens. */
export interface Handle<T extends object> {
	/** The document, from its first arrival onward. The same object for the handle's whole life. */
	readonly document: T | undefined;
	/**
	 * The document once the server's state is in it.
	 *
	 * Rejects with `closed` when the client is closed before it arrives, and with the topic's
	 * fault (`root-mismatch`, `no-document`, `left`) when one ends it first. A drop is not a
	 * fault here: the reconnect answers it and this promise goes on waiting.
	 */
	readonly ready: Promise<T>;
	/**
	 * Stop sharing this document. It leaves the server's copy alone and takes the handle off
	 * the list re-shared on every later socket.
	 *
	 * Params: none.
	 *
	 * Returns: nothing. Calling it twice is not an error.
	 *
	 * Example:
	 *   const board = client.share<Board>('board');
	 *   board.stop();
	 */
	stop(): void;
}

/** One connection to a server. */
export interface Client {
	/** Where the connection is, as a read-only cell. Writing it throws `read-only`. */
	readonly status: Derived<ClientStatus>;
	/**
	 * Ask a server module for something that is not state.
	 *
	 * Params:
	 *   name: the module's name, as the server loaded it
	 *   args: plain data; what `JSON.stringify` cannot carry is refused as `not-data`
	 *   options.progress: hears each progress report before the result
	 *   options.timeout: milliseconds before rejecting with `timeout`, over the client's default
	 *
	 * Returns: the module's result. An ask made while no socket is open waits for the next one
	 * and goes out on it; one already in flight when the socket drops rejects with `closed`,
	 * because it may have had a side effect and is never sent twice.
	 *
	 * Rejects with the module's own `reason` and `reasons` for a refusal, with `timeout`, or
	 * with `closed` on a client that was closed.
	 *
	 * Example:
	 *   const report = await client.ask('notes/Export', { month: '2026-09' });
	 */
	ask(name: string, args?: unknown, options?: AskOptions): Promise<unknown>;
	/**
	 * Share a document with the server under a name.
	 *
	 * Params:
	 *   name: the topic name both ends know it by
	 *   document: this end's copy, when the page already holds one. Omitted, the server's is
	 *             minted here
	 *   handlers: `accept`, `refused` and `fault`, exactly as `sync` takes them. `fault` hears
	 *             every fault except the `closed` a dropped socket raises, which the reconnect
	 *             answers
	 *
	 * Returns: a handle. One per call, holding one document object for its whole life: every
	 * later socket re-shares that same object and pulls the server's state onto it, so watchers
	 * see a reconnect as ordinary commits.
	 *
	 * Example:
	 *   const board = await client.share<Board>('board').ready;
	 */
	share<T extends object>(name: string, document?: T, handlers?: ShareHandlers): Handle<T>;
	/**
	 * Drop the socket and open a new one now.
	 *
	 * Params: none.
	 *
	 * Returns: nothing. The backoff goes back to its first delay, and a client that was closed
	 * stays closed.
	 *
	 * Example:
	 *   await fetch('/api/session', { method: 'POST', body });
	 *   client.reconnect();
	 */
	reconnect(): void;
	/**
	 * End the connection for good.
	 *
	 * Params: none.
	 *
	 * Returns: nothing. Every held ask rejects `closed`, every live handle hears `closed`
	 * through its `fault`, the page listeners are dropped and nothing reconnects. Calling it
	 * twice is not an error.
	 *
	 * Example:
	 *   client.close();
	 */
	close(): void;
}

const FIRST_DELAY = 500;
const MAX_DELAY = 10_000;

const CLOSED_FIX = 'Make a new client with createClient; a closed one opens no socket.';
const TIMEOUT_FIX = 'Raise the timeout, or wait for status to read open before asking.';

const CLOSED_MESSAGE = 'the client closed';

const closed = (detail: string): Error => codecError('closed', detail, CLOSED_FIX);

const reasonOf = (error: unknown): unknown => (error as { reason?: unknown } | null)?.reason;

/** One socket's worth of connection: the socket, and the two channels riding it. */
interface Live {
	readonly socket: SocketLike;
	readonly link: Link;
	readonly asks: Requests;
	open: boolean;
}

/** An ask made while no socket was open, waiting for the next one. */
interface Waiting {
	readonly name: string;
	readonly args: unknown;
	readonly options: AskOptions;
	readonly settle: (value: unknown) => void;
	readonly fail: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | undefined;
}

/** One handle, as the client holds it between sockets. */
interface Sharing {
	readonly name: string;
	readonly handlers: ShareHandlers;
	document: object | undefined;
	shared: Shared<object> | undefined;
	settled: boolean;
	settle: ((document: object) => void) | undefined;
	fail: ((error: Error) => void) | undefined;
}

/**
 * Open one connection to an aweft server.
 *
 * Params:
 *   options.url: the server's address; the page's own origin by default
 *   options.open: makes the socket; `new WebSocket(url)` by default
 *   options.reconnect: come back on a drop, on by default
 *   options.timeout: the default timeout for every ask; none by default
 *
 * Returns: the client. The socket is made before this returns and the link and the request
 * channel are on it, so a share and an ask written on the next line reach the server.
 *
 * Throws: `no-url` when no `url` was given and there is no page origin to read one from.
 *
 * Example:
 *   const client = createClient({ url: 'wss://app.example/' });
 *   const board = await client.share<Board>('board').ready;
 *   const report = await client.ask('notes/Export', { month: '2026-09' });
 */
export const createClient = (options: ClientOptions = {}): Client => {
	const url = options.url ?? pageUrl();
	const make = options.open ?? ((at: string) => new WebSocket(at) as SocketLike);
	const retries = options.reconnect ?? true;
	const fallback = options.timeout;
	const state = mutable<ClientStatus>('connecting');

	const sharings = new Set<Sharing>();
	const waiting = new Set<Waiting>();

	let current: Live | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let delay = FIRST_DELAY;
	let stopped = false;

	const clearTimer = (): void => {
		if (timer === undefined) return;
		clearTimeout(timer);
		timer = undefined;
	};

	const shareOn = (live: Live, sharing: Sharing): void => {
		const handlers: ShareHandlers = {
			accept: sharing.handlers.accept,
			refused: sharing.handlers.refused,
			// A dead link faults every topic `closed`, and the answer to that is the next socket.
			// Every other fault is the page's to hear, a `root-mismatch` after a reconnect most
			// of all: the server now holds a different document under this name.
			fault: (reason, message) => {
				if (reason === 'closed') return;
				sharing.handlers.fault?.(reason, message);
			},
		};
		const shared = sharing.document === undefined
			? live.link.share<object>(sharing.name, undefined, handlers)
			: live.link.share<object>(sharing.name, sharing.document, handlers);
		sharing.shared = shared;
		// The link offers its state only when the other end asks for it, and an end holding a
		// document does not ask. This is the ask, and it is what moves the held object to the
		// server's state in place rather than swapping it (design 184).
		if (sharing.document !== undefined) shared.resync();

		shared.ready.then((document) => {
			sharing.document ??= document;
			if (sharing.settled) return;
			sharing.settled = true;
			sharing.settle?.(sharing.document);
		}, (error: Error) => {
			// The link rejects for every ending, a dropped socket included. That one is answered
			// by the reconnect, so the handle's own promise goes on waiting for it.
			if (sharing.settled || reasonOf(error) === 'closed') return;
			sharing.settled = true;
			sharing.fail?.(error);
		});
	};

	const drain = (live: Live): void => {
		for (const held of [...waiting]) {
			waiting.delete(held);
			clearTimeout(held.timer);
			live.asks.ask(held.name, held.args, held.options).then(held.settle, held.fail);
		}
	};

	const schedule = (): void => {
		timer = setTimeout(() => {
			timer = undefined;
			attempt(true);
		}, delay);
		delay = Math.min(delay * 2, MAX_DELAY);
	};

	const dropped = (): void => {
		current = undefined;
		state.set('closed');
		if (retries) schedule();
	};

	// `onATimer` says nobody is waiting on this call. A browser's `WebSocket` constructor refuses
	// with a throw rather than an `error` event, and from the retry timer or a wake trigger that
	// throw would reach the page as an uncaught error and end every later attempt. There it is a
	// drop like any other; from `createClient` and `reconnect()` it reaches the caller unchanged.
	const attempt = (onATimer = false): void => {
		clearTimer();
		let socket: SocketLike;
		try {
			socket = make(url);
		} catch (error) {
			if (!onATimer) throw error;
			dropped();
			return;
		}
		const live: Live = { socket, link: connect(fromWebSocket(socket)), asks: requests(socket), open: false };
		current = live;
		state.set('connecting');

		socket.addEventListener('open', () => {
			if (current !== live) return;
			live.open = true;
			delay = FIRST_DELAY;
			state.set('open');
			drain(live);
		});
		const lost = (): void => {
			if (current === live) dropped();
		};
		socket.addEventListener('close', lost);
		socket.addEventListener('error', lost);

		for (const sharing of [...sharings]) shareOn(live, sharing);
	};

	const attemptNow = (): void => {
		// Only worth doing while a retry is pending: online and visible say nothing about a
		// connection that is already up.
		if (timer === undefined) return;
		clearTimer();
		attempt(true);
	};

	const hold = (name: string, args: unknown, settings: AskOptions): Promise<unknown> =>
		new Promise((settle, fail) => {
			const held: Waiting = { name, args, options: settings, settle, fail, timer: undefined };
			const ms = settings.timeout;
			if (ms !== undefined) {
				held.timer = setTimeout(() => {
					waiting.delete(held);
					fail(codecError('timeout', `${name} waited ${String(ms)} ms and no socket opened`, TIMEOUT_FIX));
				}, ms);
			}
			waiting.add(held);
		});

	let release = retries ? wake(attemptNow) : undefined;
	attempt();

	return {
		status: immutable(state),

		ask: (name, args, options = {}) => {
			if (stopped) return Promise.reject(closed(`the client is closed and ${name} was not sent`));
			const settings: AskOptions = { ...options, timeout: options.timeout ?? fallback };
			const live = current;
			return live !== undefined && live.open
				? live.asks.ask(name, args, settings)
				: hold(name, args, settings);
		},

		share: <T extends object>(name: string, document?: T, handlers: ShareHandlers = {}) => {
			const sharing: Sharing = {
				name, handlers, document, shared: undefined, settled: false,
				settle: undefined, fail: undefined,
			};
			const ready = new Promise<object>((settle, fail) => {
				sharing.settle = settle;
				sharing.fail = fail;
			});
			// A page that never reads `ready` is not killed by a topic that ended before the
			// document arrived. Whoever does await it still gets the rejection.
			ready.catch(() => {});

			if (stopped) {
				sharing.settled = true;
				sharing.fail?.(closed(`the client is closed and ${name} was not shared`));
			} else {
				sharings.add(sharing);
				if (current !== undefined) shareOn(current, sharing);
			}

			return {
				get document() {
					return sharing.document as T | undefined;
				},
				ready: ready as Promise<T>,
				stop: () => {
					if (!sharings.delete(sharing)) return;
					sharing.shared?.stop();
				},
			};
		},

		reconnect: () => {
			if (stopped) return;
			clearTimer();
			delay = FIRST_DELAY;
			const live = current;
			current = undefined;
			live?.link.close();
			attempt();
		},

		close: () => {
			if (stopped) return;
			stopped = true;
			clearTimer();
			release?.();
			release = undefined;

			// The connection goes down before a line of page code runs. A `fault` handler that
			// throws used to abort this and leave the socket open, the status stale and every
			// later handle unaware, with `stopped` already true so a second `close()` fixed
			// nothing.
			const live = current;
			current = undefined;
			live?.link.close();
			state.set('closed');

			for (const held of [...waiting]) {
				waiting.delete(held);
				clearTimeout(held.timer);
				held.fail(closed(`the client closed and ${held.name} was not sent`));
			}
			for (const sharing of [...sharings]) {
				sharings.delete(sharing);
				if (!sharing.settled) {
					sharing.settled = true;
					sharing.fail?.(closed(`the client closed before ${sharing.name} arrived`));
				}
				try {
					sharing.handlers.fault?.('closed', CLOSED_MESSAGE);
				} catch (escaped) {
					// The page's own error, raised as its own the way a link raises a watcher's.
					queueMicrotask(() => { throw escaped; });
				}
			}
		},
	};
};
