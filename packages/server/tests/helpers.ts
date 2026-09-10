// What the suites share: a listener that hands its handlers to the test, and a source over a
// bundle. The socket and the tick loop come from the harness (design 254).

import { fromBundle } from '@aweftjs/modules';
import type { Factory, ModuleExports, ModuleProps, Source } from '@aweftjs/modules';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests } from '@aweftjs/sync';
import { settle, socketPair } from '@aweftjs/testing';
import type { PairedSocket } from '@aweftjs/testing';

import type { Accept, Listener, ListenerHandlers, Peer } from '../src/index.ts';

export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export { settle };
export const reasonOf = (error: unknown): string => String((error as { reason?: unknown } | null)?.reason);

/**
 * A listener that opens nothing and hands the server's handlers to the test instead. Pass a
 * trace and its stop writes `'listener'` into it, so a test that cares when the listener
 * stopped relative to the module stops can assert one ordered list rather than two counts.
 */
export const fakeListener = (trace: string[] = []): {
	listener: Listener; handlers(): ListenerHandlers; started(): number; stopped(): number;
} => {
	let held: ListenerHandlers | undefined;
	let starts = 0;
	let stops = 0;
	return {
		listener: {
			start: async (handlers) => { starts += 1; held = handlers; },
			stop: async () => { stops += 1; trace.push('listener'); },
		},
		handlers: () => {
			if (held === undefined) throw new Error('the server has not started');
			return held;
		},
		started: () => starts,
		stopped: () => stops,
	};
};

export const sourceOf = (map: Record<string, ModuleExports>): Source => fromBundle(map);

/**
 * A source that lists more later, so a test can hand the server a module after it started. A
 * directory somebody drops a file into is this, over a real disk.
 */
export const growing = (
	first: Record<string, ModuleExports>, later: Record<string, ModuleExports>,
): { source: Source; grow(): void } => {
	const listed = fromBundle(first);
	const rest = fromBundle(later);
	let grown = false;
	return {
		source: { candidates: async () => grown ? [...await listed.candidates(), ...await rest.candidates()] : listed.candidates() },
		grow: () => { grown = true; },
	};
};

export const instance = (make: (props: ModuleProps) => unknown, deps: string[] = []): ModuleExports =>
	({ deps, default: make as Factory });

export const request = (path = '/', init: RequestInit = {}): Request =>
	new Request(`http://app.test${path}`, init);

export const peer: Peer = { address: '127.0.0.1' };

/** A client end: the link and the requests over one socket, both through the public surface. */
export interface Client {
	readonly socket: PairedSocket;
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
