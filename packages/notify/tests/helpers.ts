// What the suites share: a store, a server with no port over the battery and the auth battery,
// a connection over the harness socket, the page's two seams, and two fake services on
// localhost standing in for Resend and FCM (design 254).

import { generateKeyPairSync } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

import { auth, paths as authPaths } from '@aweftjs/auth';
import type { SocketLike } from '@aweftjs/client';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleExports, Source } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Gate, Listener, ListenerHandlers, Peer, Server } from '@aweftjs/server';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, Requests } from '@aweftjs/sync';
import { settle, socketPair } from '@aweftjs/testing';
import type { PairedSocket } from '@aweftjs/testing';

import { notify } from '../src/index.ts';
import type { Send } from '../src/index.ts';

export { settle };
export const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
export const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
export const reasonOf = (error: unknown): string => {
	const held = error as { reason?: unknown; cause?: unknown } | null;
	// The module harness wraps a factory throw as `failed` with the original as its cause.
	if (typeof held?.reason === 'string' && held.reason !== 'failed') return held.reason;
	const cause = held?.cause as { reason?: unknown } | undefined;
	return String(cause?.reason ?? held?.reason);
};

export const newStore = (): Store => createStore({ driver: memoryDriver(), declare: { ...authPaths } });

export const request = (path = '/', init: RequestInit = {}): Request => new Request(`http://app.test${path}`, init);
export const jsonRequest = (path: string, body: unknown, cookie?: string, method = 'POST'): Request =>
	request(path, {
		method, body: JSON.stringify(body),
		headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
	});

// --- a server with no port ------------------------------------------------------------------

export const fakeListener = (): { listener: Listener; handlers(): ListenerHandlers } => {
	let held: ListenerHandlers | undefined;
	return {
		listener: { start: async (handlers) => { held = handlers; }, stop: async () => {} },
		handlers: () => { if (held === undefined) throw new Error('not started'); return held; },
	};
};

export const peer: Peer = { address: '127.0.0.1' };

/** A gate with no users at all: every context is anonymous, and nothing is refused. */
export const anyone: Gate = open;

/** A gate that says every connection is this one user, for a suite with no sign-in in it. */
export const asUser = (user: string): Gate<{ user: string }> => ({
	identify: () => ({ context: { user } }),
	access: () => [],
});

export interface Started {
	readonly store: Store | undefined;
	readonly server: Server;
	readonly handlers: ListenerHandlers;
	/** The broker, as a module that names it in `deps` gets it. */
	readonly send: Send;
	stop(): Promise<void>;
}

/** A server over the battery, the auth battery when asked, and the configuration given. */
export const started = async (options: {
	store?: Store | null; gate?: Gate | string; withAuth?: boolean;
	config?: Record<string, ModuleExports>; app?: Record<string, ModuleExports>; failed?: string[];
} = {}): Promise<Started> => {
	const store = options.store === null ? undefined : options.store ?? newStore();
	const listening = fakeListener();
	const sources: Source[] = [fromBundle({ ...(options.app ?? {}), ...(options.config ?? {}) }), notify, ...(options.withAuth === true ? [auth] : [])];
	const server = createServer({
		sources, store, gate: options.gate ?? (options.withAuth === true ? 'auth/Gate' : anyone), listener: listening.listener,
		handlers: { failed: (name, error) => { options.failed?.push(`${name}: ${(error as Error).message}`); } },
	});
	await server.start();
	return {
		store, server, handlers: listening.handlers(),
		send: server.loader.get('notify/Send') as Send,
		stop: async () => { await server.stop(); await store?.stop(); },
	};
};

/** A `notify/Send` configuration file for `started`'s `config`. */
export const sendConfig = (config: Record<string, unknown>): Record<string, ModuleExports> =>
	({ './notify/Send.ts': { config } as ModuleExports });

export interface Client { readonly socket: PairedSocket; readonly link: Link; readonly asks: Requests }

export const connectTo = async (handlers: ListenerHandlers, cookie?: string): Promise<Client> => {
	const answer = await handlers.socket(request('/ws', cookie === undefined ? {} : { headers: { cookie } }), peer);
	if (answer instanceof Response) throw new Error(`the handshake was refused with ${String(answer.status)}`);
	const [near, far] = socketPair();
	answer(far);
	return { socket: near, link: connect(fromWebSocket(near)), asks: requests(near) };
};

