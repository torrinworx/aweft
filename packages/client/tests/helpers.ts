// What the suites share: a real server behind a listener that opens nothing. The socket and
// the tick loop come from the harness (design 254).

import { fromBundle } from '@aweftjs/modules';
import type { Factory, ModuleExports } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Listener, ListenerHandlers, Server } from '@aweftjs/server';
import type { SocketLike } from '@aweftjs/sync';
import { settle, socketPair } from '@aweftjs/testing';
import type { PairedSocket } from '@aweftjs/testing';

// The readyState values a WebSocket reports, named where they are read.
const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export { settle, socketPair };

/** Microtasks only, so a suite under mocked timers can still let the wiring catch up. */
export const spin = async (rounds = 20): Promise<void> => {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
};

export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

/** The moment the browser would fire `open`, after the far end has already spoken. */
export const opens = (socket: PairedSocket): void => {
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
	const server = createServer({ sources: [fromBundle(modules)], gate: open, listener });
	await server.start();
	return { server, handlers };
};

/**
 * The `open` a client is given: each call makes a connecting socket, runs the handshake, hands
 * the far end to the server, and only then fires the client's `open` event. That order is the
 * one this package exists to get right, so the harness reproduces it rather than smoothing it.
 */
export const dialer = (handlers: () => ListenerHandlers): { open(): SocketLike; sockets: PairedSocket[] } => {
	const sockets: PairedSocket[] = [];
	return {
		sockets,
		open: () => {
			const [near, far] = socketPair(CONNECTING);
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
