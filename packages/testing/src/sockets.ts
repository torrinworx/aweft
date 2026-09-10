// Two ends of one socket, wired to each other, with no port.
//
// `sync`'s `inProcess` answers a pair of channels, and a channel is one plane. The listener seam
// hands over a socket, one socket carries both the link and the call channel, and the retry reads
// `readyState` and the close event. So the pair a whole connection needs is at this level
// (design 254).

import type { SocketLike } from '@aweftjs/sync';

const OPEN = 1;
const CLOSED = 3;

/** One end of a pair: a socket, plus what it was asked to send. */
export interface PairedSocket extends SocketLike {
	/** The peer this end delivers to. Set by `socketPair` and not meant to be reassigned. */
	peer: PairedSocket | undefined;
	/** Every payload handed to `send`, oldest first, whether or not a peer heard it. */
	readonly sent: (Uint8Array | string)[];
	/** Everything a listener on this end threw, oldest first. Dispatch carries on past each. */
	readonly thrown: unknown[];
	/** Deliver an event to this end's listeners, as the transport would. */
	fire(type: string, event: { data?: unknown }): void;
}

const end = (readyState: number): PairedSocket => {
	const listeners: Record<string, ((event: { data?: unknown }) => void)[]> = {};
	const it: PairedSocket = {
		binaryType: 'blob',
		readyState,
		peer: undefined,
		sent: [],
		thrown: [],
		send: (data) => {
			it.sent.push(data);
			// A real socket refuses a send before it is open and drops one after it closed. Queuing
			// either would let a suite pin "nothing is written before open" here and still fail in a
			// deployment, which is the one thing a harness must not do.
			if (it.readyState !== OPEN) return;
			// On a microtask, never synchronously: a synchronous delivery lets a send re-enter its
			// own sender, which no transport does and which hides re-entrancy bugs rather than
			// finding them.
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
		// Over a copy: a real EventTarget does not call a listener added while an event is
		// dispatching, and a link that subscribes from inside a handler would otherwise hear the
		// event it was registered by.
		//
		// Each in its own try, because a real EventTarget reports a throwing listener and carries
		// on to the next. One socket here carries both the link and the call channel, so a link
		// that throws would otherwise mean an ask that never settles: a test that times out
		// pointing at the wrong thing.
		fire: (type, event) => {
			for (const fn of [...(listeners[type] ?? [])]) {
				try {
					fn(event);
				} catch (error) {
					// Recorded rather than rethrown: a real EventTarget hands a throwing listener to
					// the host's error reporting, and the nearest thing here would be an uncaught
					// exception that fails whichever test happened to be running.
					it.thrown.push(error);
				}
			}
		},
	};
	return it;
};

/**
 * Two ends of one socket with no port: what one sends, the other hears on a microtask, and
 * closing either closes both.
 *
 * @param readyState What the first end starts as. The second is always open, because it stands
 *   for the socket a listener was handed after the handshake, while the first stands for the one
 *   a page holds before `open` has fired. Pass `0` to drive a retry.
 * @returns The pair, the page's end first.
 * @example
 * const [near, far] = socketPair();
 * const link = connect(fromWebSocket(near));
 * accept(far);
 */
export const socketPair = (readyState: number = OPEN): [PairedSocket, PairedSocket] => {
	const near = end(readyState);
	const far = end(OPEN);
	near.peer = far;
	far.peer = near;
	return [near, far];
};
