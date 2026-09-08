// The connection, against a real server over sockets wired in memory: the ordering, the held
// ask, the document that survives a socket, and what `close` does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, observer } from '@aweftjs/core';
import { open } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';

import { createClient } from '../src/index.ts';

import { after, dialer, idleSocket, instance, reasonOf, serverOf, settle } from './helpers.ts';

type Board = Record<string, unknown>;

/** The server side of every case here: one shared document, one call, and a way to hang up. */
const boardServer = (state: { board: Board; hooks: number }) => serverOf({
	'app/Board': instance(() => ({
		connection: (connection: Connection<unknown>) => {
			state.hooks += 1;
			connection.link.share('board', state.board, open);
		},
		call: (args: unknown) => `answered ${JSON.stringify(args)}`,
	})),
});

const boardOf = (title: string): Board => createObject<Board>({ title });

test('a share and an ask written before the socket opens both reach the server', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	// Both are made on the line after createClient, while the socket is still connecting.
	const shared = client.share<Board>('board');
	const answer = client.ask('app/Board', { n: 1 });

	assert.equal(client.status.get(), 'connecting');
	assert.equal(dial.sockets[0]!.binaryType, 'arraybuffer', 'the channel set it before anything was sent');
	assert.equal((await shared.ready).title, 'first');
	assert.equal(await answer, 'answered {"n":1}');
	assert.equal(client.status.get(), 'open');

	client.close();
	await server.stop();
});

test('status runs connecting, open then closed, and nothing can write it', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });

	assert.equal(client.status.get(), 'connecting');
	assert.throws(() => client.status.set('open'), (error: { reason: string }) => error.reason === 'read-only');
	const seen: string[] = [];
	client.status.watch((now) => seen.push(now));

	await settle();
	assert.equal(client.status.get(), 'open');

	dial.sockets[0]!.close();
	await settle();
	assert.equal(client.status.get(), 'closed');
	assert.deepEqual(seen, ['open', 'closed']);
	assert.equal(dial.sockets.length, 1, 'reconnect false opens nothing on its own');

	client.close();
	await server.stop();
});

test('an ask made while the client is down goes out on the next socket', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });
	await settle();

	dial.sockets[0]!.close();
	await settle();
	const answer = client.ask('app/Board', { n: 2 });
	await settle();

	client.reconnect();
	assert.equal(await answer, 'answered {"n":2}');

	client.close();
	await server.stop();
});

test('a held ask with a timeout rejects timeout when no socket opens in time', async () => {
	const client = createClient({ url: 'ws://app.test/', open: () => idleSocket(), timeout: 30 });
	const error = await client.ask('app/Board').catch((e: unknown) => e);
	assert.equal(reasonOf(error), 'timeout');
	assert.match(String((error as Error).message), /Raise the timeout/);
	client.close();
});

test('an ask in flight when the socket drops rejects closed and is never sent twice', async () => {
	const asked: unknown[] = [];
	const { server, handlers } = await serverOf({
		'app/Slow': instance(() => ({
			call: (args: unknown) => new Promise(() => { asked.push(args); }),
		})),
	});
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });
	await settle();

	const answer = client.ask('app/Slow', { n: 3 });
	await settle();
	assert.deepEqual(asked, [{ n: 3 }], 'the ask reached the server');

	dial.sockets[0]!.close();
	assert.equal(reasonOf(await answer.catch((e: unknown) => e)), 'closed');

	client.reconnect();
	await settle();
	assert.deepEqual(asked, [{ n: 3 }], 'an ask that may have had a side effect is not repeated');

	client.close();
	await server.stop();
});

test('a closed client rejects every held ask and every new one', async () => {
	const client = createClient({ url: 'ws://app.test/', open: () => idleSocket() });
	const held = client.ask('app/Board');
	client.close();

	assert.equal(reasonOf(await held.catch((e: unknown) => e)), 'closed');
	const fresh = await client.ask('app/Board').catch((e: unknown) => e);
	assert.equal(reasonOf(fresh), 'closed');
	assert.match(String((fresh as Error).message), /Make a new client with createClient/);
	client.close();
});

