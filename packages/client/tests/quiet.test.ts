// A socket that dies without closing (design 317). Cutting both ends' peer makes the pair a
// connection whose packets go nowhere and whose close never arrives, which is what a dropped
// Wi-Fi does to a WebSocket: nothing is heard and nothing is said.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import { open } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';
import type { PairedSocket } from '@aweftjs/testing';

import { createClient } from '../src/index.ts';

import { dialer, instance, opens, reasonOf, serverOf, socketPair } from './helpers.ts';

type Board = { title: string };

const QUIET = 200;
const after = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * Packets on this socket go nowhere from here on, in both directions, and no close is raised:
 * closing a dead connection leaves it closing, with no close event, as a browser's does until the
 * TCP stack gives up.
 */
const silence = (socket: PairedSocket): void => {
	const far = socket.peer;
	socket.peer = undefined;
	if (far !== undefined) far.peer = undefined;
	socket.close = () => { socket.readyState = 2; };
};

/** Every probe this end sent: a request frame named ''. */
const probes = (socket: PairedSocket): number =>
	socket.sent.filter((data) => typeof data === 'string' && (JSON.parse(data) as { name?: unknown }).name === '').length;

const appServer = (board: Board, slowMs = 0) => serverOf({
	'app/Board': instance(() => ({
		connection: (connection: Connection<unknown>) => { connection.link.share('board', board, open); },
		call: async () => { await after(slowMs); return 'answered'; },
	})),
	'app/Never': instance(() => ({ call: () => new Promise(() => {}) })),
});

test('an ask on a socket that went quiet rejects closed, and a new socket answers the next one', async () => {
	const { server, handlers } = await appServer(createObject<Board>({ title: 'first' }));
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, quiet: QUIET });
	await client.share<Board>('board').ready;

	silence(dial.sockets[0]!);
	const started = Date.now();
	const lost = await Promise.race([
		client.ask('app/Board', {}).then(() => 'answered', (error: unknown) => reasonOf(error)),
		after(QUIET * 6).then(() => 'still waiting'),
	]);
	const took = Date.now() - started;

	assert.equal(lost, 'closed', 'the ask hears the drop rather than waiting for an answer that cannot come');
	assert.ok(took >= QUIET * 2 && took < QUIET * 4, `heard after the silence and an unanswered probe, ${String(took)} ms`);
	assert.equal(probes(dial.sockets[0]!), 1, 'one probe went out before the socket was dropped');
	assert.ok(dial.sockets.length >= 2, 'a new socket was made');
	assert.equal(await client.ask('app/Board', {}), 'answered', 'and the next ask goes out on it');
	assert.equal(client.status.get(), 'open');

	client.close();
	await server.stop();
});

test('a share still waiting when the socket goes quiet arrives on the next socket', async () => {
	const board = createObject<Board>({ title: 'after the drop' });
	const { server, handlers } = await appServer(board);
	const dial = dialer(handlers);
	const first = dial.open;
	let cut = false;
	// The first socket opens and is silenced before its share's document can arrive.
	const client = createClient({
		url: 'ws://app.test/',
		quiet: QUIET,
		open: () => {
			const socket = first() as PairedSocket;
			if (!cut) { cut = true; silence(socket); }
			return socket;
		},
	});
	const shared = client.share<Board>('board');
	const arrived = await Promise.race([shared.ready.then((doc) => doc.title), after(QUIET * 6).then(() => 'still waiting')]);

	assert.equal(arrived, 'after the drop', 'the share was re-shared on the socket made after the probe went unanswered');
	assert.equal(probes(dial.sockets[0]!), 1);

	client.close();
	await server.stop();
});

test('a socket that answers its probe is kept while a slow ask finishes', async () => {
	const { server, handlers } = await appServer(createObject<Board>({ title: 'slow' }), QUIET * 4);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, quiet: QUIET });
	await client.share<Board>('board').ready;

	assert.equal(await client.ask('app/Board', {}), 'answered', 'a call slower than quiet is not cut short');
	assert.ok(probes(dial.sockets[0]!) >= 1, 'the silence was probed');
	assert.equal(dial.sockets.length, 1, 'and the answered probe kept the socket');

	client.close();
	await server.stop();
});

test('a socket nothing waits on is never probed, and quiet false never probes at all', async () => {
	const { server, handlers } = await appServer(createObject<Board>({ title: 'idle' }));
	const idle = dialer(handlers);
	const resting = createClient({ url: 'ws://app.test/', open: idle.open, quiet: QUIET });
	await resting.share<Board>('board').ready;
	assert.equal(await resting.ask('app/Board', {}), 'answered', 'an ask that was answered leaves nothing waiting');
	await after(QUIET * 4);
	assert.equal(probes(idle.sockets[0]!), 0, 'an idle tab says nothing');

	const off = dialer(handlers);
	const unwatched = createClient({ url: 'ws://app.test/', open: off.open, quiet: false });
	await unwatched.share<Board>('board').ready;
	silence(off.sockets[0]!);
	const outcome = await Promise.race([unwatched.ask('app/Never', {}).then(() => 'answered', () => 'rejected'), after(QUIET * 4).then(() => 'waiting')]);
	assert.equal(outcome, 'waiting', 'with quiet off the silence is never noticed');
	assert.equal(probes(off.sockets[0]!), 0);
	assert.equal(off.sockets.length, 1);

	resting.close();
	unwatched.close();
	await server.stop();
});

