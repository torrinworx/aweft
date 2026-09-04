// A channel: the whole of what a transport has to provide.
//
// Send a frame, hear frames, know when it closed, close it. Nothing above this line knows
// whether the other side is a socket, a worker, or an object in the same heap.
//
// Delivery is always asynchronous, on every adapter including the in process one. That is not
// a convenience: applying a commit from inside a watcher hands it to the receiving document's
// watchers after the outer watcher has returned, so a link that delivered synchronously would
// work in process and break on a socket. Every adapter here delivers on a microtask, so the
// in process link is the same shape as a real one and the proof program means something.

import { type Frame, decodeFrame, encodeFrame } from './frame.ts';

/**
 * A duplex link that carries frames in order.
 *
 * A channel must deliver what it is given, in the order it was given, or close. The protocol
 * detects loss and reordering but does not repair them: it resynchronizes instead.
 */
export interface Channel {
	/** Put a frame on the link. Sending on a closed channel does nothing. */
	send(frame: Frame): void;
	/** Hear frames. Returns the function that stops hearing them. */
	receive(fn: (frame: Frame) => void): () => void;
	/**
	 * Hear that the link ended, for any reason. Returns the function that stops hearing.
	 * A channel that has already ended calls it on the next microtask.
	 */
	closed(fn: () => void): () => void;
	/** End the link. Calling it twice is not an error. */
	close(): void;
}

/** The bookkeeping every adapter shares: who is listening, and whether it is over. */
interface Wiring {
	readonly listeners: Set<(frame: Frame) => void>;
	readonly enders: Set<() => void>;
	over: boolean;
}

const wiring = (): Wiring => ({ listeners: new Set(), enders: new Set(), over: false });

/**
 * Read a frame off the wire, and end the link if it is not one.
 *
 * A channel must carry frames in order or close, so bytes that are not a frame are the one
 * thing it cannot carry on through. Throwing out of a delivery would take the process with it
 * instead of the link.
 */
const take = (state: Wiring, bytes: Uint8Array, read: (b: Uint8Array) => Frame): void => {
	let frame: Frame;
	try {
		frame = read(bytes);
	} catch {
		end(state);
		return;
	}
	deliver(state, frame);
};

const deliver = (state: Wiring, frame: Frame): void => {
	if (state.over) return;
	for (const listener of [...state.listeners]) listener(frame);
};

const end = (state: Wiring): void => {
	if (state.over) return;
	state.over = true;
	for (const ender of [...state.enders]) ender();
	state.listeners.clear();
	state.enders.clear();
};

const surface = (state: Wiring, send: (frame: Frame) => void, close: () => void): Channel => ({
	send: (frame) => {
		if (!state.over) send(frame);
	},
	receive: (fn) => {
		state.listeners.add(fn);
		return () => { state.listeners.delete(fn); };
	},
	closed: (fn) => {
		// A link that already ended tells whoever asks, at once. Otherwise a caller that wired
		// itself to a dead channel would wait for an event that has already happened.
		if (state.over) {
			queueMicrotask(fn);
			return () => {};
		}
		state.enders.add(fn);
		return () => { state.enders.delete(fn); };
	},
	close: () => {
		if (state.over) return;
		close();
		end(state);
	},
});

/**
 * Two channels wired to each other in one process.
 *
 * Params: none.
 *
 * Returns: a pair. What one sends, the other hears, on a microtask.
 *
 * The frames are handed over as they are, with no encoding. Measured, that is 0.011 us against
 * 4.29 us to encode and decode one, and nothing between the two ever leaves the heap.
 * Treat a frame as read-only on both sides, which every type here already says.
 *
 * Example:
 *   const [a, b] = inProcess();
 *   const left = connect(a);
 *   const right = connect(b);
 */
export const inProcess = (): [Channel, Channel] => {
	const left = wiring();
	const right = wiring();

	const post = (to: Wiring, frame: Frame): void => {
		queueMicrotask(() => deliver(to, frame));
	};

	const shut = (): void => {
		queueMicrotask(() => { end(left); end(right); });
	};

	return [
		surface(left, (frame) => post(right, frame), shut),
		surface(right, (frame) => post(left, frame), shut),
	];
};