test('a reconnect re-shares the same document object and pulls the server state onto it', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	const shared = client.share<Board>('board');
	const document = await shared.ready;
	const titles: unknown[] = [];
	observer(document).path('title').effect((value) => titles.push(value));
	assert.equal(document.title, 'first');

	dial.sockets[0]!.close();
	await settle();
	assert.equal(client.status.get(), 'closed');
	state.board.title = 'written while the client was down';

	await after(700);
	await settle(20);

	assert.equal(client.status.get(), 'open');
	assert.equal(state.hooks, 2, 'the server saw a second connection');
	assert.equal(shared.document, document, 'the page still holds the same object');
	assert.equal(document.title, 'written while the client was down');
	assert.deepEqual(titles, ['first', 'written while the client was down'],
		'the reconnect reached the watcher as an ordinary change');

	client.close();
	await server.stop();
});

test('a root mismatch after a reconnect reaches the handler, and a drop does not', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });

	const faults: string[] = [];
	const shared = client.share<Board>('board', undefined, { fault: (reason) => faults.push(reason) });
	await shared.ready;

	dial.sockets[0]!.close();
	await settle();
	assert.deepEqual(faults, [], 'the closed a dead link raises is the reconnect\'s business');

	// The server now holds a different document under that name.
	state.board = boardOf('another board entirely');
	client.reconnect();
	await settle(20);
	assert.deepEqual(faults, ['root-mismatch']);

	client.close();
	await server.stop();
});

test('stop takes a handle off the list re-shared on later sockets', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, reconnect: false });

	const shared = client.share<Board>('board');
	const document = await shared.ready;
	shared.stop();
	shared.stop();
	await settle();

	// The server's copy is untouched by a leave, and the page's own is left where it stands.
	state.board.title = 'moved on';
	await settle();
	assert.equal(document.title, 'first', 'a stopped share hears nothing more');

	client.reconnect();
	await settle(20);
	assert.equal(document.title, 'first', 'and is not shared again on the next socket');

	client.close();
	await server.stop();
});

test('close faults every live handle once and rejects a ready that never arrived', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	const faults: string[] = [];
	const arrived = client.share<Board>('board', undefined, { fault: (reason) => faults.push(reason) });
	await arrived.ready;
	const never = client.share<Board>('nothing-here');

	const socket = dial.sockets[0]!;
	let closes = 0;
	const shut = socket.close;
	// The harness wires two sockets to each other, so each end calls the other's close back;
	// what is counted is the times this one actually ended.
	socket.close = () => { if (socket.readyState !== 3) closes += 1; shut(); };

	client.close();
	client.close();

	assert.deepEqual(faults, ['closed']);
	assert.equal(reasonOf(await never.ready.catch((e: unknown) => e)), 'closed');
	assert.equal(client.status.get(), 'closed');
	assert.equal(closes, 1, 'the README says close() ends the socket, and it ends it once');
	assert.equal(socket.readyState, 3, 'and the socket reads closed');

	await settle();
	assert.equal(dial.sockets.length, 1, 'a closed client opens nothing more');

	await server.stop();
});

test('share on a closed client rejects ready with closed', async () => {
	const client = createClient({ url: 'ws://app.test/', open: () => idleSocket() });
	client.close();
	const shared = client.share<Board>('board');
	assert.equal(reasonOf(await shared.ready.catch((e: unknown) => e)), 'closed');
	assert.equal(shared.document, undefined);
	shared.stop();
	client.reconnect();
	assert.equal(client.status.get(), 'closed', 'reconnect on a closed client does nothing');
});

test('the default url is the page origin, and there is a refusal when there is none', () => {
	const held = (globalThis as { location?: unknown }).location;
	try {
		(globalThis as { location?: unknown }).location = { protocol: 'https:', host: 'app.example' };
		const opened: string[] = [];
		const secure = createClient({ open: (url) => { opened.push(url); return idleSocket(); } });
		secure.close();

		(globalThis as { location?: unknown }).location = { protocol: 'http:', host: 'app.example:3000' };
		const plain = createClient({ open: (url) => { opened.push(url); return idleSocket(); } });
		plain.close();

		assert.deepEqual(opened, ['wss://app.example/', 'ws://app.example:3000/']);

		delete (globalThis as { location?: unknown }).location;
		assert.throws(() => createClient({}), (error: { reason: string }) => error.reason === 'no-url');
	} finally {
		if (held === undefined) delete (globalThis as { location?: unknown }).location;
		else (globalThis as { location?: unknown }).location = held;
	}
});