/** Sign up over the route and answer the cookie a browser would hold. */
export const signUp = async (handlers: ListenerHandlers, email: string): Promise<{ user: string; cookie: string }> => {
	const answer = await handlers.request(jsonRequest('/api/session', { email, password: 'correct horse' }), peer);
	const { user } = await answer.json() as { user: string };
	return { user, cookie: answer.headers.getSetCookie()[0]!.split(';')[0]! };
};

// --- the page's socket seam, wired to a server with no port -----------------------------------

/** What a page gives `createClient`: sockets that open against the server's handshake, with a cookie. */
export const pageSockets = (handlers: () => ListenerHandlers, cookie = ''): { open(url: string): SocketLike; sockets: PairedSocket[] } => {
	const sockets: PairedSocket[] = [];
	return {
		sockets,
		open: () => {
			const [near, far] = socketPair(0);
			sockets.push(near);
			void handlers().socket(request('/ws', cookie === '' ? {} : { headers: { cookie } }), peer).then((answer) => {
				if (typeof answer !== 'function' || near.readyState === 3) return;
				answer(far);
				near.readyState = 1;
				near.fire('open', {});
			});
			return near;
		},
	};
};

// --- the two fake services ------------------------------------------------------------------

export interface Call { readonly path: string; readonly headers: Record<string, string | string[] | undefined>; readonly body: unknown }

interface Fake {
	readonly url: string;
	readonly calls: Call[];
	/** What the next requests answer, until changed. */
	answer(status: number, body: unknown, delayMs?: number): void;
	stop(): Promise<void>;
}

const readBody = (incoming: IncomingMessage): Promise<string> => new Promise((done) => {
	let text = '';
	incoming.on('data', (chunk: Buffer) => { text += chunk.toString(); });
	incoming.on('end', () => { done(text); });
});

const listen = (http: HttpServer): Promise<string> => new Promise((done) => {
	http.listen(0, '127.0.0.1', () => {
		const address = http.address() as { port: number };
		done(`http://127.0.0.1:${String(address.port)}`);
	});
});

/** A server on localhost that records every request and answers what it is told to. */
export const fake = async (route?: (call: Call, reply: (status: number, body: unknown) => void) => boolean): Promise<Fake> => {
	const calls: Call[] = [];
	let status = 200;
	let body: unknown = { ok: true };
	let delayMs = 0;
	const http = createHttpServer(async (incoming: IncomingMessage, outgoing: ServerResponse) => {
		const text = await readBody(incoming);
		let parsed: unknown = text;
		try { parsed = JSON.parse(text); } catch { /* a form body stays text */ }
		const call: Call = { path: incoming.url ?? '', headers: incoming.headers, body: parsed };
		calls.push(call);
		const reply = (s: number, b: unknown): void => {
			outgoing.writeHead(s, { 'content-type': 'application/json' });
			outgoing.end(JSON.stringify(b));
		};
		if (route?.(call, reply) === true) return;
		if (delayMs > 0) await wait(delayMs);
		reply(status, body);
	});
	const url = await listen(http);
	return {
		url, calls,
		answer: (s, b, d = 0) => { status = s; body = b; delayMs = d; },
		stop: () => new Promise((done) => { http.closeAllConnections(); http.close(() => { done(); }); }),
	};
};

/** A service account key file a test can sign with, as the JSON text a configuration carries. */
export const serviceAccount = (): string => {
	const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	return JSON.stringify({
		client_email: 'push@test.iam.gserviceaccount.com',
		private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
		project_id: 'test-project',
	});
};

/** A fake FCM: the token endpoint answers a token, the send endpoint records the message. */
export const fakeFcm = async (): Promise<Fake & { readonly tokenUrl: string; readonly endpoint: string; readonly exchanges: () => number; readonly sends: () => Call[] }> => {
	const inner = await fake((call, reply) => {
		if (call.path === '/token') { reply(200, { access_token: `token-${String(inner.calls.length)}`, expires_in: 3600 }); return true; }
		return false;
	});
	return {
		...inner,
		tokenUrl: `${inner.url}/token`,
		endpoint: `${inner.url}/v1/projects/{project}/messages:send`,
		exchanges: () => inner.calls.filter((c) => c.path === '/token').length,
		sends: () => inner.calls.filter((c) => c.path !== '/token'),
	};
};
