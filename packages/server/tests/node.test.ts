// The Node listener, over real ports: the conformance suite in both modes, the limits that
// are parameters, and one whole connection end to end through `ws` (design 072).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';

import { createObject } from '@aweftjs/core';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { SocketLike } from '@aweftjs/sync';
import { listenerChecks } from '@aweftjs/testing';
import type { MadeListener } from '@aweftjs/testing';
import WebSocket from 'ws';

import { createServer } from '../src/index.ts';
import type { Connection, Gate, ServerError } from '../src/index.ts';
import { node } from '../src/node.ts';

import { instance, loaderOf, settle } from './helpers.ts';

const own = (): MadeListener => {
	const listener = node({ port: 0, host: '127.0.0.1' });
	return { listener, url: () => `http://127.0.0.1:${String(listener.port)}` };
};

const given = async (): Promise<MadeListener> => {
	const server = createHttpServer();
	await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
	const port = (server.address() as { port: number }).port;
	const listener = node({ server });
	const stop = listener.stop;
	// The given server is the test's to close, after the listener has let go of it.
	return {
		listener: { start: listener.start, stop: async () => { await stop(); await new Promise<void>((done) => server.close(() => done())); } },
		url: () => `http://127.0.0.1:${port}`,
	};
};

for (const [label, make] of [['a server of its own', own], ['a server the application made', given]] as const) {
	for (const c of listenerChecks()) {
		test(`${label}: ${c.name}`, () => c.run(make));
	}
}

test('a heartbeat terminates a socket that does not answer a ping, and leaves one that does', async () => {
	const listener = node({ port: 0, host: '127.0.0.1', heartbeatMs: 40 });
	await listener.start({ request: async () => new Response(null, { status: 404 }), socket: async () => () => {} });
	const url = `ws://127.0.0.1:${String(listener.port)}`;
	const silent = new WebSocket(url, { autoPong: false });
	const talking = new WebSocket(url);
	await Promise.all([silent, talking].map((ws) => new Promise((done) => ws.once('open', done))));
	const silentClosed = new Promise<void>((done) => silent.once('close', () => done()));
	await Promise.race([silentClosed, new Promise<void>((_, fail) => setTimeout(() => fail(new Error('the silent socket was not terminated')), 2000))]);
	assert.equal(talking.readyState, WebSocket.OPEN, 'the socket that answers its pings stays');
	talking.close();
	await listener.stop();
});

test('maxPayload bounds a message, and nothing bounds one without it', async () => {
	const bounded = node({ port: 0, host: '127.0.0.1', maxPayload: 100 });
	const heard: string[] = [];
	await bounded.start({
		request: async () => new Response(null, { status: 404 }),
		socket: async () => (socket) => { socket.addEventListener('message', (event) => { heard.push(String(event.data).length.toString()); }); },
	});
	const ws = new WebSocket(`ws://127.0.0.1:${String(bounded.port)}`);
	await new Promise((done) => ws.once('open', done));
	ws.send('x'.repeat(50));
	const closed = new Promise<number>((done) => ws.once('close', (code) => done(code)));
	ws.send('x'.repeat(200));
	assert.equal(await closed, 1009, 'a message over the bound closes the socket with 1009');
	await settle();
	assert.deepEqual(heard, ['50']);
	await bounded.stop();
});

test('start twice is refused, stop twice is not, and port reads undefined when stopped', async () => {
	const listener = node({ port: 0, host: '127.0.0.1' });
	assert.equal(listener.port, undefined);
	await listener.start({ request: async () => new Response(null, { status: 404 }), socket: async () => () => {} });
	assert.equal(typeof listener.port, 'number');
	await assert.rejects(listener.start({ request: async () => new Response(null, { status: 404 }), socket: async () => () => {} }), (e: ServerError) => e.reason === 'started');
	await listener.stop();
	await listener.stop();
	assert.equal(listener.port, undefined);
});

test('a port that is taken fails start rather than hanging', async () => {
	const holder = createHttpServer();
	await new Promise<void>((ready) => holder.listen(0, '127.0.0.1', ready));
	const port = (holder.address() as { port: number }).port;
	const listener = node({ port, host: '127.0.0.1' });
	await assert.rejects(listener.start({ request: async () => new Response(null, { status: 404 }), socket: async () => () => {} }), /EADDRINUSE/);
	await new Promise<void>((done) => holder.close(() => done()));
});

