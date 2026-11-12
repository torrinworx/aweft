// The count before the gate, the count on an open connection, and the sliding window behind
// both (designs 272, 325).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import type { RequestError } from '@aweftjs/sync';

import { createServer, open, sliding } from '../src/index.ts';
import type { Connection, Limits, Offer, ServerError, ServerOptions } from '../src/index.ts';

import { asClient, connectTo, fakeListener, instance, peer, request, settle, sourceOf } from './helpers.ts';

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

// --- calls on an open connection (design 325) -----------------------------------------------

/**
 * A server whose one module keeps what it ran and what it was asked to offer. Its hook shares
 * `board` once `hooked` settles, so a test can have the page's open arrive first.
 */
const calling = async (calls: Limits['calls'] | 'unset', hooked: Promise<void> = Promise.resolve()) => {
	const ran: unknown[] = [];
	const offered: string[] = [];
	const failed: string[] = [];
	const listening = fakeListener();
	const board = createObject<Record<string, unknown>>({ title: 'board' });
	const server = createServer({
		sources: [sourceOf({
			'app/Run': instance(() => ({
				call: (args: unknown) => { ran.push(args); return 'ran'; },
				connection: async ({ link }: Connection) => {
					await hooked;
					link.share('board', board, { accept: () => [] });
				},
				offer: (name: string): Offer | undefined => {
					offered.push(name);
					return name.startsWith('note:') ? { document: createObject({ name }), accept: () => [] } : undefined;
				},
			})),
		})],
		gate: open, listener: listening.listener,
		handlers: { failed: (name, error) => failed.push(`${name}: ${String((error as Error).message)}`) },
		...(calls === 'unset' ? {} : { limits: { calls } }),
	});
	await server.start();
	return { server, handlers: listening.handlers(), ran, offered, failed };
};

const limited = (wait: number) => (e: RequestError): boolean => e.reason === 'limit' && e.message
	=== `limit: this address has made more calls than the window allows, and the next fits in ${String(wait)} s. Wait that long and ask again, or raise limits.calls in createServer.`;

test('the call at the count runs, the next is refused with limit and the wait, nothing runs, and the window sliding lets the same connection call again', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
	const { server, handlers, ran, failed } = await calling({ count: 3, windowMs: 60_000 });
	const client = asClient(await connectTo(handlers));
	assert.equal(await client.asks.ask('app/Run', 1), 'ran');
	t.mock.timers.tick(10_000);
	assert.equal(await client.asks.ask('app/Run', 2), 'ran');
	assert.equal(await client.asks.ask('app/Run', 3), 'ran', 'the call at the count');
	await assert.rejects(client.asks.ask('app/Run', 4), limited(50), 'the first call leaves the window in 50 s');
	// Refused before the module is looked up, so a name nothing answers is refused the same way.
	await assert.rejects(client.asks.ask('app/Nothing'), limited(50));
	assert.deepEqual(ran, [1, 2, 3], 'the refused call did not run');
	t.mock.timers.tick(49_999);
	await assert.rejects(client.asks.ask('app/Run', 5), limited(1), 'still inside the window');
	t.mock.timers.tick(1);
	assert.equal(await client.asks.ask('app/Run', 6), 'ran', 'the first call has left the window, and the socket was never closed');
	await assert.rejects(client.asks.ask('app/Run', 7), limited(10), 'and only one left');
	assert.deepEqual(ran, [1, 2, 3, 6]);
	assert.deepEqual(failed, [], 'a refusal is the caller\'s to hear, and is not reported');
	client.socket.close();
	await server.stop();
});

test('a second connection from the same address shares the count, another address has its own, and no address is one address', async () => {
	const { server, handlers, ran } = await calling({ count: 2, windowMs: 60_000 });
	const first = asClient(await connectTo(handlers));
	const second = asClient(await connectTo(handlers));
	assert.equal(await first.asks.ask('app/Run', 'first'), 'ran');
	assert.equal(await second.asks.ask('app/Run', 'second'), 'ran');
	await assert.rejects(second.asks.ask('app/Run', 'over'), (e: RequestError) => e.reason === 'limit');
	await assert.rejects(first.asks.ask('app/Run', 'over'), (e: RequestError) => e.reason === 'limit');

	const elsewhere = asClient(await connectTo(handlers, {}, { address: '10.0.0.9' }));
	assert.equal(await elsewhere.asks.ask('app/Run', 'elsewhere'), 'ran');

	const nowhere = asClient(await connectTo(handlers, {}, { address: undefined }));
	const nowhereToo = asClient(await connectTo(handlers, {}, { address: undefined }));
	assert.equal(await nowhere.asks.ask('app/Run', 'nowhere'), 'ran');
	assert.equal(await nowhereToo.asks.ask('app/Run', 'nowhere too'), 'ran');
	await assert.rejects(nowhere.asks.ask('app/Run', 'over'), (e: RequestError) => e.reason === 'limit');
	assert.deepEqual(ran, ['first', 'second', 'elsewhere', 'nowhere', 'nowhere too']);
	for (const client of [first, second, elsewhere, nowhere, nowhereToo]) client.socket.close();
	await server.stop();
});

