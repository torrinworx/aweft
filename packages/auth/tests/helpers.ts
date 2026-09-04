// What the suites share: a store with the battery's paths, the modules through the harness,
// and a connection over an in-memory socket pair for the integration cases.

import { createLoader } from '@aweftjs/modules';
import type { Loader } from '@aweftjs/modules';
import type { Gate, Listener, ListenerHandlers, Peer } from '@aweftjs/server';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests, SocketLike } from '@aweftjs/sync';
import { loadModule } from '@aweftjs/testing';

import { auth, paths } from '../src/index.ts';

export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export const settle = async (rounds = 10): Promise<void> => { for (let i = 0; i < rounds; i++) await tick(); };
export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

export const newStore = (): Store => createStore({ driver: memoryDriver(), declare: paths });

export const request = (path = '/', init: RequestInit = {}): Request => new Request(`http://app.test${path}`, init);
export const withCookie = (path: string, cookie: string, init: RequestInit = {}): Request =>
	request(path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie } });
export const jsonRequest = (path: string, method: string, body: unknown, cookie?: string): Request =>
	request(path, {
		method, body: JSON.stringify(body),
		headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
	});

/** One module of the battery, through the harness, with real or stubbed dependencies. */
export const module = async <T>(
	name: 'Gate' | 'Session' | 'Enter' | 'Check' | 'State',
	store: Store,
	imports: Record<string, unknown> = {},
	config: Record<string, unknown> = {},
): Promise<{ instance: T; stop(): Promise<void> }> => {
	const exports = await import(`../src/modules/${name}.ts`);
	const loaded = await loadModule({ exports, imports, config, props: { store } });
	return { instance: loaded.instance as T, stop: loaded.stop };
};

/** The whole battery over a store, as an application loads it. */
export const battery = (store: Store, extra: Loader['load'] extends unknown ? Parameters<typeof createLoader>[0]['sources'] : never = []): Loader =>
	createLoader({ sources: [...extra, auth], props: { store } });

export const gateOf = async (loader: Loader): Promise<Gate> =>
	(await loader.load(['auth/Gate']))['auth/Gate'] as Gate;

// --- a connection with no port, for the integration cases -------------------------------------

interface Fake extends SocketLike {
	peer: Fake | undefined;
	fire(type: string, event: { data?: unknown }): void;
}

const fake = (): Fake => {
	const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
	const it: Fake = {
		binaryType: 'blob', readyState: 1, peer: undefined,
		send: (data) => { const peer = it.peer; if (peer !== undefined) queueMicrotask(() => peer.fire('message', { data })); },
		close: () => {
			if (it.readyState === 3) return;
			it.readyState = 3;
			it.fire('close', {});
			const peer = it.peer;
			if (peer !== undefined) queueMicrotask(() => peer.close());
		},
		addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
		fire: (type, event) => { for (const fn of listeners[type] ?? []) fn(event); },
	};
	return it;
};

export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers } => {
	let held: ListenerHandlers | undefined;
	return {
		listener: { start: async (handlers) => { held = handlers; }, stop: async () => {} },
		handlers: () => { if (held === undefined) throw new Error('not started'); return held; },
	};
};

export const peer: Peer = { address: '127.0.0.1' };

export interface Client { readonly socket: Fake; readonly link: Link; readonly asks: Requests; }

export const connectTo = async (handlers: ListenerHandlers, cookie?: string): Promise<Client | Response> => {
	const answer = await handlers.socket(cookie === undefined ? request('/ws') : withCookie('/ws', cookie), peer);
	if (answer instanceof Response) return answer;
	const near = fake();
	const far = fake();
	near.peer = far;
	far.peer = near;
	answer(far);
	return { socket: near, link: connect(fromWebSocket(near)), asks: requests(near) };
};

export const asClient = (opened: Client | Response): Client => {
	if (opened instanceof Response) throw new Error(`the handshake was refused with ${opened.status}`);
	return opened;
};