/** What this package needs from a `MessagePort`, stated structurally so no DOM types leak in. */
export interface PortLike {
	postMessage(value: unknown): void;
	addEventListener(type: 'message' | 'messageerror', fn: (event: { data: unknown }) => void): void;
	start?(): void;
	close(): void;
}

/**
 * A channel over a `MessagePort`, a `Worker`, or anything shaped like one.
 *
 * Params:
 *   port: the port. It is started for you if it needs starting
 *
 * Returns: a channel. Frames cross as bytes, which is the same encoding a socket carries, so
 * a sandbox and a server are not two protocols.
 *
 * Example:
 *   const channel = fromMessagePort(worker);
 */
export const fromMessagePort = (port: PortLike): Channel => {
	const state = wiring();

	port.addEventListener('message', (event) => {
		if (!(event.data instanceof Uint8Array)) return;
		queueMicrotask(() => take(state, event.data as Uint8Array, decodeFrame));
	});
	port.addEventListener('messageerror', () => { queueMicrotask(() => end(state)); });
	port.start?.();

	return surface(state, (frame) => port.postMessage(encodeFrame(frame)), () => port.close());
};

/** What this package needs from a `WebSocket`, stated structurally so no DOM types leak in. */
export interface SocketLike {
	binaryType: string;
	readyState: number;
	send(data: Uint8Array): void;
	close(): void;
	addEventListener(type: 'open' | 'message' | 'close' | 'error', fn: (event: { data?: unknown }) => void): void;
}

/** `WebSocket.CONNECTING` and `WebSocket.OPEN`, spelled here because no DOM types are in scope. */
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

/**
 * A channel over a `WebSocket`, open or still connecting.
 *
 * Params:
 *   socket: the socket. Its `binaryType` is set to `arraybuffer` for you
 *
 * Returns: a channel. A frame handed over while the socket is still connecting is held and
 * sent, in order, once it opens, so a link may share before the socket is up. A socket that
 * is closing or closed ends the channel. Opening the socket stays yours, which is what makes
 * reconnecting yours too: hand `connect` a function that makes a new one.
 *
 * A frame is one binary message. Frames are not compressed here: measured on a real commit
 * stream, gzip per frame is larger than the frames themselves, because a 54 byte frame cannot
 * pay for a gzip header. Turn on the transport's own shared-context compression instead.
 *
 * Example:
 *   const link = connect(fromWebSocket(new WebSocket(url)));
 */
export const fromWebSocket = (socket: SocketLike): Channel => {
	const state = wiring();
	socket.binaryType = 'arraybuffer';

	// Frames handed over before the socket opened. A drop here would lose the `open` frame of
	// a share made while connecting, and the topic would then wait forever.
	let held: Uint8Array[] | undefined = socket.readyState === SOCKET_CONNECTING ? [] : undefined;
	socket.addEventListener('open', () => {
		const toSend = held ?? [];
		held = undefined;
		for (const bytes of toSend) socket.send(bytes);
	});

	socket.addEventListener('message', (event) => {
		const data = event.data;
		const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
			: data instanceof Uint8Array ? data : undefined;
		if (bytes === undefined) return;
		queueMicrotask(() => take(state, bytes, decodeFrame));
	});
	socket.addEventListener('close', () => { queueMicrotask(() => end(state)); });
	socket.addEventListener('error', () => { queueMicrotask(() => end(state)); });

	return surface(state, (frame) => {
		if (held !== undefined) {
			held.push(encodeFrame(frame));
		} else if (socket.readyState === SOCKET_OPEN) {
			socket.send(encodeFrame(frame));
		} else {
			// A channel carries a frame or closes; a socket that is going down cannot carry it.
			queueMicrotask(() => end(state));
		}
	}, () => socket.close());
};
