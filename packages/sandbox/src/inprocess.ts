// The room that is no room: the same process, no isolation at all (design 069).
//
// For tests, and for code the application trusts. A module runs behind the same window with
// the same imports it would have behind a wall, so trust is a change of runner.
//
// It runs over a local channel pair built here rather than sync's `inProcess`, because this
// use has two needs that pair does not meet together: the host attaches its receiver a
// microtask after the room attaches its own, so frames sent in that gap must be held rather
// than dropped (as a `MessagePort` holds them until `start`); and closing one end must reach
// the other, so a room torn down before its handshake finished does not leave the host
// awaiting a room that never comes up. Nothing is serialized: this is trusted, same-process.

import type { Channel, Frame } from '@aweftjs/sync';

import type { Runner } from './contract.ts';
import { type Room, inside } from './inside.ts';

interface End {
	readonly listeners: Set<(frame: Frame) => void>;
	readonly enders: Set<() => void>;
	/** Frames posted before anyone was listening. Flushed when the first listener attaches. */
	readonly held: Frame[];
	over: boolean;
}

const end = (side: End): void => {
	if (side.over) return;
	side.over = true;
	for (const ender of [...side.enders]) ender();
	side.listeners.clear();
	side.enders.clear();
	side.held.length = 0;
};

/** A channel pair that holds frames until the peer listens, and ends both sides together. */
const bufferedPair = (): [Channel, Channel] => {
	const a: End = { listeners: new Set(), enders: new Set(), held: [], over: false };
	const b: End = { listeners: new Set(), enders: new Set(), held: [], over: false };

	const shut = (): void => queueMicrotask(() => { end(a); end(b); });

	const deliver = (to: End, frame: Frame): void => {
		if (to.over) return;
		if (to.listeners.size === 0) { to.held.push(frame); return; }
		for (const listener of [...to.listeners]) listener(frame);
	};

	const surface = (self: End, peer: End): Channel => ({
		send: (frame) => { if (!self.over) queueMicrotask(() => deliver(peer, frame)); },
		receive: (fn) => {
			self.listeners.add(fn);
			if (self.held.length > 0) {
				const held = [...self.held];
				self.held.length = 0;
				queueMicrotask(() => { for (const frame of held) if (!self.over) fn(frame); });
			}
			return () => { self.listeners.delete(fn); };
		},
		closed: (fn) => {
			if (self.over) { queueMicrotask(fn); return () => {}; }
			self.enders.add(fn);
			return () => { self.enders.delete(fn); };
		},
		close: shut,
	});

	return [surface(a, b), surface(b, a)];
};

/**
 * A runner whose room is this process.
 *
 * Params: none.
 *
 * Returns: a runner. Nothing it runs is isolated from anything, and the README says so.
 *
 * Example:
 *   const sandbox = await createSandbox({ runner: inProcess(), modules, grants });
 */
export const inProcess = (): Runner => {
	let near: Channel | undefined;
	let room: Promise<Room> | undefined;
	return {
		start: async () => {
			const [here, there] = bufferedPair();
			near = here;
			room = inside(there);
			// The room is torn down through `stop`; a link that ends first rejects this (and the
			// close below reaches it), and nobody is waiting on the promise itself.
			room.catch(() => {});
			return here;
		},
		stop: async () => {
			// Closing this end reaches the room's end, so a room still shaking hands ends its
			// link, rejects its own `ready`, and `inside` settles rather than hanging here.
			near?.close();
			if (room === undefined) return;
			try {
				await (await room).stop();
			} catch {
				// The room never came up: closing the channel above is all the teardown there is.
			}
		},
	};
};
