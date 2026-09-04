// The suite a `server` listener passes rather than claims (design 072).
//
// A listener turns a runtime's requests and upgrades into web-standard requests and sockets.
// Each check is a named function that throws on failure and runs against a listener the
// caller makes, so one written for another runtime proves itself the same way the Node one
// does. The client side here is Node's own `fetch`, `WebSocket` and `net`, never `ws`.

import assert from 'node:assert/strict';
import { connect as connectTcp } from 'node:net';

import type { Listener, ListenerHandlers } from '@aweftjs/server';

/** What a check needs: a listener nobody else is using, and the URL to reach it at once it has started. */
export type MakeListener = () => Promise<MadeListener> | MadeListener;

export interface MadeListener {
	readonly listener: Listener;
	/** `http://host:port`, readable after `start`. */
	url(): string;
}

/** One named obligation a listener has to meet. */
export interface ListenerCheck {
	readonly name: string;
	run(make: MakeListener): Promise<void>;
}

const refuse = async (): Promise<Response> => new Response(null, { status: 404 });

const handlers = (over: Partial<ListenerHandlers>): ListenerHandlers => ({
	request: over.request ?? refuse,
	socket: over.socket ?? (async () => new Response(null, { status: 404 })),
});

const wsUrl = (url: string): string => url.replace(/^http/, 'ws');

/** Open a socket, or learn that it could not be opened, without waiting for either forever. */
const opened = (url: string): Promise<{ socket: WebSocket; ok: boolean }> =>
	new Promise((done) => {
		const socket = new WebSocket(url);
		socket.addEventListener('open', () => done({ socket, ok: true }));
		socket.addEventListener('error', () => done({ socket, ok: false }));
		socket.addEventListener('close', () => done({ socket, ok: false }));
	});

const closed = (socket: WebSocket): Promise<void> =>
	new Promise((done) => {
		if (socket.readyState === WebSocket.CLOSED) { done(); return; }
		socket.addEventListener('close', () => done());
	});

const next = (socket: WebSocket): Promise<unknown> =>
	new Promise((done) => socket.addEventListener('message', (event) => done(event.data), { once: true }));

/** The status line a raw upgrade request is answered with, read straight off the TCP socket. */
const upgradeStatus = (url: string): Promise<number> =>
	new Promise((done, fail) => {
		const { hostname, port } = new URL(url);
		const socket = connectTcp({ host: hostname, port: Number(port) }, () => {
			socket.write([
				'GET /ws HTTP/1.1', `host: ${hostname}:${port}`, 'connection: upgrade', 'upgrade: websocket',
				'sec-websocket-version: 13', 'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==', '', '',
			].join('\r\n'));
		});
		let text = '';
		socket.on('data', (chunk: Buffer) => {
			text += chunk.toString('latin1');
			const line = /^HTTP\/1\.1 (\d{3})/.exec(text);
			if (line) { socket.destroy(); done(Number(line[1])); }
		});
		socket.on('error', fail);
		socket.on('close', () => { if (!/^HTTP/.test(text)) fail(new Error('the upgrade was closed with no status line')); });
	});

