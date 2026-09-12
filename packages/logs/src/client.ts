// The browser half: what the page did, recorded from the page and sent as batches (design 261).
//
// Every import is a type or one of the values `core` and `codec` hand out, so a page bundle that
// reaches for it carries no server module and no store. The recorder never throws into the page,
// and it never depends on the socket it records: a batch goes over HTTP, and a page whose socket
// broke still has `fetch`.

import type { AskOptions, Client, Handle, ShareHandlers } from '@aweftjs/client';
import { createId, encodeCommit, idToText, slotKeyOf } from '@aweftjs/codec';
import { byId, observer, pathOf } from '@aweftjs/core';
import type { Derived } from '@aweftjs/core';

import { type Batch, type Entry, type Primitive, asText, entryOf } from './entries.ts';

export type { Batch, Entry, Primitive } from './entries.ts';

/** What `fetch` is given, stated here so this declaration names no DOM type. */
export interface FetchInit {
	method: string;
	headers: Record<string, string>;
	body: string;
	keepalive: true;
	credentials: 'same-origin';
}

/** The one HTTP call this half makes. The global `fetch` is one of these already. */
export type Fetcher = (url: string, init: FetchInit) => Promise<unknown>;

/** A listener target, as the window and the document both are. */
export interface Listening {
	addEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
	removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void;
}

/**
 * The window as this half reads it, so a test can hand in one of its own. Every field is
 * optional, and a missing one records nothing for that source.
 */
export interface WindowLike extends Listening {
	readonly document?: Listening | undefined;
	readonly location?: { readonly origin: string } | undefined;
	readonly navigator?: {
		readonly userAgent?: string;
		readonly userAgentData?: { readonly brands?: readonly { brand: string; version: string }[]; readonly platform?: string; readonly mobile?: boolean };
		readonly language?: string;
		readonly maxTouchPoints?: number;
		sendBeacon?(url: string, data: unknown): boolean;
	} | undefined;
	readonly screen?: { readonly width: number; readonly height: number } | undefined;
	readonly innerWidth?: number | undefined;
	readonly innerHeight?: number | undefined;
	readonly devicePixelRatio?: number | undefined;
	matchMedia?(query: string): { readonly matches: boolean };
	readonly console?: { error(...args: unknown[]): void; warn(...args: unknown[]): void } | undefined;
	readonly Blob?: (new (parts: string[], options: { type: string }) => unknown) | undefined;
}

export interface LogOptions {
	/** Where `POST /api/logs` is. Defaults to the page's own origin. */
	readonly origin?: string | undefined;
	/** The page's build, written once on the visit. */
	readonly build?: string | null | undefined;
	/** A router whose `url` to record on every change. */
	readonly router?: { readonly url: Derived<string> } | undefined;
	/** Makes the HTTP call. Defaults to the global `fetch`. */
	readonly fetch?: Fetcher | undefined;
	/** How often a batch goes, in milliseconds. 4000 by default. */
	readonly flushMs?: number | undefined;
	/** The window to listen on. The global one by default. */
	readonly window?: WindowLike | undefined;
}

/** A log over one page: the client that records, and the page's own entries. */
export interface Log {
	/** The recording client. Use it wherever the page used the one it was made from. */
	readonly client: Client;
	/** The visit's id, minted here and held in memory only. */
	readonly visit: string;
	/** The page's own record: `{ kind, ...fields }`. One with no `kind` is dropped. */
	write(entry: Readonly<Record<string, unknown>>): void;
	/** Hear every entry as it is recorded. Returns the unsubscribe. */
	each(fn: (entry: Entry) => void): () => void;
	/** Send what is queued now. Resolves once the call answered or failed; never rejects. */
	flush(): Promise<void>;
	/** Stop listening, put the console back, and send what is left. */
	stop(): void;
}

