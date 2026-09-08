// What the suites share: sockets wired in memory so a whole connection runs with no port, and
// a real server behind a listener that opens nothing.

import { createLoader, fromBundle } from '@aweftjs/modules';
import type { Factory, ModuleExports } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Listener, ListenerHandlers, Server } from '@aweftjs/server';
import type { SocketLike } from '@aweftjs/sync';

export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export const settle = async (rounds = 10): Promise<void> => {
	for (let i = 0; i < rounds; i++) await tick();
};

/** Microtasks only, so a suite under mocked timers can still let the wiring catch up. */
export const spin = async (rounds = 20): Promise<void> => {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
};

export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

/** A socket shaped like a WebSocket, wired to a peer: what one sends, the other hears on a microtask. */
export interface Fake extends SocketLike {
	peer: Fake | undefined;
	readonly sent: (Uint8Array | string)[];
	fire(type: string, event: { data?: unknown }): void;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export const fake = (readyState = CONNECTING): Fake => {
	const listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};
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
			if (it.readyState === CLOSED) return;
			it.readyState = CLOSED;
			it.fire('close', {});
			const peer = it.peer;
			if (peer !== undefined) queueMicrotask(() => peer.close());
		},
		addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
		fire: (type, event) => { for (const fn of [...(listeners[type] ?? [])]) fn(event); },
	};
	return it;
};

/** The moment the browser would fire `open`, after the far end has already spoken. */
export const opens = (socket: Fake): void => {
	socket.readyState = OPEN;
	socket.fire('open', {});
};

/** A listener that opens nothing and hands the server's handlers to the test instead. */
export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers } => {
	let held: ListenerHandlers | undefined;
	return {
		listener: { start: async (handlers) => { held = handlers; }, stop: async () => {} },
		handlers: () => {
			if (held === undefined) throw new Error('the server has not started');
			return held;
		},
	};
};

export const instance = (make: () => unknown): ModuleExports => ({ default: make as Factory });

/** A started server over an in-memory listener, with the trusted gate. */
export const serverOf = async (modules: Record<string, ModuleExports>): Promise<{
	server: Server;
	handlers(): ListenerHandlers;
}> => {
	const { listener, handlers } = fakeListener();
	const loader = createLoader({ sources: [fromBundle(modules)] });
	await loader.load(Object.keys(modules));
	const server = createServer({ loader, gate: open, listener });
	await server.start();
	return { server, handlers };
};

/**
 * The `open` a client is given: each call makes a connecting socket, runs the handshake, hands
 * the far end to the server, and only then fires the client's `open` event. That order is the
 * one this package exists to get right, so the harness reproduces it rather than smoothing it.
 */
export const dialer = (handlers: () => ListenerHandlers): { open(): SocketLike; sockets: Fake[] } => {
	const sockets: Fake[] = [];
	return {
		sockets,
		open: () => {
			const near = fake();
			const far = fake(OPEN);
			near.peer = far;
			far.peer = near;
			sockets.push(near);
			void handlers().socket(new Request('http://app.test/ws'), { address: '127.0.0.1' })
				.then((answer) => {
					if (typeof answer !== 'function' || near.readyState === CLOSED) return;
					answer(far);
					opens(near);
				});
			return near;
		},
	};
};

/** A real wait, for the cases that are about the backoff actually elapsing. */
export const after = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A socket that never opens and never closes, for the cases that are only about waiting. */
export const idleSocket = (): SocketLike => ({
	binaryType: 'blob',
	readyState: CONNECTING,
	send: () => {},
	close: () => {},
	addEventListener: () => {},
});

/** Wait for something a real socket does on its own schedule, rather than guessing at a delay. */
export const until = async (ready: () => boolean, ms = 10_000): Promise<void> => {
	const stop = Date.now() + ms;
	while (!ready()) {
		if (Date.now() > stop) throw new Error(`the condition was still false after ${String(ms)} ms`);
		await after(5);
	}
};