test('progress, a refusal and the module\'s own reason cross as sync sends them', async () => {
	const { server, handlers } = await serverOf({
		'app/Report': instance(() => ({
			call: (args: unknown, _context: unknown, tools: { progress(value: unknown): void }) => {
				tools.progress('reading');
				if ((args as { bad?: boolean }).bad === true) {
					throw Object.assign(new Error('that month is not out yet'), { reason: 'too-early' });
				}
				return 'done';
			},
		})),
	});
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	const heard: unknown[] = [];
	assert.equal(await client.ask('app/Report', { bad: false }, { progress: (v) => heard.push(v) }), 'done');
	assert.deepEqual(heard, ['reading']);

	const refused = await client.ask('app/Report', { bad: true }).catch((e: unknown) => e);
	assert.equal(reasonOf(refused), 'too-early');
	assert.equal((refused as Error).message, 'that month is not out yet');

	client.close();
	await server.stop();
});

test('a timeout on the ask wins over the client\'s default', async () => {
	const client = createClient({ url: 'ws://app.test/', open: () => idleSocket(), timeout: 30_000 });
	const started = Date.now();
	assert.equal(reasonOf(await client.ask('app/Report', undefined, { timeout: 20 }).catch((e: unknown) => e)), 'timeout');
	assert.ok(Date.now() - started < 5_000, 'it waited the ask\'s 20 ms, not the client\'s 30 000');
	client.close();
});

test('accept and refused reach the page exactly as sync hands them over', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	const refusals: Array<{ mine: boolean; reasons: readonly { code: string }[] }> = [];
	const shared = client.share<Board>('board', undefined, {
		accept: () => [{ code: 'read-only', message: 'this page never takes a change' }],
		refused: (report) => refusals.push({ mine: report.mine, reasons: report.reasons }),
	});
	const document = await shared.ready;

	state.board.title = 'the server moved on';
	await settle();

	assert.equal(document.title, 'first', 'the commit the page refused did not apply');
	assert.deepEqual(refusals, [{ mine: false, reasons: [{ code: 'read-only', message: 'this page never takes a change' }] }]);

	client.close();
	await server.stop();
});

test('a fault handler that throws on close stops nothing else, and its error is raised as the page\'s own', async () => {
	const state = { board: boardOf('first'), hooks: 0 };
	const { server, handlers } = await boardServer(state);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open });

	const heard: string[] = [];
	const first = client.share<Board>('board', undefined, {
		fault: (reason) => { heard.push(`first:${reason}`); throw new Error('the page handler threw'); },
	});
	const second = client.share<Board>('nothing-here', undefined, {
		fault: (reason) => { heard.push(`second:${reason}`); },
	});
	await first.ready;

	const socket = dial.sockets[0]!;
	let closes = 0;
	const shut = socket.close;
	// The harness wires two sockets to each other, so each end calls the other's close back;
	// what is counted is the times this one actually ended.
	socket.close = () => { if (socket.readyState !== 3) closes += 1; shut(); };

	// An uncaught exception is the only place this error can land, so the test takes it there
	// rather than letting the runner attribute it to whatever ran next.
	const raised: string[] = [];
	process.setUncaughtExceptionCaptureCallback((error: Error) => { raised.push(error.message); });
	try {
		client.close();
		await settle();
	} finally {
		process.setUncaughtExceptionCaptureCallback(null);
	}

	assert.deepEqual(heard, ['first:closed', 'second:closed'], 'the handler after the throwing one still heard it');
	assert.equal(closes, 1, 'the socket ended even though a handler threw');
	assert.equal(socket.readyState, 3);
	assert.equal(client.status.get(), 'closed');
	assert.deepEqual(raised, ['the page handler threw'], 'the page\'s error is raised as the page\'s own');
	assert.equal(reasonOf(await second.ready.catch((e: unknown) => e)), 'closed');

	await server.stop();
});