/**
 * The keys a `keydown` may record: the named ones, never a typed character. A character is one
 * code point, so `[...key]` counts code points rather than UTF-16 units, and an emoji or an
 * astral letter (two units, one code point) is a character too and is never recorded.
 */
const recordable = (key: unknown): key is string => typeof key === 'string' && [...key].length > 1;

const trimmed = (text: unknown, max = 40): string | undefined => {
	if (typeof text !== 'string') return undefined;
	const clean = text.replace(/\s+/g, ' ').trim();
	return clean === '' ? undefined : clean.slice(0, max);
};

/** An element as the page knows it, without any DOM type. */
interface ElementLike {
	readonly tagName?: string;
	readonly className?: unknown;
	readonly type?: string;
	readonly textContent?: string | null;
	readonly labels?: ArrayLike<{ readonly textContent: string | null }> | null;
	getAttribute?(name: string): string | null;
}

/** What identifies a control: the tag, its role, a label, its theme, and the field kind that hides a key. */
const describe = (target: unknown): Record<string, unknown> => {
	const element = target as ElementLike | null;
	if (element === null || typeof element !== 'object') return { tag: 'unknown' };
	const tag = String(element.tagName ?? 'unknown').toLowerCase();
	const type = typeof element.type === 'string' ? element.type.toLowerCase() : undefined;
	const field = type === 'password' || type === 'hidden' ? type : undefined;
	const label = trimmed(element.getAttribute?.('aria-label'))
		?? (tag === 'button' || tag === 'a' || tag === 'summary' ? trimmed(element.textContent) : undefined)
		?? trimmed(element.labels?.[0]?.textContent)
		?? trimmed(element.getAttribute?.('name'))
		?? trimmed(element.getAttribute?.('id'));
	const theme = typeof element.className === 'string' ? trimmed(element.className, 120) : undefined;
	return { tag, role: trimmed(element.getAttribute?.('role')), label, theme, field };
};

const messageOf = (args: readonly unknown[]): string => args.map(asText).join(' ').slice(0, 2000);

/**
 * Record a page over a connection it already has.
 *
 * Params:
 *   client: the page's client; the answer's `client` is the one to use from here on
 *   options: where the route is, the build, a router, and the seams a test hands in
 *
 * Returns: the log. Nothing is recorded before this is called, and `stop` ends it.
 *
 * Example:
 *   const log = createLog(createClient({ url }), { build, router });
 *   const identity = createAuth(log.client);
 *   log.client.share('board');
 */
