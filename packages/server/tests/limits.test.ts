// The count before the gate, and the sliding window behind it (design 272).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createServer, open, sliding } from '../src/index.ts';
import type { ServerError, ServerOptions } from '../src/index.ts';

import { asClient, connectTo, fakeListener, instance, peer, request, sourceOf } from './helpers.ts';

const reasonOf = (e: unknown): string => String((e as { reason?: unknown }).reason);

test('sliding: at most count in any window, the oldest hit leaving frees one, and clear forgets a key', () => {
	const window = sliding({ count: 3, windowMs: 1000 });
	assert.deepEqual(window.take('a', 0), { ok: true });
	assert.deepEqual(window.take('a', 100), { ok: true });
	assert.deepEqual(window.take('a', 200), { ok: true });
	assert.deepEqual(window.take('a', 300), { ok: false, retryAfter: 1 }, 'the fourth inside the window');
	assert.deepEqual(window.take('b', 300), { ok: true }, 'another key has its own count');
	assert.deepEqual(window.take('a', 999), { ok: false, retryAfter: 1 }, 'still inside: the first hit leaves at 1000');
	assert.deepEqual(window.take('a', 1000), { ok: true }, 'the first hit has left the window');
	assert.deepEqual(window.take('a', 1001), { ok: false, retryAfter: 1 }, 'and only one left');
	window.clear('a');
	assert.deepEqual(window.take('a', 1001), { ok: true });
});

test('sliding: retryAfter is the whole seconds until the oldest hit leaves, never under one', () => {
	const window = sliding({ count: 1, windowMs: 10_000 });
	window.take('a', 0);
	assert.deepEqual(window.take('a', 500), { ok: false, retryAfter: 10 });
	assert.deepEqual(window.take('a', 9_900), { ok: false, retryAfter: 1 });
});

test('sliding: the window slides rather than resetting, so a burst at the edge is still counted', () => {
	const window = sliding({ count: 2, windowMs: 1000 });
	window.take('a', 900);
	window.take('a', 950);
	// A fixed window starting at 0 would have reset at 1000 and let two more through.
	assert.equal(window.take('a', 1050).ok, false);
	assert.equal(window.take('a', 1899).ok, false);
	assert.equal(window.take('a', 1900).ok, true);
});

test('sliding: a key seen only outside the window is dropped once the map is large', () => {
	const window = sliding({ count: 1, windowMs: 100 });
	for (let i = 0; i < 5000; i++) window.take(`k${i}`, 0);
	// Past the size where the map is swept, a take after the window drops every stale key, and
	// the keys taken then are the only ones held: their count is what a later take sees.
	assert.equal(window.take('fresh', 200).ok, true);
	assert.equal(window.take('k1', 200).ok, true, 'k1 was dropped, so it counts from nothing');
	assert.equal(window.take('k1', 201).ok, false);
});

test('sliding: a flood of distinct keys inside one window holds at most the cap, and a key at its count outlives it', () => {
	const window = sliding({ count: 2, windowMs: 60_000 });
	window.take('locked', 0);
	window.take('locked', 0);
	window.take('idle', 0);
	assert.equal(window.take('locked', 1).ok, false, 'locked is at its count');
	for (let i = 0; i < 70_000; i++) window.take(`flood-${String(i)}`, 1);
	// The flood let keys go, the oldest under their count first: idle went, locked did not.
	assert.equal(window.take('locked', 2).ok, false, 'a flood of fresh keys frees no locked key');
	assert.equal(window.take('idle', 2).ok, true, 'idle went and counts from nothing');
	assert.equal(window.take('flood-0', 2).ok, true, 'the oldest of the flood went too');
	assert.equal(window.take('flood-69999', 2).ok, true, 'the newest is still held, with room for one more');
	assert.equal(window.take('flood-69999', 2).ok, false);
});

test('sliding: with that many keys at their count, the oldest goes, so the bound on memory holds whatever the flood does', () => {
	const window = sliding({ count: 1, windowMs: 60_000 });
	window.take('victim', 0);
	for (let i = 0; i < 65_537; i++) window.take(`flood-${String(i)}`, 1);
	assert.equal(window.take('victim', 2).ok, true, 'every key was at its count, so the oldest went');
});

