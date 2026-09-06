// Requests beside a link: JSON text on the socket the link's binary frames ride (design 073).
//
// A link carries commits and nothing else. An application that needs to ask the other end
// for something that is not state has a second channel on the same socket, told apart by the
// WebSocket's own text-or-binary bit: the socket adapter ignores text, and this ignores
// bytes. Either end may ask and either may answer, so nothing here says which end is which.

import { codecError } from '@aweftjs/codec';

import type { SocketLike } from './channel.ts';
import type { WireReason } from './frame.ts';

export interface AskOptions {
	/** Hear the progress reports the answerer sends before its result. */
	readonly progress?: ((value: unknown) => void) | undefined;
	/** Reject with `timeout` after this many milliseconds with no answer. None ships. */
	readonly timeout?: number | undefined;
}

/**
 * What this end does with a request addressed to it. Return the result, which may be a
 * promise; throw to answer with an error, whose `reason` and `reasons` cross with it.
 */
export type Answerer = (name: string, args: unknown, progress: (value: unknown) => void) => unknown;

/** Requests over one socket, both directions. */
export interface Requests {
	/**
	 * Ask the other end for something.
	 *
	 * Params:
	 *   name: what is asked for, by the name the other end answers to
	 *   args: plain data; what `JSON.stringify` cannot carry is refused as `not-data`
	 *   options.progress: hears each progress report before the result
	 *   options.timeout: milliseconds before rejecting with `timeout`; none by default
	 *
	 * Returns: the result, as the other end returned it, with `undefined` read as `null`.
	 *
	 * Rejects with a `RequestError`: the other end's error with its `reason` and, for a
	 * refusal, its `reasons`; `timeout`; or `closed` when the socket ended first.
	 *
	 * Example:
	 *   const summary = await asks.ask('report/Daily', { day: 'mon' }, { progress: (p) => bar.set(p) });
	 */
	ask(name: string, args?: unknown, options?: AskOptions): Promise<unknown>;
	/**
	 * Answer the other end's requests. One answerer at a time; a second is refused with
	 * `answering`. Returns the function that stops answering.
	 */
	answer(fn: Answerer): () => void;
	/** Stop asking and answering. Every ask still waiting rejects with `closed`. The socket is left alone. */
	stop(): void;
}

/** What `ask` rejects with, and what an answerer's throw becomes at the other end. */
export interface RequestError extends Error {
	readonly reason: string;
	readonly reasons?: readonly WireReason[];
}