test('a whole connection end to end: the handshake cookie identifies it, a share converges, a call answers', async () => {
	type Ctx = { user: string | null };
	const gate: Gate<Ctx> = {
		identify: (request) => {
			const cookie = request.headers.get('cookie');
			if (cookie === 'session=forged') return { refused: [{ code: 'cookie', message: 'no' }] };
			return { context: { user: cookie === null ? null : cookie.slice('session='.length) } };
		},
		access: ({ instance: held }, context) => ((held as { public?: boolean }).public === true || context.user !== null ? [] : [{ code: 'private', message: 'sign in' }]),
	};
	const boards = new Map<string, Record<string, unknown>>();
	const loader = loaderOf({
		'app/Board': instance(() => ({
			connection: ({ link, context }: Connection<Ctx>) => {
				let board = boards.get(context.user!);
				if (board === undefined) boards.set(context.user!, (board = createObject<Record<string, unknown>>({ owner: context.user })));
				link.share('board', board, { accept: () => [] });
			},
			call: (args: unknown, context: Ctx, { progress }: { progress(v: unknown): void }) => { progress('working'); return `${String(context.user)} asked ${JSON.stringify(args)}`; },
		})),
		'app/Hello': instance(() => ({ public: true, call: () => 'hello', routes: { 'GET /hello': () => new Response('hi') } })),
	});
	await loader.load(['app/Board', 'app/Hello']);
	const listener = node({ port: 0, host: '127.0.0.1' });
	const server = createServer({ loader, gate, listener });
	await server.start();
	const base = `127.0.0.1:${String(listener.port)}`;

	assert.equal(await (await fetch(`http://${base}/hello`)).text(), 'hi');
	assert.equal((await fetch(`http://${base}/nothing`)).status, 404);

	const forged = new WebSocket(`ws://${base}/`, { headers: { cookie: 'session=forged' } });
	const refused = await new Promise<number | undefined>((done) => {
		forged.once('unexpected-response', (_req, res) => done(res.statusCode));
		forged.once('error', () => done(undefined));
		forged.once('open', () => done(-1));
	});
	assert.equal(refused, 401, 'a refused handshake is a 401 before any socket opens');

	// The link and the requests attach before the socket opens: the server speaks first, and a
	// message that arrives before anything listens is lost, on every WebSocket there is.
	const ada = new WebSocket(`ws://${base}/`, { headers: { cookie: 'session=ada' } });
	const socket = ada as unknown as SocketLike;
	const link = connect(fromWebSocket(socket));
	const asks = requests(socket);
	const board = await link.share<Record<string, unknown>>('board').ready;
	await settle();
	assert.equal(board.owner, 'ada');
	board.title = 'written by ada';
	await settle(20);
	assert.equal(boards.get('ada')!.title, 'written by ada', 'a client write reached the server document');
	const heard: unknown[] = [];
	assert.equal(await asks.ask('app/Board', { n: 1 }, { progress: (v) => heard.push(v) }), 'ada asked {"n":1}');
	assert.deepEqual(heard, ['working']);
	assert.equal(await asks.ask('app/Hello'), 'hello');

	const anonymous = new WebSocket(`ws://${base}/`);
	const anonymousAsks = requests(anonymous as unknown as SocketLike);
	assert.equal(await anonymousAsks.ask('app/Hello'), 'hello');
	assert.equal(await anonymousAsks.ask('app/Board').catch((e: { reason: string }) => e.reason), 'refused');

	ada.close();
	anonymous.close();
	await server.stop();
});

test('forwarded reads the proxy headers for the scheme and the peer, and without it they are ignored', async () => {
	for (const forwarded of [true, false]) {
		const listener = node({ port: 0, host: '127.0.0.1', forwarded });
		const seen: string[] = [];
		await listener.start({
			request: async (request, peer) => { seen.push(`${new URL(request.url).protocol} ${String(peer.address)}`); return new Response(null, { status: 204 }); },
			socket: async (request, peer) => { seen.push(`ws ${new URL(request.url).protocol} ${String(peer.address)}`); return new Response(null, { status: 404 }); },
		});
		const base = `127.0.0.1:${String(listener.port)}`;
		await fetch(`http://${base}/`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9, 10.0.0.2' } });
		await fetch(`http://${base}/`);
		const ws = new WebSocket(`ws://${base}/`, { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' } });
		await new Promise<void>((done) => { ws.once('unexpected-response', () => done()); ws.once('error', () => done()); });
		await listener.stop();
		if (forwarded) {
			assert.deepEqual(seen, ['https: 203.0.113.9', 'http: 127.0.0.1', 'ws https: 203.0.113.9']);
		} else {
			assert.deepEqual(seen, ['http: 127.0.0.1', 'http: 127.0.0.1', 'ws http: 127.0.0.1']);
		}
	}
});

test('maxPayload bounds an HTTP body too: a declared size over it is 413, and a body that crosses it is cut off', async () => {
	const listener = node({ port: 0, host: '127.0.0.1', maxPayload: 100 });
	await listener.start({
		request: async (request) => {
			try {
				return new Response(`read ${(await request.text()).length}`);
			} catch {
				return new Response(null, { status: 413 });
			}
		},
		socket: async () => () => {},
	});
	const url = `http://127.0.0.1:${String(listener.port)}/`;
	assert.equal(await (await fetch(url, { method: 'POST', body: 'x'.repeat(50) })).text(), 'read 50');
	assert.equal((await fetch(url, { method: 'POST', body: 'x'.repeat(200) })).status, 413, 'a declared length over the bound');
	const chunked = new ReadableStream({ start(controller) { for (let i = 0; i < 4; i++) controller.enqueue(new TextEncoder().encode('x'.repeat(60))); controller.close(); } });
	const streamed = await fetch(url, { method: 'POST', body: chunked, duplex: 'half' } as RequestInit).then((r) => r.status, () => 'cut off');
	assert.ok(streamed === 413 || streamed === 'cut off', `a body with no declared length is stopped where it crosses the bound, got ${String(streamed)}`);
	await listener.stop();
});
