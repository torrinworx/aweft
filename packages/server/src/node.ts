// The Node listener: `http` plus `ws`, the stack's one runtime dependency, because a frame
// parser of our own is a security surface (design 072). On its own subpath because it imports
// Node's modules, and the main entry has to load anywhere that speaks `Request`.

import { STATUS_CODES, createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';
import type { Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type WebSocket, WebSocketServer } from 'ws';

import type { SocketLike } from '@aweftjs/sync';

import { type Listener, type ListenerHandlers, type Peer, serverError } from './contract.ts';

/** What either kind of server takes. The two limits have no value of ours. */
export interface NodeSettings {
	/** Ping every open socket this often and terminate one that did not answer the last ping. Nothing pings without it. */
	readonly heartbeatMs?: number | undefined;
	/** The largest WebSocket message or HTTP body accepted, in bytes. Without it the transport's own bound stands, and a body is unbounded. */
	readonly maxPayload?: number | undefined;
	/**
	 * Behind a proxy you trust: read the scheme from `x-forwarded-proto` and the peer address
	 * from the first entry of `x-forwarded-for`. Off, both come from the socket itself, and a
	 * client that sends those headers is ignored. Set it only when a proxy is in front, because
	 * with it any client can name its own address.
	 */
	readonly forwarded?: boolean | undefined;
}

/** A server of this listener's own, closed on `stop`. `port: 0` takes a free one, readable after `start`. */
export interface OwnServer extends NodeSettings {
	readonly port: number;
	readonly host?: string | undefined;
	readonly server?: undefined;
}

/** A server the application made (for TLS, or to share a port). This listener answers on it and never closes it. */
export interface GivenServer extends NodeSettings {
	readonly server: HttpServer;
	readonly port?: undefined;
	readonly host?: undefined;
}

export type NodeOptions = OwnServer | GivenServer;

export interface NodeListener extends Listener {
	/** The port the server is on, once started. */
	readonly port: number | undefined;
}

const first = (header: string | string[] | undefined): string | undefined => {
	const value = Array.isArray(header) ? header[0] : header;
	const one = value?.split(',')[0]?.trim();
	return one === undefined || one === '' ? undefined : one;
};

const peerOf = (req: IncomingMessage, forwarded: boolean): Peer => ({
	address: (forwarded ? first(req.headers['x-forwarded-for']) : undefined) ?? req.socket.remoteAddress,
});

/** A body that errors, and ends the request, once it has carried more than `max` bytes. */
const bounded = (req: IncomingMessage, max: number): ReadableStream => {
	let seen = 0;
	const limit = new Transform({
		transform(chunk: Buffer, _encoding, done) {
			seen += chunk.length;
			if (seen > max) {
				req.destroy();
				done(new Error(`the request body is over ${max} bytes`));
				return;
			}
			done(null, chunk);
		},
	});
	return Readable.toWeb(req.pipe(limit)) as ReadableStream;
};

/** The web-standard request for what Node handed over, its body streamed rather than read. */
const toRequest = (req: IncomingMessage, forwarded: boolean, maxPayload: number | undefined): Request => {
	const encrypted = (req.socket as { encrypted?: boolean }).encrypted === true;
	const scheme = (forwarded ? first(req.headers['x-forwarded-proto']) : undefined) ?? (encrypted ? 'https' : 'http');
	const url = `${scheme}://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) for (const one of value) headers.append(name, one);
		else headers.set(name, value);
	}
	const method = req.method ?? 'GET';
	if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers });
	const body = maxPayload === undefined ? Readable.toWeb(req) as ReadableStream : bounded(req, maxPayload);
	return new Request(url, { method, headers, body, duplex: 'half' } as RequestInit);
};

const headersOf = (response: Response): Record<string, string | string[]> => {
	const headers: Record<string, string | string[]> = {};
	response.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value; });
	const cookies = response.headers.getSetCookie();
	if (cookies.length > 0) headers['set-cookie'] = cookies;
	return headers;
};

const writeResponse = async (response: Response, res: ServerResponse): Promise<void> => {
	res.writeHead(response.status, response.statusText || undefined, headersOf(response));
	if (response.body === null) {
		res.end();
		return;
	}
	await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), res);
};

/** A refused handshake: the response, written by hand onto the raw socket, which then ends. */
const refuseUpgrade = async (response: Response, socket: Duplex): Promise<void> => {
	const body = Buffer.from(await response.arrayBuffer());
	const text = response.statusText || STATUS_CODES[response.status] || '';
	const lines = [`HTTP/1.1 ${response.status} ${text}`, 'connection: close', `content-length: ${body.length}`];
	for (const [name, value] of Object.entries(headersOf(response))) {
		for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`);
	}
	socket.end(Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), body]));
};

