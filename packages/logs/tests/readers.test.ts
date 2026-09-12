// The readers over a memory store: one visit, the visits that match, errors grouped, prune.

import test from 'node:test';
import assert from 'node:assert/strict';

import { entry, module, newStore } from './helpers.ts';
import type { Visits } from '../src/modules/Visits.ts';
import { errors, prune, visit, visits } from '../src/index.ts';

const seed = async (store = newStore()) => {
	const { instance } = await module<Visits>('Visits', store);
	return instance;
};

test('visit reads one document with its entries in time order, and undefined for none', async () => {
	const store = newStore();
	const keeper = await seed(store);
	await keeper.record({ visit: 'v1', entries: [entry('b', {}, 200), entry('a', {}, 100)] }, { user: 'u1' });
	const seen = await visit(store, 'v1');
	assert.deepEqual(seen?.entries.map((e) => e.kind), ['a', 'b']);
	assert.equal(seen?.user, 'u1');
	assert.equal(await visit(store, 'missing'), undefined);
});

test('visits lists by user, build and error, newest first, without opening', async () => {
	const store = newStore();
	const keeper = await seed(store);
	await keeper.record({ visit: 'old', build: 'a', entries: [entry('status', {}, 100)] }, { user: 'u1' });
	await keeper.record({ visit: 'new', build: 'b', entries: [entry('error', { message: 'x' }, 200)] }, { user: 'u1' });
	await keeper.record({ visit: 'other', build: 'b', entries: [entry('status', {}, 300)] }, { user: 'u2' });

	const theirs = await visits(store, { user: 'u1' });
	assert.deepEqual(theirs.map((v) => v.id), ['visit:new', 'visit:old'], 'newest first');
	assert.deepEqual((await visits(store, { build: 'b' })).map((v) => v.id).sort(), ['visit:new', 'visit:other']);
	assert.deepEqual((await visits(store, { errors: true })).map((v) => v.id), ['visit:new']);
});

test('errors groups a message across builds with count, visit count, first and last seen', async () => {
	const store = newStore();
	const keeper = await seed(store);
	await keeper.record({ visit: 'v1', build: 'a', entries: [entry('error', { message: 'boom' }, 100), entry('error', { message: 'boom' }, 150)] }, {});
	await keeper.record({ visit: 'v2', build: 'a', entries: [entry('error', { message: 'boom' }, 300)] }, {});
	await keeper.record({ visit: 'v3', build: 'b', entries: [entry('error', { message: 'boom' }, 400)] }, {});

	const grouped = await errors(store);
	const onA = grouped.find((g) => g.build === 'a' && g.message === 'boom')!;
	assert.equal(onA.count, 3);
	assert.equal(onA.visits, 2);
	assert.equal(onA.firstSeen, 100);
	assert.equal(onA.lastSeen, 300);
	assert.equal(grouped.filter((g) => g.message === 'boom').length, 2, 'a and b are separate groups');
});

test('prune removes documents older than the cutoff and answers how many', async () => {
	const store = newStore();
	const keeper = await seed(store);
	await keeper.record({ visit: 'old', entries: [entry('x', {}, 100)] }, {});
	const handle = await store.open('visit:old');
	(handle.root as { startedAt: number }).startedAt = 100;
	await store.settled(handle);
	await store.close(handle);
	await keeper.record({ visit: 'fresh', entries: [entry('x')] }, {});
	assert.equal(await prune(store, 1000), 1);
	assert.equal(await visit(store, 'old'), undefined);
	assert.ok(await visit(store, 'fresh'));
});

test('errors filters by build and by since, and visits never lists a process document', async () => {
	const store = newStore();
	const keeper = await seed(store);
	await keeper.record({ visit: 'a', build: 'x', entries: [entry('error', { message: 'old' })] }, {});
	await keeper.record({ visit: 'b', build: 'y', entries: [entry('error', { message: 'new' })] }, {});
	// Age visit a so a `since` cutoff can exclude it; startedAt is the visit's creation time.
	const aged = await store.open('visit:a');
	(aged.root as { startedAt: number }).startedAt = 100;
	await store.settled(aged);
	await store.close(aged);

	assert.deepEqual((await errors(store, { build: 'y' })).map((g) => g.message), ['new']);
	assert.deepEqual((await errors(store, { since: 1000 })).map((g) => g.message), ['new']);
	assert.ok((await visits(store, {})).every((v) => v.id.startsWith('visit:')), 'a process document is not a visit');
});

test('a visit with no browser and no endedAt reads those back as null', async () => {
	const store = newStore();
	const keeper = await seed(store);
	await keeper.record({ visit: 'v', entries: [entry('status')] }, {});
	const seen = await visit(store, 'v');
	assert.equal(seen?.browser, null);
	assert.equal(seen?.endedAt, null);
	assert.equal(seen?.build, null);
});
