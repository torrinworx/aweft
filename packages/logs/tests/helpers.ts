// What the suites share: a store with the battery's paths, a module through the harness, a
// server with no port, and a connection over the harness socket (design 254).

import { auth, paths as authPaths } from '@aweftjs/auth';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleExports, Source } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Gate, Listener, ListenerHandlers, Peer, Server } from '@aweftjs/server';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests } from '@aweftjs/sync';
import { loadModule, settle, socketPair } from '@aweftjs/testing';
import type { PairedSocket } from '@aweftjs/testing';

import { logs, paths } from '../src/index.ts';
import type { Batch, Entry } from '../src/index.ts';

export { settle };
export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export const reasonOf = (error: unknown): string => {
	const held = error as { reason?: unknown; cause?: unknown } | null;
	// The module harness wraps a factory throw as `failed` with the original as its cause.
	if (typeof held?.reason === 'string' && held.reason !== 'failed') return held.reason;
	const cause = held?.cause as { reason?: unknown } | undefined;
	return String(cause?.reason ?? held?.reason);
};

export const newStore = (declare: Readonly<Record<string, readonly string[]>> = { ...authPaths, ...paths }): Store =>
	createStore({ driver: memoryDriver(), declare });

export const request = (path = '/', init: RequestInit = {}): Request => new Request(`http://app.test${path}`, init);
export const jsonRequest = (path: string, body: unknown, cookie?: string, method = 'POST'): Request =>
	request(path, {
		method, body: JSON.stringify(body),
		headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
	});

export const entry = (kind: string, fields: Record<string, unknown> = {}, at = Date.now()): Entry =>
	({ at, side: 'page', kind, ...fields } as Entry);
export const batch = (visit: string, entries: Entry[], more: Partial<Batch> = {}): Batch => ({ visit, entries, ...more });

/** One module of the battery, through the harness, with real or stubbed dependencies. */
export const module = async <T>(
	name: 'Visits' | 'Record' | 'Observe', store: Store, imports: Record<string, unknown> = {}, config: Record<string, unknown> = {},
): Promise<{ instance: T; stop(): Promise<void> }> => {
	const exports = await import(`../src/modules/${name}.ts`) as ModuleExports;
	const loaded = await loadModule({ exports, imports, config, props: { store } });
	return { instance: loaded.instance as T, stop: loaded.stop };
};

// --- a server with no port ------------------------------------------------------------------

export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers } => {
	let held: ListenerHandlers | undefined;
	return {
		listener: { start: async (handlers) => { held = handlers; }, stop: async () => {} },
		handlers: () => { if (held === undefined) throw new Error('not started'); return held; },
	};
};

export const peer: Peer = { address: '127.0.0.1' };

/** A server over the battery, the auth battery when asked, and the app modules given. */
export const started = async (
	app: Record<string, ModuleExports>, options: { store?: Store; gate?: Gate | string; withAuth?: boolean; config?: Record<string, ModuleExports>; failed?: string[] } = {},
): Promise<{ store: Store; server: Server; handlers: ListenerHandlers }> => {
	const store = options.store ?? newStore();
	const listening = fakeListener();
	const sources: Source[] = [fromBundle({ ...app, ...(options.config ?? {}) }), logs, ...(options.withAuth === true ? [auth] : [])];
	const server = createServer({
		sources, store, gate: options.gate ?? (options.withAuth === true ? 'auth/Gate' : open), listener: listening.listener,
		handlers: { failed: (name, error) => { options.failed?.push(`${name}: ${(error as Error).message}`); } },
	});
	await server.start();
	return { store, server, handlers: listening.handlers() };
};

export interface Client { readonly socket: PairedSocket; readonly link: Link; readonly asks: Requests }

export const connectTo = async (handlers: ListenerHandlers, cookie?: string): Promise<Client> => {
	const answer = await handlers.socket(request('/ws', cookie === undefined ? {} : { headers: { cookie } }), peer);
	if (answer instanceof Response) throw new Error(`the handshake was refused with ${String(answer.status)}`);
	const [near, far] = socketPair();
	answer(far);
	return { socket: near, link: connect(fromWebSocket(near)), asks: requests(near) };
};

/** Sign up over the route and answer the cookie a browser would hold. */
export const signUp = async (handlers: ListenerHandlers, email: string): Promise<{ user: string; cookie: string }> => {
	const answer = await handlers.request(jsonRequest('/api/session', { email, password: 'correct horse' }), peer);
	const { user } = await answer.json() as { user: string };
	return { user, cookie: answer.headers.getSetCookie()[0]!.split(';')[0]! };
};
