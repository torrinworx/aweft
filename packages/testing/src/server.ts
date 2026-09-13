// A real server with real modules, on a listener that opens nothing.
//
// The listener is the one part of a deployment a test cannot supply and the only reason a suite
// would otherwise write its own server boot. Everything else here is `createServer`'s own options
// (design 254).

import { codecError } from '@aweftjs/codec';
import { createServer } from '@aweftjs/server';
import type { Listener, ListenerHandlers, Peer, Server, ServerOptions } from '@aweftjs/server';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests } from '@aweftjs/sync';

import { socketPair } from './sockets.ts';
import type { PairedSocket } from './sockets.ts';

/** The origin every request the harness makes is on, so one cookie jar covers all of them. */
const ORIGIN = 'http://app.test';

const LOOPBACK: Peer = { address: '127.0.0.1' };

/** What `open` answers when the gate let the handshake through. */
export interface Connected {
	/** The page's end of the socket. The server holds the other. */
	readonly socket: PairedSocket;
	/** A link over that socket, already connected. */
	readonly link: Link;
	/** The call channel over the same socket. */
	readonly asks: Requests;
	/** The handshake request, so a test can assert what the gate was given. */
	readonly request: Request;
}

/** What `open` may be told about the handshake it is about to make. */
export interface OpenOptions {
	/** Headers the handshake carries. A cookie goes here. */
	readonly headers?: Record<string, string> | undefined;
	/** The path to open on. The server accepts an upgrade on any path. */
	readonly url?: string | undefined;
	/** Who the connection appears to come from. */
	readonly peer?: Peer | undefined;
}

/**
 * A running server with no port, and the two seams a listener would feed it.
 *
 * @example
 * const server = await loadServer({ sources, gate: open });
 * await server.fetch('/api/board');
 * await server.stop();
 */
export interface LoadedServer {
	/** The server itself, for anything the seams below do not cover. */
	readonly server: Server;
	/** An HTTP request through the listener seam, exactly as a deployment would deliver it. */
	fetch(path: string, init?: RequestInit): Promise<Response>;
	/** A socket connection through the same handshake. Throws when the gate refuses it. */
	open(options?: OpenOptions): Promise<Connected>;
	/** Stop the server. Safe to call twice. */
	stop(): Promise<void>;
}

/**
 * Boot a server with real modules on a listener with no port.
 *
 * @param options `createServer`'s options without `listener`, which this supplies.
 * @returns The server, `fetch` and `open` for the two seams a listener feeds, and `stop`.
 * @throws `handshake-refused` from `open` when the gate turns the handshake away, carrying the
 *   status it answered with. Whatever `createServer` throws for a missing source or a bad gate.
 * @example
 * const server = await loadServer({ sources: [fromBundle({ 'board/Board': Board })], gate: open });
 * const answer = await server.fetch('/api/board');
 * const page = await server.open({ headers: { cookie } });
 * await server.stop();
 */
export const loadServer = async (
	options: Omit<ServerOptions, 'listener'>,
): Promise<LoadedServer> => {
	let handlers: ListenerHandlers | undefined;
	// The listener holds what it is started with and opens nothing. `stop` is idempotent because
	// the contract says calling it twice is not an error, and a suite whose test failed part way
	// through still runs its teardown.
	const listener: Listener = {
		start: async (given) => { handlers = given; },
		stop: async () => { handlers = undefined; },
	};

	const server = createServer({ ...options, listener } as ServerOptions);
	await server.start();

	const started = (): ListenerHandlers => {
		if (handlers === undefined) {
			throw codecError(
				'server-stopped', 'the harness server has been stopped, so it accepts nothing',
				'Call loadServer again; a stopped server is not restarted.',
			);
		}
		return handlers;
	};

	return {
		server,
		// A path is on the harness's own origin; a full URL is taken as it is, which is how a suite
		// says a request arrived over TLS.
		fetch: async (path, init = {}) => started().request(new Request(/^https?:\/\//.test(path) ? path : `${ORIGIN}${path}`, init), LOOPBACK),
		open: async ({ headers, url = '/', peer = LOOPBACK } = {}) => {
			const request = new Request(`${ORIGIN}${url}`, headers === undefined ? {} : { headers });
			const answer = await started().socket(request, peer);
			// A browser handed a refusal on a handshake gets a failed connection, not a response to
			// read, so the faithful seam throws. The status rides along for the suite asserting it.
			if (answer instanceof Response) {
				throw Object.assign(
					codecError(
						'handshake-refused',
						`the gate refused the handshake with ${String(answer.status)}`,
						'Open with the headers the gate needs, or assert the refusal with assert.rejects.',
					),
					{ status: answer.status, response: answer },
				);
			}
			// The far end is handed over first and the near end is already open, which is the order
			// a deployment produces: the socket is accepted before the page is told about it.
			const [near, far] = socketPair();
			answer(far);
			return { socket: near, link: connect(fromWebSocket(near)), asks: requests(near), request };
		},
		stop: async () => { await server.stop(); },
	};
};