test('a socket that keeps delivering is never probed while a slow ask waits', async () => {
	const board = createObject<Board>({ title: 'busy' });
	const { server, handlers } = await appServer(board, QUIET * 3);
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, quiet: QUIET });
	await client.share<Board>('board').ready;

	// The server's copy changes four times per quiet period, so the socket is never silent.
	let n = 0;
	const busy = setInterval(() => { n += 1; board.title = `busy ${String(n)}`; }, QUIET / 4);
	assert.equal(await client.ask('app/Board', {}), 'answered');
	clearInterval(busy);
	assert.equal(probes(dial.sockets[0]!), 0, 'commits arriving are heard, so the slow ask needs no probe');

	client.close();
	await server.stop();
});

test('a far end that answers the probe missing, as one older than the probe does, keeps its socket', async () => {
	const sockets: ReturnType<typeof socketPair>[0][] = [];
	const client = createClient({
		url: 'ws://app.test/',
		quiet: QUIET,
		open: () => {
			const [near, far] = socketPair(0);
			sockets.push(near);
			far.addEventListener('message', (event) => {
				if (typeof event.data !== 'string') return;
				const frame = JSON.parse(event.data) as { id: number; name: string };
				if (frame.name === '') far.send(JSON.stringify({ id: frame.id, error: { reason: 'missing', message: 'nothing here answers' } }));
				else setTimeout(() => far.send(JSON.stringify({ id: frame.id, result: 'late' })), QUIET * 3);
			});
			queueMicrotask(() => { opens(near); });
			return near;
		},
	});

	assert.equal(await client.ask('app/Slow', {}), 'late', 'a probe answered missing is an answer all the same');
	assert.ok(probes(sockets[0]!) >= 1);
	assert.equal(sockets.length, 1, 'and the socket was kept');
	client.close();
});

test('an ask in flight on a dead socket rejects closed at once on reconnect() and on close(), not when a close event comes', async () => {
	const { server, handlers } = await appServer(createObject<Board>({ title: 'manual' }));
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, quiet: false });
	await client.share<Board>('board').ready;

	silence(dial.sockets[0]!);
	const first = client.ask('app/Board', {}).then(() => 'answered', (error: unknown) => reasonOf(error));
	client.reconnect();
	assert.equal(await Promise.race([first, after(QUIET).then(() => 'still waiting')]), 'closed', 'reconnect() ends the old socket\'s asks');
	assert.equal(await client.ask('app/Board', {}), 'answered', 'and the new socket answers');

	silence(dial.sockets.at(-1)!);
	const second = client.ask('app/Board', {}).then(() => 'answered', (error: unknown) => reasonOf(error));
	client.close();
	assert.equal(await Promise.race([second, after(QUIET).then(() => 'still waiting')]), 'closed', 'close() does too');
	await server.stop();
});

test('an ask made on a socket that was already quiet is dropped after one quiet period, not two', async () => {
	const { server, handlers } = await appServer(createObject<Board>({ title: 'idle first' }));
	const dial = dialer(handlers);
	const client = createClient({ url: 'ws://app.test/', open: dial.open, quiet: QUIET });
	await client.share<Board>('board').ready;

	silence(dial.sockets[0]!);
	await after(QUIET * 2);
	const started = Date.now();
	const lost = await Promise.race([client.ask('app/Board', {}).then(() => 'answered', (error: unknown) => reasonOf(error)), after(QUIET * 6).then(() => 'still waiting')]);
	const took = Date.now() - started;
	assert.equal(lost, 'closed');
	assert.ok(took >= QUIET && took < QUIET * 2, `the silence was already long, so only the probe's wait is left, ${String(took)} ms`);

	client.close();
	await server.stop();
});

test('a socket that was replaced stops its probe timer, so reconnects do not pile timers up', async () => {
	// The timers this client makes, counted through the globals it calls.
	const live = new Set<unknown>();
	const { setInterval: set, clearInterval: clear } = globalThis;
	globalThis.setInterval = ((fn: () => void, ms: number) => { const id = set(fn, ms); live.add(id); return id; }) as typeof setInterval;
	globalThis.clearInterval = ((id: Parameters<typeof clearInterval>[0]) => { live.delete(id); clear(id); }) as typeof clearInterval;
	try {
		const { server, handlers } = await appServer(createObject<Board>({ title: 'many sockets' }));
		const dial = dialer(handlers);
		const client = createClient({ url: 'ws://app.test/', open: dial.open, quiet: QUIET });
		await client.share<Board>('board').ready;
		for (let i = 0; i < 3; i++) {
			client.reconnect();
			await client.ask('app/Board', {});
		}
		await after(QUIET / 2);
		assert.equal(dial.sockets.length, 4);
		assert.equal(live.size, 1, 'only the open socket has a probe timer');
		client.close();
		await after(QUIET / 2);
		assert.equal(live.size, 0, 'and close() stops it');
		await server.stop();
	} finally {
		globalThis.setInterval = set;
		globalThis.clearInterval = clear;
	}
});
