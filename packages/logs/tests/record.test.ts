// logs/Record: the one route, the identity it stamps, and what a bad or over-cap batch answers
// (design 261).

import test from 'node:test';
import assert from 'node:assert/strict';

import { connectTo, jsonRequest, newStore, peer, request, settle, signUp, started } from './helpers.ts';
import { visit as readVisit } from '../src/index.ts';

test('a batch posts, is kept, and the user is stamped from the cookie and kept across a sign-out', async () => {
	const store = newStore();
	const { handlers, server } = await started({}, { store, withAuth: true });
	const { user, cookie } = await signUp(handlers, 'ada@example.com');

	const answer = await handlers.request(jsonRequest('/api/logs', { visit: 'v1', build: 'abc', browser: { ua: 'Firefox' }, entries: [{ at: Date.now(), kind: 'status', status: 'open' }] }, cookie), peer);
	assert.equal(answer.status, 200);
	assert.deepEqual(await answer.json(), { kept: 1 });

	// A later anonymous batch (signed out) does not clear the user already recorded.
	await handlers.request(jsonRequest('/api/logs', { visit: 'v1', entries: [{ at: Date.now(), kind: 'status', status: 'closed' }] }), peer);
	const seen = await readVisit(store, 'v1');
	assert.equal(seen?.user, user);
	assert.equal(seen?.build, 'abc');
	assert.deepEqual(seen?.browser, { ua: 'Firefox' });
	assert.equal(seen?.entries.length, 2);
	await server.stop();
});

test('an anonymous page may post, because the route is public', async () => {
	const { handlers, server } = await started({}, { withAuth: true });
	const answer = await handlers.request(jsonRequest('/api/logs', { visit: 'anon', entries: [{ at: Date.now(), kind: 'error', message: 'x' }] }), peer);
	assert.equal(answer.status, 200);
	await server.stop();
});

test('a body that is not JSON is 400, and one that is not a batch is 400', async () => {
	const { handlers, server } = await started({});
	const bad = await handlers.request(request('/api/logs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' }), peer);
	assert.equal(bad.status, 400);
	const noEntries = await handlers.request(jsonRequest('/api/logs', { visit: 'v', entries: 'no' }), peer);
	assert.equal(noEntries.status, 400);
	assert.deepEqual((await noEntries.json() as { reasons: { code: string }[] }).reasons[0]!.code, 'malformed');
	await server.stop();
});

test('a batch over a cap is 429', async () => {
	const { handlers, server } = await started({}, { config: { './logs/Visits.ts': { config: { batch: 1 } } } });
	const answer = await handlers.request(jsonRequest('/api/logs', { visit: 'v', entries: [{ at: 1, kind: 'a' }, { at: 2, kind: 'b' }] }), peer);
	assert.equal(answer.status, 429);
	assert.equal((await answer.json() as { reasons: { code: string }[] }).reasons[0]!.code, 'capped');
	await server.stop();
});

test('the socket binds the connection to a visit, so a server event lands in it', async () => {
	const store = newStore();
	const { handlers, server } = await started({
		'app/Boom': { default: () => ({ public: true, call: () => { throw new Error('module blew up'); } }) },
	}, { store });
	const client = await connectTo(handlers);
	await settle();
	// The recorder's own first move: name the visit for this connection.
	await client.asks.ask('logs/Visits', { visit: 'v1' });
	await client.asks.ask('app/Boom').catch(() => undefined);
	await settle();
	client.socket.close();
	await settle();
	const seen = await readVisit(store, 'v1');
	const call = seen?.entries.find((e) => e.kind === 'call' && e.name === 'app/Boom');
	assert.ok(call, 'the failed call landed in the bound visit');
	assert.equal(call?.ok, false);
	await server.stop();
});