test('an ask for an offered document counts with the calls, and over the count the page\'s share ends with limit and no module is asked', async (t) => {
	t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
	const { server, handlers, ran, offered } = await calling({ count: 2, windowMs: 60_000 });
	const client = asClient(await connectTo(handlers));
	assert.equal(await client.asks.ask('app/Run', 1), 'ran');
	assert.deepEqual(await client.link.share<Record<string, unknown>>('note:1').ready, { name: 'note:1' });
	const refused = await client.link.share('note:2').ready.then(() => undefined, (error: unknown) => error as RequestError);
	assert.equal(refused?.reason, 'limit');
	assert.match(String(refused?.message), /this address has made more calls than the window allows, and the next fits in 60 s/);
	await assert.rejects(client.asks.ask('app/Run', 2), (e: RequestError) => e.reason === 'limit', 'and a call is over the same count');
	assert.deepEqual(offered, ['note:1'], 'the refused ask reached no offer');
	assert.deepEqual(ran, [1]);
	client.socket.close();
	await server.stop();
});

test('a name a connection hook shared and the request named \'\' are not counted', async () => {
	let release: () => void = () => {};
	const { server, handlers, ran, offered } = await calling({ count: 1, windowMs: 60_000 }, new Promise((done) => { release = done; }));
	const client = asClient(await connectTo(handlers));
	// The page's open is on the server before the hook has shared, which is the order that
	// asks for an offer.
	const shared = client.link.share<Record<string, unknown>>('board');
	await settle();
	release();
	assert.equal((await shared.ready).title, 'board');
	for (let i = 0; i < 5; i++) assert.equal(await client.asks.ask(''), null, 'the probe is answered before any module');
	await settle();
	assert.equal(await client.asks.ask('app/Run', 1), 'ran', 'the one call the count allows is still there');
	await assert.rejects(client.asks.ask('app/Run', 2), (e: RequestError) => e.reason === 'limit');
	assert.deepEqual(offered, [], 'the hook\'s share paired with the page\'s, so nothing was asked to offer');
	assert.deepEqual(ran, [1]);
	client.socket.close();
	await server.stop();
});

test('an open for a name when no module declares offer is not counted', async () => {
	const listening = fakeListener();
	const server = createServer({
		sources: [sourceOf({ 'app/Echo': instance(() => ({ call: () => 'hi' })) })],
		gate: open, listener: listening.listener, limits: { calls: { count: 1, windowMs: 60_000 } },
	});
	await server.start();
	const client = asClient(await connectTo(listening.handlers()));
	for (const name of ['a', 'b', 'c']) client.link.share(name).ready.catch(() => undefined);
	await settle();
	assert.equal(await client.asks.ask('app/Echo'), 'hi', 'the one call the count allows is still there');
	client.socket.close();
	await server.stop();
});

test('the count is 6000 a minute with nothing set, and false removes it', async () => {
	const { server, handlers } = await calling('unset');
	const client = asClient(await connectTo(handlers));
	for (let i = 0; i < 6000; i++) assert.equal(await client.asks.ask('app/Run', i), 'ran');
	await assert.rejects(client.asks.ask('app/Run', 6000), (e: RequestError) => e.reason === 'limit', 'the 6001st');
	client.socket.close();
	await server.stop();

	const unbounded = await calling(false);
	const free = asClient(await connectTo(unbounded.handlers));
	for (let i = 0; i < 6100; i++) assert.equal(await free.asks.ask('app/Run', i), 'ran');
	free.socket.close();
	await unbounded.server.stop();
});

test('a bad count for calls is refused when the server is made, before anything listens', () => {
	for (const bad of [{ count: 0, windowMs: 1 }, { count: 10, windowMs: 0 }, { count: 1.5, windowMs: 1000 }, { count: 10 }]) {
		const listening = fakeListener();
		assert.throws(
			() => createServer({ sources: [], gate: open, listener: listening.listener, limits: { calls: bad as { count: number; windowMs: number } } }),
			(e: unknown) => reasonOf(e) === 'invalid-limit',
		);
		assert.equal(listening.started(), 0);
	}
});