/**
 * A listener over Node's `http` server and `ws`.
 *
 * Params:
 *   options: `{ port, host }` for a server of its own, or `{ server }` for one the application
 *     made; either with `heartbeatMs`, `maxPayload` and `forwarded`, none of which has a
 *     value here
 *
 * Returns: the listener, with `port` readable once started.
 *
 * Example:
 *   const listener = node({ port: 8080, heartbeatMs: 30_000 });
 *   const server = createServer({ loader, gate, listener });
 */
export const node = (options: NodeOptions): NodeListener => {
	let server: HttpServer | undefined;
	let wss: WebSocketServer | undefined;
	let beat: ReturnType<typeof setInterval> | undefined;
	let onRequest: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
	let onUpgrade: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;
	const sockets = new Set<WebSocket>();
	const alive = new WeakMap<WebSocket, boolean>();

	const track = (ws: WebSocket): void => {
		sockets.add(ws);
		alive.set(ws, true);
		ws.on('pong', () => { alive.set(ws, true); });
		ws.on('close', () => { sockets.delete(ws); });
		// A frame over `maxPayload`, or a malformed one, is an error on the socket, which `ws`
		// then closes. Unheard, an error event takes the process; whoever holds the socket hears
		// the close.
		ws.on('error', () => {});
	};

	const ping = (): void => {
		for (const ws of sockets) {
			if (alive.get(ws) !== true) {
				ws.terminate();
				continue;
			}
			alive.set(ws, false);
			ws.ping();
		}
	};

	return {
		get port() {
			const address = server?.address();
			return address !== null && typeof address === 'object' ? address.port : undefined;
		},

		start: async (handlers: ListenerHandlers) => {
			if (server !== undefined) throw serverError('started', 'this listener is already started');
			const http = options.server ?? createHttpServer();
			const accepting = new WebSocketServer({
				noServer: true, ...(options.maxPayload === undefined ? {} : { maxPayload: options.maxPayload }),
			});

			const forwarded = options.forwarded === true;
			onRequest = (req, res) => {
				// A body that says up front it is over the bound is refused before it is read; one
				// that lies, or says nothing, is cut off where it crosses the bound (`bounded`).
				const declared = Number(req.headers['content-length']);
				if (options.maxPayload !== undefined && Number.isFinite(declared) && declared > options.maxPayload) {
					res.writeHead(413);
					res.end();
					req.destroy();
					return;
				}
				void handlers.request(toRequest(req, forwarded, options.maxPayload), peerOf(req, forwarded))
					.then((response) => writeResponse(response, res))
					.catch(() => {
						// The handler answers every request itself; what reaches here is a body
						// that would not stream or a socket that went away, and the response is
						// whatever can still be written.
						if (!res.headersSent) res.writeHead(500);
						res.end();
					});
			};
			onUpgrade = (req, socket, head) => {
				void handlers.socket(toRequest(req, forwarded, undefined), peerOf(req, forwarded))
					.then(async (answer) => {
						if (answer instanceof Response) {
							await refuseUpgrade(answer, socket);
							return;
						}
						accepting.handleUpgrade(req, socket, head, (ws) => {
							track(ws);
							ws.binaryType = 'arraybuffer';
							// `ws` implements the browser's event interface; only the type says otherwise.
							answer(ws as unknown as SocketLike);
						});
					})
					.catch(() => { socket.destroy(); });
			};
			http.on('request', onRequest);
			http.on('upgrade', onUpgrade);

			if (options.server === undefined) {
				await new Promise<void>((ready, fail) => {
					http.once('error', fail);
					http.listen(options.port, options.host, () => { http.off('error', fail); ready(); });
				});
			}
			server = http;
			wss = accepting;
			if (options.heartbeatMs !== undefined) beat = setInterval(ping, options.heartbeatMs);
		},

		stop: async () => {
			const http = server;
			if (http === undefined) return;
			server = undefined;
			clearInterval(beat);
			beat = undefined;
			if (onRequest !== undefined) http.off('request', onRequest);
			if (onUpgrade !== undefined) http.off('upgrade', onUpgrade);

			const closing = [...sockets].map((ws) => new Promise<void>((done) => {
				if (ws.readyState === ws.CLOSED) { done(); return; }
				ws.once('close', () => done());
				ws.close();
			}));
			await Promise.all(closing);
			await new Promise<void>((done) => wss!.close(() => done()));
			wss = undefined;

			if (options.server === undefined) {
				http.closeAllConnections();
				await new Promise<void>((done, fail) => http.close((error) => (error ? fail(error) : done())));
			}
		},
	};
};