export const createLog = (client: Client, options: LogOptions = {}): Log => {
	const win = options.window ?? (globalThis as unknown as WindowLike);
	const origin = options.origin ?? win.location?.origin ?? '';
	const send: Fetcher | undefined = options.fetch ?? (globalThis as { fetch?: Fetcher }).fetch;
	const flushMs = options.flushMs ?? 4000;
	const visit = idToText(createId());
	const url = `${origin}/api/logs`;

	const queue: Entry[] = [];
	const taps = new Set<(entry: Entry) => void>();
	let sentStart = false;
	let stopped = false;

	// Nothing here may throw into the page: a recorder that crashes what it records is worse
	// than none.
	const guarded = <A extends unknown[]>(fn: (...args: A) => void): ((...args: A) => void) => (...args) => {
		try {
			fn(...args);
		} catch {
			// dropped
		}
	};

	const record = guarded((fields: Readonly<Record<string, unknown>>): void => {
		if (stopped) return;
		const entry = entryOf(fields, 'page');
		if (entry === undefined) return;
		queue.push(entry);
		for (const tap of taps) {
			try {
				tap(entry);
			} catch {
				// a tap's throw is its own
			}
		}
	});

	const browser = (): Record<string, Primitive> | undefined => {
		const nav = win.navigator;
		if (nav === undefined) return undefined;
		const dark = win.matchMedia?.('(prefers-color-scheme: dark)').matches;
		const motion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		return {
			ua: nav.userAgent ?? null,
			brands: nav.userAgentData?.brands === undefined ? null : asText(nav.userAgentData.brands),
			platform: nav.userAgentData?.platform ?? null,
			mobile: nav.userAgentData?.mobile ?? null,
			width: win.innerWidth ?? null,
			height: win.innerHeight ?? null,
			screenWidth: win.screen?.width ?? null,
			screenHeight: win.screen?.height ?? null,
			dpr: win.devicePixelRatio ?? null,
			scheme: dark === undefined ? null : dark ? 'dark' : 'light',
			motion: motion === undefined ? null : motion ? 'reduce' : 'no-preference',
			language: nav.language ?? null,
			touch: nav.maxTouchPoints === undefined ? null : nav.maxTouchPoints > 0,
		};
	};

	/** The next batch: what is queued, and once, what is known per visit. */
	const batchOf = (ended: boolean): Batch | undefined => {
		if (queue.length === 0 && !ended) return undefined;
		const entries = queue.splice(0, 500);
		const first = !sentStart;
		sentStart = true;
		const facts = first ? browser() : undefined;
		return {
			visit, entries,
			...(first ? { build: options.build ?? null } : {}),
			...(facts === undefined ? {} : { browser: facts }),
			...(ended ? { ended } : {}),
		};
	};

	const flush = async (): Promise<void> => {
		const batch = batchOf(false);
		if (batch === undefined || send === undefined) return;
		try {
			await send(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch), keepalive: true, credentials: 'same-origin' });
		} catch {
			// A batch that could not go is dropped: keeping it would make a page that cannot
			// reach the server hold everything it did until it can.
		}
		if (queue.length > 0) await flush();
	};

	/** The leaving page's last batch, by the one delivery a browser makes for it. */
	const beacon = guarded((): void => {
		const batch = batchOf(true);
		if (batch === undefined) return;
		const body = JSON.stringify(batch);
		const nav = win.navigator;
		if (nav?.sendBeacon === undefined) { void send?.(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }); return; }
		nav.sendBeacon(url, win.Blob === undefined ? body : new win.Blob([body], { type: 'application/json' }));
	});

	// --- the sources -----------------------------------------------------------------------------

	const offs: (() => void)[] = [];
	const listen = (target: Listening | undefined, type: string, fn: (event: never) => void, options?: unknown): void => {
		if (target === undefined) return;
		target.addEventListener(type, fn, options);
		offs.push(() => { target.removeEventListener(type, fn, options); });
	};

	listen(win, 'error', (event: { message?: unknown; filename?: unknown; lineno?: unknown; error?: unknown }) => {
		const thrown = event.error as { stack?: unknown } | undefined;
		record({ kind: 'error', message: trimmed(event.message, 2000) ?? asText(event.error), stack: typeof thrown?.stack === 'string' ? thrown.stack : undefined, file: event.filename, line: event.lineno });
	});
	listen(win, 'unhandledrejection', (event: { reason?: unknown }) => {
		const reason = event.reason as { message?: unknown; stack?: unknown } | null;
		const message = reason !== null && typeof reason === 'object' && typeof reason.message === 'string' ? reason.message : asText(event.reason);
		record({ kind: 'rejection', message: message.slice(0, 2000), stack: typeof reason?.stack === 'string' ? reason.stack : undefined });
	});
	listen(win, 'pagehide', () => { beacon(); });
	listen(win.document, 'click', (event: { target?: unknown }) => { record({ kind: 'input', type: 'click', ...describe(event.target) }); }, true);
	listen(win.document, 'submit', (event: { target?: unknown }) => { record({ kind: 'input', type: 'submit', ...describe(event.target) }); }, true);
	listen(win.document, 'keydown', (event: { target?: unknown; key?: unknown }) => {
		const target = describe(event.target);
		// A character is never recorded, and a hidden or password field gives up no key at all.
		record({ kind: 'input', type: 'key', ...target, key: target.field === undefined && recordable(event.key) ? event.key : undefined });
	}, true);

	const console = win.console;
	if (console !== undefined) {
		const error = console.error;
		const warn = console.warn;
		console.error = (...args: unknown[]) => { record({ kind: 'console', level: 'error', message: messageOf(args) }); error.apply(console, args); };
		console.warn = (...args: unknown[]) => { record({ kind: 'console', level: 'warn', message: messageOf(args) }); warn.apply(console, args); };
		offs.push(() => { console.error = error; console.warn = warn; });
	}

	offs.push(client.status.effect((status) => {
		record({ kind: 'status', status });
		// Each socket is a new connection to the server, and the visit is told to it once, so
		// the server's own events for that connection land in this visit. Through the plain
		// client, so the telling is not itself an entry.
		if (status === 'open') void client.ask('logs/Visits', { visit }).catch(() => undefined);
	}));
	if (options.router !== undefined) offs.push(options.router.url.effect((now) => { record({ kind: 'url', url: now }); }));

	/** A commit's shape: the topic, the paths it touched, how many deltas, how many bytes. */
	const shapeOf = (topic: string, document: object, change: { readonly deltas: readonly { id: unknown; ref: unknown }[] }): Record<string, unknown> => {
		const paths = new Set<string>();
		for (const delta of change.deltas) {
			const holder = byId(document, delta.id as never);
			const above = holder === undefined ? undefined : pathOf(holder);
			paths.add([...(above ?? ['?']), slotKeyOf(delta.ref as never)].join('.'));
		}
		let bytes = -1;
		try {
			bytes = encodeCommit(change as never).byteLength;
		} catch {
			// a change that does not encode is still a change
		}
		return { kind: 'commit', topic, paths: [...paths].join(', '), deltas: change.deltas.length, bytes };
	};

	const recording: Client = {
		status: client.status,
		ask: async (name: string, args?: unknown, askOptions?: AskOptions) => {
			const at = Date.now();
			try {
				const result = await client.ask(name, args, askOptions);
				record({ kind: 'ask', name, ms: Date.now() - at, ok: true });
				return result;
			} catch (error) {
				record({ kind: 'ask', name, ms: Date.now() - at, ok: false, reason: (error as { reason?: unknown } | null)?.reason, message: (error as Error).message });
				throw error;
			}
		},
		share: <T extends object>(name: string, document?: T, handlers?: ShareHandlers): Handle<T> => {
			const handle = client.share<T>(name, document, {
				...handlers,
				refused: (report) => { record({ kind: 'refused', topic: name, reasons: (report as { reasons?: unknown }).reasons }); handlers?.refused?.(report); },
				fault: (reason, message) => { record({ kind: 'fault', topic: name, reason, message }); handlers?.fault?.(reason, message); },
			});
			let off: (() => void) | undefined;
			// Through the wildcard that honours the underscore rule: a private slot never reaches
			// this watcher, so the recorder holds no rule of its own (design 259).
			void handle.ready.then((doc) => {
				if (stopped) return;
				off = observer(doc).skip(Infinity).watch((change) => { record(shapeOf(name, doc, change)); });
				// So `log.stop()` drops this watcher too, not only the handle's own stop.
				offs.push(() => off?.());
			}, () => undefined);
			return {
				get document() { return handle.document; },
				ready: handle.ready,
				stop: () => { off?.(); handle.stop(); },
			};
		},
		reconnect: () => { client.reconnect(); },
		close: () => { client.close(); },
	};

	const tick = setInterval(() => { if (queue.length > 0) void flush(); }, flushMs);
	(tick as { unref?: () => void }).unref?.();

	return {
		client: recording,
		visit,
		write: (entry) => { record(entry); },
		each: (fn) => { taps.add(fn); return () => { taps.delete(fn); }; },
		flush,
		stop: () => {
			if (stopped) return;
			stopped = true;
			for (const off of offs.splice(0)) off();
			clearInterval(tick);
			void flush();
		},
	};
};