const checks: ListenerCheck[] = [
	{
		name: 'a request arrives as a web Request and the Response goes back whole',
		run: async (make) => {
			const { listener, url } = await make();
			await listener.start(handlers({
				request: async (request) => {
					const { pathname, search } = new URL(request.url);
					return new Response(JSON.stringify({
						method: request.method, pathname, search, probe: request.headers.get('x-probe'), body: await request.text(),
					}), { status: 201, statusText: 'Made', headers: { 'content-type': 'application/json', 'x-answer': 'yes' } });
				},
			}));
			try {
				const response = await fetch(`${url()}/echo?x=1&y=two`, { method: 'POST', headers: { 'x-probe': 'sent' }, body: 'hello there' });
				assert.equal(response.status, 201);
				assert.equal(response.headers.get('x-answer'), 'yes');
				assert.deepEqual(await response.json(), { method: 'POST', pathname: '/echo', search: '?x=1&y=two', probe: 'sent', body: 'hello there' });
			} finally {
				await listener.stop();
			}
		},
	},
	{
		name: 'a large request body arrives whole, and a request without one reads as empty',
		run: async (make) => {
			const { listener, url } = await make();
			await listener.start(handlers({
				request: async (request) => new Response(String((await request.text()).length)),
			}));
			try {
				const big = 'x'.repeat(300_000);
				assert.equal(await (await fetch(`${url()}/`, { method: 'PUT', body: big })).text(), String(big.length));
				assert.equal(await (await fetch(`${url()}/`)).text(), '0');
			} finally {
				await listener.stop();
			}
		},
	},
	{
		name: 'the peer address is the caller\'s',
		run: async (make) => {
			const { listener, url } = await make();
			let seen: string | undefined;
			await listener.start(handlers({
				request: async (_request, peer) => { seen = peer.address; return new Response(null, { status: 204 }); },
			}));
			try {
				await fetch(`${url()}/`);
				assert.ok(seen !== undefined && /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(seen), `a loopback address, got ${String(seen)}`);
			} finally {
				await listener.stop();
			}
		},
	},
	{
		name: 'several Set-Cookie headers reach the client as several',
		run: async (make) => {
			const { listener, url } = await make();
			await listener.start(handlers({
				request: async () => {
					const headers = new Headers();
					headers.append('set-cookie', 'a=1; Path=/; HttpOnly');
					headers.append('set-cookie', 'b=2; Path=/; SameSite=Lax');
					return new Response(null, { status: 204, headers });
				},
			}));
			try {
				const response = await fetch(`${url()}/`);
				assert.deepEqual(response.headers.getSetCookie(), ['a=1; Path=/; HttpOnly', 'b=2; Path=/; SameSite=Lax']);
			} finally {
				await listener.stop();
			}
		},
	},
	{
		name: 'an upgrade the handler refuses answers with that status and never opens a socket',
		run: async (make) => {
			const { listener, url } = await make();
			let accepted = 0;
			await listener.start(handlers({
				socket: async () => new Response(JSON.stringify({ reasons: [{ code: 'no', message: 'not today' }] }), {
					status: 401, headers: { 'content-type': 'application/json' },
				}),
			}));
			try {
				assert.equal(await upgradeStatus(url()), 401);
				const { ok } = await opened(wsUrl(url()));
				assert.equal(ok, false, 'the client never saw an open socket');
				assert.equal(accepted, 0);
			} finally {
				await listener.stop();
			}
		},
	},
	{
		name: 'an accepted upgrade hands over a socket carrying binary and text both ways, kept apart',
		run: async (make) => {
			const { listener, url } = await make();
			await listener.start(handlers({
				socket: async () => (socket) => {
					socket.addEventListener('message', (event) => {
						const data = event.data;
						if (typeof data === 'string') socket.send(`text:${data}`);
						else if (data instanceof ArrayBuffer) socket.send(new Uint8Array(data).reverse());
						else if (data instanceof Uint8Array) socket.send(new Uint8Array(data).reverse());
						else socket.send(`unexpected:${Object.prototype.toString.call(data)}`);
					});
				},
			}));
			try {
				const { socket, ok } = await opened(wsUrl(url()));
				assert.equal(ok, true, 'the client saw the socket open');
				socket.binaryType = 'arraybuffer';
				const text = next(socket);
				socket.send('hi');
				assert.equal(await text, 'text:hi');
				const bytes = next(socket);
				socket.send(new Uint8Array([1, 2, 3]));
				const got = await bytes;
				assert.ok(got instanceof ArrayBuffer, `binary came back as ${Object.prototype.toString.call(got)}`);
				assert.deepEqual([...new Uint8Array(got as ArrayBuffer)], [3, 2, 1]);
				socket.close();
				await closed(socket);
			} finally {
				await listener.stop();
			}
		},
	},
	{
		name: 'stop ends every open socket and accepts nothing afterwards',
		run: async (make) => {
			const { listener, url } = await make();
			await listener.start(handlers({ socket: async () => () => {} }));
			// Read before stop: a listener that owns its server no longer has a port afterwards.
			const at = wsUrl(url());
			const { socket, ok } = await opened(at);
			assert.equal(ok, true);
			const ended = closed(socket);
			await listener.stop();
			await ended;
			assert.equal(socket.readyState, WebSocket.CLOSED, 'the client saw its socket close');
			const again = await opened(at);
			assert.equal(again.ok, false, 'nothing accepts after stop');
			await listener.stop();
		},
	},
];

/**
 * Every obligation a `server` listener has.
 *
 * Returns: the checks, each named, each taking a function that makes a fresh listener and
 * says where to reach it.
 *
 * Example:
 *   for (const c of listenerChecks()) test(c.name, () => c.run(() => {
 *     const listener = node({ port: 0 });
 *     return { listener, url: () => `http://127.0.0.1:${listener.port}` };
 *   }));
 */
export const listenerChecks = (): ListenerCheck[] => [...checks];
