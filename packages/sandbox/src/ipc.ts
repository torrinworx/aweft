// A channel over a Node IPC pipe, the one a spawned process shares with its parent.
//
// Frames cross as bytes, the same encoding a socket carries. Both the runner and the
// bootstrap use this, one holding the child and the other holding `process`.

import { type Channel, type Frame, decodeFrame, encodeFrame } from '@aweftjs/sync';

/** What both ends of a Node IPC pipe look like. */
export interface IpcLike {
	send(message: unknown): unknown;
	on(event: 'message', fn: (message: unknown) => void): unknown;
	on(event: 'disconnect' | 'exit', fn: () => void): unknown;
	disconnect?(): void;
}

export const fromIpc = (peer: IpcLike): Channel => {
	const listeners = new Set<(frame: Frame) => void>();
	const enders = new Set<() => void>();
	let over = false;

	const end = (): void => {
		if (over) return;
		over = true;
		for (const ender of [...enders]) ender();
		listeners.clear();
		enders.clear();
	};

	peer.on('message', (message) => {
		const bytes: unknown = (message as { aweft?: unknown } | null)?.aweft;
		if (!(bytes instanceof Uint8Array)) return;
		let frame: Frame;
		try {
			frame = decodeFrame(bytes);
		} catch {
			// Bytes that are not a frame end the link rather than the process.
			end();
			return;
		}
		queueMicrotask(() => {
			if (over) return;
			for (const listener of [...listeners]) listener(frame);
		});
	});
	peer.on('disconnect', () => { queueMicrotask(end); });
	peer.on('exit', () => { queueMicrotask(end); });

	return {
		send: (frame) => {
			if (over) return;
			try {
				peer.send({ aweft: encodeFrame(frame) });
			} catch {
				end();
			}
		},
		receive: (fn) => {
			listeners.add(fn);
			return () => { listeners.delete(fn); };
		},
		closed: (fn) => {
			if (over) {
				queueMicrotask(fn);
				return () => {};
			}
			enders.add(fn);
			return () => { enders.delete(fn); };
		},
		close: () => {
			if (over) return;
			end();
			try {
				peer.disconnect?.();
			} catch {
				// Already gone.
			}
		},
	};
};
