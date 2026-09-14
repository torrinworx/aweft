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
	assert.equal(await other.take(later), 'u_1');
	held.stop();
	other.stop();
	await store.stop();
});

test('two takes of one token in flight together hand the user to one of them', async () => {
	const store = newStore();
	const held = links(store, 'reset', 3_600_000, 3_600_000);
	const token = await held.issue('u_1');
	const [a, b] = await Promise.all([held.take(token), held.take(token)]);
	assert.deepEqual([a, b].filter((one) => one === 'u_1').length, 1, `one take wins: ${String(a)}, ${String(b)}`);
	await settle();
	assert.equal(await store.head(`reset:${token}`), 0);
	assert.equal(await held.peek(token), undefined);
	held.stop();
	await store.stop();
});