interface Waiting {
	settle(value: unknown): void;
	fail(error: RequestError): void;
	progress: ((value: unknown) => void) | undefined;
	timer: ReturnType<typeof setTimeout> | undefined;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

// One request channel per socket. Two would each number their own asks from 1 and each answer
// every request, so the second's asks would resolve with the first's answers.
const taken = new WeakSet<SocketLike>();

const requestError = (reason: string, detail: string, fix: string, reasons?: readonly WireReason[]): RequestError => {
	const error = codecError(reason, detail, fix);
	return reasons === undefined ? error : Object.assign(error, { reasons });
};

// What a caller can do about a failure the other end raised. The answerer's own remedy, when
// it had one, is already inside the message that crossed.
const REMOTE_FIX = 'Handle this reason where the ask was made, or fix the answerer that raised it.';

// The other end wrote its own message and it crosses whole, so it replaces the rendering here.
// Rendering it again would say the reason twice and push what the answerer said off the front.
const crossed = (reason: string, message: string, reasons?: readonly WireReason[]): RequestError =>
	Object.assign(requestError(reason, message, REMOTE_FIX, reasons), { message });

const isReason = (value: unknown): value is WireReason => {
	const held = value as { code?: unknown; message?: unknown } | null;
	return held !== null && typeof held === 'object' && typeof held.code === 'string' && typeof held.message === 'string';
};

/** The wire form of a thrown error: its reason token, its message, and any refusal reasons it carries. */
const errorFrame = (error: unknown): { reason: string; message: string; reasons?: WireReason[] } => {
	const held = error as { reason?: unknown; message?: unknown; reasons?: unknown } | null;
	const reason = typeof held?.reason === 'string' ? held.reason : 'failed';
	const message = held !== null && typeof held === 'object' ? String(held.message ?? error) : String(error);
	const reasons = Array.isArray(held?.reasons) ? held.reasons.filter(isReason) : undefined;
	return reasons === undefined || reasons.length === 0 ? { reason, message } : { reason, message, reasons };
};

/** The error an answer's `error` field becomes here. A malformed one is `failed` with what it said. */
const errorOf = (value: unknown): RequestError => {
	const held = value as { reason?: unknown; message?: unknown; reasons?: unknown } | null;
	if (held === null || typeof held !== 'object') return crossed('failed', String(value));
	const reason = typeof held.reason === 'string' ? held.reason : 'failed';
	const reasons = Array.isArray(held.reasons) ? held.reasons.filter(isReason) : undefined;
	return crossed(reason, String(held.message ?? reason), reasons?.length ? reasons : undefined);
};

/**
 * Requests over a socket, beside a link.
 *
 * Params:
 *   socket: the same socket `fromWebSocket` takes, open or still connecting. Text messages
 *     are this channel's; binary ones are the link's and are ignored here
 *
 * Returns: this end's `ask`, `answer` and `stop`.
 *
 * A request is one text message, `{ id, name, args }`; its answer is `{ id, result }`, each
 * progress report `{ id, progress }`, and a failure `{ id, error }`. A text message that is
 * not one of those closes the socket, as bytes that are not a frame end the link. A request
 * that arrives with no answerer registered is answered `missing`. One channel per socket: a
 * second `requests` on the same socket throws `duplicate` until the first has stopped.
 *
 * Throws: `duplicate` when this socket already has a request channel.
 *
 * Example:
 *   const asks = requests(socket);
 *   asks.answer((name, args, progress) => handle(name, args, progress));
 *   const result = await asks.ask('report/Daily', { day: 'mon' });
 */
export const requests = (socket: SocketLike): Requests => {
	if (taken.has(socket)) {
		throw requestError('duplicate', 'this socket already has a request channel; one requests() per socket, both directions',
			'Reuse the requests() this socket already has, or stop it first.');
	}
	taken.add(socket);
	const pending = new Map<number, Waiting>();
	let answerer: Answerer | undefined;
	let next = 1;
	let over = false;

	// Text handed over before the socket opened, sent in order once it does, for the same
	// reason the socket adapter holds frames: an ask made while connecting must not vanish.
	let held: string[] | undefined = socket.readyState === SOCKET_CONNECTING ? [] : undefined;
	socket.addEventListener('open', () => {
		const toSend = held ?? [];
		held = undefined;
		for (const text of toSend) socket.send(text);
	});

	const send = (frame: Record<string, unknown>): boolean => {
		if (over) return false;
		const text = JSON.stringify(frame);
		if (held !== undefined) {
			held.push(text);
			return true;
		}
		if (socket.readyState !== SOCKET_OPEN) return false;
		socket.send(text);
		return true;
	};

	const end = (): void => {
		if (over) return;
		over = true;
		taken.delete(socket);
		for (const [, waiting] of pending) {
			clearTimeout(waiting.timer);
			waiting.fail(requestError('closed', 'the socket closed before the answer arrived',
				'Reconnect and ask again; a socket that closed answers nothing.'));
		}
		pending.clear();
	};

	const settle = (id: number, waiting: Waiting): void => {
		pending.delete(id);
		clearTimeout(waiting.timer);
	};

	const take = (id: number, name: string, args: unknown): void => {
		let answered = false;
		const progress = (value: unknown): void => {
			if (!answered) send({ id, progress: value === undefined ? null : value });
		};
		const finish = (frame: Record<string, unknown>): void => {
			answered = true;
			send({ id, ...frame });
		};
		if (answerer === undefined) {
			finish({ error: { reason: 'missing', message: `nothing here answers ${name}` } });
			return;
		}
		Promise.resolve()
			.then(() => answerer!(name, args, progress))
			.then((result) => {
				// A result the wire cannot carry is the answerer's defect, and its caller has to
				// hear so rather than wait for an answer that was never sent.
				try {
					finish({ result: result === undefined ? null : result });
				} catch (error) {
					finish({ error: { reason: 'not-data', message: `${name}: the result could not be encoded: ${String((error as Error).message)}` } });
				}
			}, (error: unknown) => { finish({ error: errorFrame(error) }); });
	};

	const bad = (): void => {
		// A text message that is not a request frame is the one thing this channel cannot carry
		// on through, and the socket is shared with the link, so the whole socket ends.
		end();
		socket.close();
	};

	const onText = (text: string): void => {
		let frame: unknown;
		try {
			frame = JSON.parse(text);
		} catch {
			bad();
			return;
		}
		if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) { bad(); return; }
		const { id, name, args, result, progress, error } = frame as Record<string, unknown>;
		if (typeof id !== 'number' || !Number.isInteger(id)) { bad(); return; }

		if (typeof name === 'string') {
			take(id, name, args === undefined ? null : args);
			return;
		}
		// An answer nothing here is waiting for (one that timed out, or one after stop) is dropped.
		const waiting = pending.get(id);
		if ('result' in (frame as object)) {
			if (waiting === undefined) return;
			settle(id, waiting);
			waiting.settle(result);
		} else if ('progress' in (frame as object)) {
			waiting?.progress?.(progress);
		} else if ('error' in (frame as object)) {
			if (waiting === undefined) return;
			settle(id, waiting);
			waiting.fail(errorOf(error));
		} else {
			bad();
		}
	};

	socket.addEventListener('message', (event) => {
		if (over || typeof event.data !== 'string') return;
		onText(event.data);
	});
	socket.addEventListener('close', end);
	socket.addEventListener('error', end);

	return {
		ask: (name, args, options = {}) => new Promise((resolve, reject) => {
			if (over) {
				reject(requestError('closed', 'the socket has closed',
					'Open a new socket and make a fresh requests() on it.'));
				return;
			}
			const id = next;
			next += 1;
			const waiting: Waiting = { settle: resolve, fail: reject, progress: options.progress, timer: undefined };
			let sent: boolean;
			try {
				sent = send({ id, name, args: args === undefined ? null : args });
			} catch (error) {
				reject(requestError('not-data', `${name}: the arguments could not be encoded: ${String((error as Error).message)}`,
					'Send arguments JSON.stringify can carry.'));
				return;
			}
			if (!sent) {
				reject(requestError('closed', 'the socket is not open',
					'Wait until the socket opens, then ask again.'));
				return;
			}
			if (options.timeout !== undefined) {
				waiting.timer = setTimeout(() => {
					if (!pending.has(id)) return;
					pending.delete(id);
					reject(requestError('timeout', `${name} was not answered within ${options.timeout} ms`,
						'Raise the timeout, or check that the other end answers this name.'));
				}, options.timeout);
			}
			pending.set(id, waiting);
		}),
		answer: (fn) => {
			if (answerer !== undefined) throw requestError('answering', 'something already answers on this socket',
				'Stop the answerer already registered before adding another.');
			answerer = fn;
			return () => { if (answerer === fn) answerer = undefined; };
		},
		stop: end,
	};
};
