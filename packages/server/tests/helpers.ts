// What the suites share: a listener that hands its handlers to the test, sockets wired in
// memory so a whole connection runs with no port, and a loader over a bundle.

import { createLoader, fromBundle } from '@aweftjs/modules';
import type { Factory, Loader, ModuleExports } from '@aweftjs/modules';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests, SocketLike } from '@aweftjs/sync';

import type { Accept, Listener, ListenerHandlers, Peer } from '../src/index.ts';

export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export const settle = async (rounds = 10): Promise<void> => { for (let i = 0; i < rounds; i++) await tick(); };
export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

/** A socket shaped like a WebSocket, wired to a peer: what one sends, the other hears on a microtask. */
export interface Fake extends SocketLike {
	peer: Fake | undefined;
	readonly sent: (Uint8Array | string)[];
	fire(type: string, event: { data?: unknown }): void;
}

export const fake = (readyState = 1): Fake => {
	const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
	const it: Fake = {
		binaryType: 'blob',
		readyState,
		peer: undefined,
		sent: [],
		send: (data) => {
			it.sent.push(data);
			const peer = it.peer;
			if (peer !== undefined) queueMicrotask(() => peer.fire('message', { data }));
		},
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

export const socketPair = (): [Fake, Fake] => {
	const a = fake();
	const b = fake();
	a.peer = b;
	b.peer = a;
	return [a, b];
};

/** A listener that opens nothing and hands the server's handlers to the test instead. */
export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers; stopped(): number } => {
	let held: ListenerHandlers | undefined;
	let stops = 0;
	return {
		listener: {
			start: async (handlers) => { held = handlers; },
			stop: async () => { stops += 1; },
		},
		handlers: () => {
			if (held === undefined) throw new Error('the server has not started');
			return held;
		},
		stopped: () => stops,
	};
};

export const loaderOf = (map: Record<string, ModuleExports>): Loader =>
	createLoader({ sources: [fromBundle(map)] });

export const instance = (make: (props: Record<string, unknown>) => unknown, deps: string[] = []): ModuleExports =>
	({ deps, default: make as Factory });

export const request = (path = '/', init: RequestInit = {}): Request =>
	new Request(`http://app.test${path}`, init);

export const peer: Peer = { address: '127.0.0.1' };

/** A client end: the link and the requests over one socket, both through the public surface. */
export interface Client {
	readonly socket: Fake;
	readonly link: Link;
	readonly asks: Requests;
}

/** Open a connection through the server's handshake, over an in-memory pair. */
export const connectTo = async (
	handlers: ListenerHandlers, init: RequestInit = {}, from: Peer = peer,
): Promise<Client | Response> => {
	const answer = await handlers.socket(request('/ws', init), from);
	if (answer instanceof Response) return answer;
	const [near, far] = socketPair();
	(answer as Accept)(far);
	return { socket: near, link: connect(fromWebSocket(near)), asks: requests(near) };
};

export const asClient = (opened: Client | Response): Client => {
	if (opened instanceof Response) throw new Error(`the handshake was refused with ${opened.status}`);
	return opened;
};
