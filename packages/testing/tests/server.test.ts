// The server harness: a real server with real modules, on a listener that opens nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fromBundle } from '@aweftjs/modules';
import { open } from '@aweftjs/server';

import { loadServer } from '../src/index.ts';

/** One module with a route and a call, which is the smallest thing worth booting. */
const Board = {
	default: () => ({
		routes: {
			'GET /api/board': () => new Response('the board', { status: 200 }),
		},
		call: (asked: unknown) => ({ heard: asked }),
	}),
};

/** A second module, so a call with arguments has somewhere to go. */
const Say = { default: () => ({ call: (said: unknown) => ({ heard: said }) }) };

const sources = [fromBundle({ 'board/Board': Board, 'board/Say': Say })];

test('a route is answered through the same handshake a listener would use', async () => {
	const server = await loadServer({ sources, gate: open });
	const answer = await server.fetch('/api/board');
	assert.equal(answer.status, 200);
	assert.equal(await answer.text(), 'the board');
	await server.stop();
});

test('no route match is 404, not a throw', async () => {
	const server = await loadServer({ sources, gate: open });
	assert.equal((await server.fetch('/api/nothing')).status, 404);
	await server.stop();
});

test('a socket connection reaches the modules and carries the headers it was opened with', async () => {
	const server = await loadServer({ sources, gate: open });
	const connected = await server.open({ headers: { cookie: 'session=abc' } });
	assert.equal(connected.request.headers.get('cookie'), 'session=abc');
	assert.equal(connected.socket.readyState, 1);
	await server.stop();
});

test('a gate that refuses makes open throw with the status, and opens no socket', async () => {
	const shut = {
		identify: () => ({ refused: [{ code: 'anonymous', message: 'nobody is signed in' }] }),
		access: () => [],
	};
	const server = await loadServer({ sources, gate: shut });
	await assert.rejects(
		() => server.open(),
		(error: { reason?: string; status?: number }) => {
			assert.equal(error.reason, 'handshake-refused');
			assert.equal(error.status, 401, 'an unidentified handshake is unauthorized, not forbidden');
			return true;
		},
	);
	await server.stop();
});

test('a stopped server accepts nothing, and stopping twice is not an error', async () => {
	const server = await loadServer({ sources, gate: open });
	assert.equal((await server.fetch('/api/board')).status, 200);

	await server.stop();
	await server.stop();

	for (const reach of [() => server.fetch('/api/board'), () => server.open()]) {
		await assert.rejects(reach, (error: { reason?: string }) => {
			assert.equal(error.reason, 'server-stopped');
			return true;
		});
	}
});

test('the link and the call channel on a connection are both live', async () => {
	const server = await loadServer({ sources, gate: open });
	const page = await server.open();

	assert.deepEqual(await page.asks.ask('board/Say', 'hi'), { heard: 'hi' });
	await assert.rejects(() => page.asks.ask('board/Nothing'), 'a module nobody loaded is missing');
	assert.notEqual(page.link, undefined, 'a link is connected over the same socket');
	assert.deepEqual(page.socket.sent.length > 0, true, 'both planes wrote to the one socket');
	await server.stop();
});