test('sliding: retryAfter is never more than the window, whatever the clock did', () => {
	const window = sliding({ count: 1, windowMs: 10_000 });
	window.take('a', 3_600_000);
	assert.deepEqual(window.take('a', 0), { ok: false, retryAfter: 10 }, 'a clock that moved back an hour');
});

test('sliding: a count that is not a whole number is refused', () => {
	assert.throws(() => sliding({ count: 2.5, windowMs: 1000 }), (e: ServerError) => e.reason === 'invalid-limit');
});

test('sliding: a count or window that is not a positive number is refused, and so is one over what a timer holds', () => {
	for (const bad of [{ count: 0, windowMs: 1 }, { count: -1, windowMs: 1 }, { count: Infinity, windowMs: 1 }, { count: 1, windowMs: 0 }, { count: 1, windowMs: 2_147_483_648 }, { count: 'many', windowMs: 1 }]) {
		assert.throws(() => sliding(bad as { count: number; windowMs: number }), (e: ServerError) => e.reason === 'invalid-limit');
	}
});

const started = async (options: Partial<ServerOptions> = {}) => {
	const listening = fakeListener();
	const server = createServer({
		sources: [sourceOf({ 'app/Echo': instance(() => ({ public: true, call: () => 'hi', routes: { 'GET /hi': () => new Response('hi') } })) })],
		gate: open, listener: listening.listener, ...options,
	});
	await server.start();
	return { server, handlers: listening.handlers() };
};

test('the request over the count in a window from one address is 429 with Retry-After, and another address still answers', async () => {
	const { handlers, server } = await started({ limits: { requests: { count: 3, windowMs: 60_000 } } });
	for (let i = 0; i < 3; i++) assert.equal((await handlers.request(request('/hi'), peer)).status, 200);
	const over = await handlers.request(request('/hi'), peer);
	assert.equal(over.status, 429);
	assert.equal(over.headers.get('retry-after'), '60');
	assert.deepEqual((await over.json() as { reasons: { code: string }[] }).reasons.map((r) => r.code), ['limit']);
	assert.equal((await handlers.request(request('/hi'), { address: '10.0.0.9' })).status, 200);
	await server.stop();
});

test('the handshake counts with the requests and is refused at the same count, and no socket opens', async () => {
	const { handlers, server } = await started({ limits: { requests: { count: 2, windowMs: 60_000 } } });
	assert.equal((await handlers.request(request('/hi'), peer)).status, 200);
	const client = asClient(await connectTo(handlers));
	assert.equal(await client.asks.ask('app/Echo'), 'hi');
	const refused = await connectTo(handlers);
	assert.ok(refused instanceof Response, 'the third is the handshake, refused');
	assert.equal(refused.status, 429);
	assert.equal(refused.headers.get('retry-after'), '60');
	client.socket.close();
	await server.stop();
});

test('the count is 600 a minute with nothing set, and false removes it', async () => {
	const { handlers, server } = await started();
	for (let i = 0; i < 600; i++) assert.equal((await handlers.request(request('/hi'), peer)).status, 200);
	assert.equal((await handlers.request(request('/hi'), peer)).status, 429, 'the 601st');
	await server.stop();

	const unbounded = await started({ limits: { requests: false } });
	for (let i = 0; i < 700; i++) assert.equal((await unbounded.handlers.request(request('/hi'), peer)).status, 200);
	await unbounded.server.stop();
});

test('a listener that knows no address counts everything it delivers as one', async () => {
	const { handlers, server } = await started({ limits: { requests: { count: 1, windowMs: 60_000 } } });
	assert.equal((await handlers.request(request('/hi'), { address: undefined })).status, 200);
	assert.equal((await handlers.request(request('/hi'), { address: undefined })).status, 429);
	await server.stop();
});

test('a bad count is refused when the server is made, before anything listens', () => {
	const listening = fakeListener();
	assert.throws(
		() => createServer({ sources: [], gate: open, listener: listening.listener, limits: { requests: { count: 0, windowMs: 1 } } }),
		(e: unknown) => reasonOf(e) === 'invalid-limit',
	);
	assert.equal(listening.started(), 0);
});
