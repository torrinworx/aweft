// The one-time links under the two mail modules: the sweep, and two takes of one token
// (design 290). White-box, because the sweep and the race are not reachable through a route
// at a pace a test can hold.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic } from '@aweftjs/core';

import { links } from '../src/links.ts';

import { newStore, settle } from './helpers.ts';

test('the sweep removes a link past its end, keeps a live one, and touches no document of another prefix', async () => {
	const store = newStore();
	const held = links(store, 'verify', 30, 3_600_000);
	const other = links(store, 'reset', 3_600_000, 3_600_000);
	const soon = await held.issue('u_1');
	const later = await other.issue('u_1');
	// A session that ended long ago carries an old `expires` too, and is the session sweep's.
	const session = await store.open('session:AAAAAAAAAAAAAAAAAAAAAA');
	atomic(() => { Object.assign(session.root, { user: 'u_1', expires: 1, status: 'revoked', createdAt: 1 }); });
	await store.settled(session);
	await store.close(session);

	assert.equal(await held.sweep(), 0, 'nothing has ended yet');
	await new Promise((done) => setTimeout(done, 40));
	assert.equal(await held.sweep(), 1);
	assert.equal(await store.head(`verify:${soon}`), 0, 'the ended link is gone');
	assert.notEqual(await store.head(`reset:${later}`), 0, 'the other prefix is not this sweep\'s');
	assert.notEqual(await store.head('session:AAAAAAAAAAAAAAAAAAAAAA'), 0, 'and neither is a session');
	assert.equal(await held.take(soon), undefined);
	assert.deepEqual(await other.take(later), { user: 'u_1' });
	held.stop();
	other.stop();
	await store.stop();
});

test('a taken link is kept, marked, and answers taken until its end; then the sweep removes it like any other', async () => {
	const store = newStore();
	const held = links(store, 'verify', 30, 3_600_000);
	const token = await held.issue('u_1');
	assert.deepEqual(await held.take(token), { user: 'u_1' });
	assert.notEqual(await store.head(`verify:${token}`), 0, 'the document stays (design 294)');
	assert.deepEqual(await held.peek(token), { taken: true });
	assert.deepEqual(await held.take(token), { taken: true }, 'a second take is told it was taken, not that there was nothing');
	assert.equal(await held.peek('AAAAAAAAAAAAAAAAAAAAAA'), undefined, 'a token nobody issued is nothing');
	assert.equal(await held.peek([token]), undefined, 'and a list holding a token is not a token, whatever it spells');
	assert.equal(await held.take('AAAAAAAAAAAAAAAAAAAAAA'), undefined);
	assert.equal(await store.head('verify:AAAAAAAAAAAAAAAAAAAAAA'), 0, 'and a guess at one writes nothing');
	// A document under the prefix that another writer left half-made names no link.
	const half = await store.open('verify:BBBBBBBBBBBBBBBBBBBBBB');
	atomic(() => { Object.assign(half.root, { user: 'u_1', createdAt: 1 }); });
	await store.settled(half);
	await store.close(half);
	assert.equal(await held.peek('BBBBBBBBBBBBBBBBBBBBBB'), undefined, 'no end, no link');
	await new Promise((done) => setTimeout(done, 40));
	assert.equal(await held.peek(token), undefined, 'past its end it is nothing, swept or not');
	assert.equal(await held.sweep(), 1, 'the sweep removes the tombstone on the same rule as a live link');
	assert.equal(await store.head(`verify:${token}`), 0);
	held.stop();
	await store.stop();
});

test('two takes of one token in flight together hand the user to one of them', async () => {
	const store = newStore();
	const held = links(store, 'reset', 3_600_000, 3_600_000);
	const token = await held.issue('u_1');
	const [a, b] = await Promise.all([held.take(token), held.take(token)]);
	assert.deepEqual([a, b].filter((one) => one !== undefined && 'user' in one).length, 1, `one take wins: ${JSON.stringify(a)}, ${JSON.stringify(b)}`);
	assert.deepEqual([a, b].filter((one) => one !== undefined && 'taken' in one).length, 1, 'and the other is told it lost');
	await settle();
	assert.notEqual(await store.head(`reset:${token}`), 0);
	assert.deepEqual(await held.peek(token), { taken: true });
	held.stop();
	await store.stop();
});
