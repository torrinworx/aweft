// logs/Visits: the documents, the caps, write with and without a context, binding, the sweep,
// and the config it refuses (design 261).

import test from 'node:test';
import assert from 'node:assert/strict';

import { module, newStore, reasonOf } from './helpers.ts';
import { entry } from './helpers.ts';
import type { Visits } from '../src/modules/Visits.ts';
import { errors as errorsOf, visit as readVisit } from '../src/index.ts';

const visits = (store = newStore(), config: Record<string, unknown> = {}) => module<Visits>('Visits', store, {}, config);

test('a batch becomes one document, entries in the order they came, errors counted', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store);
	await instance.record({ visit: 'v1', entries: [entry('status', { status: 'open' }), entry('error', { message: 'boom' }), entry('rejection', { message: 'no' })] }, null);
	const seen = await readVisit(store, 'v1');
	assert.equal(seen?.kind, 'visit');
	assert.deepEqual(seen?.entries.map((e) => e.kind), ['status', 'error', 'rejection']);
	assert.equal(seen?.errors, 2, 'error and rejection count, status does not');
	await stop();
});

test('the visit facts are written once: user, build and browser from the first batch that carries them', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store);
	await instance.record({ visit: 'v2', build: 'abc', browser: { ua: 'Firefox' }, entries: [entry('status')] }, { user: 'u1', session: 's1' });
	await instance.record({ visit: 'v2', build: 'def', browser: { ua: 'Chrome' }, entries: [entry('status')] }, {});
	const seen = await readVisit(store, 'v2');
	assert.equal(seen?.user, 'u1');
	assert.equal(seen?.build, 'abc', 'the first build wins');
	assert.deepEqual(seen?.browser, { ua: 'Firefox' });
	await stop();
});

test('ended stamps endedAt', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store);
	await instance.record({ visit: 'v3', ended: true, entries: [entry('status')] }, null);
	assert.ok((await readVisit(store, 'v3'))!.endedAt! > 0);
	await stop();
});

test('write with a bound context lands in that visit; without one, in the process document', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store);
	const context = { user: null };
	instance.call({ visit: 'v4' }, context);
	await instance.write({ kind: 'failed', name: 'app/X', message: 'server side' }, context);
	await instance.write({ kind: 'failed', name: 'boot', message: 'no context' });
	assert.deepEqual((await readVisit(store, 'v4'))!.entries.map((e) => e.message), ['server side']);
	const process = await readVisit(store, instance.process);
	assert.equal(process?.kind, 'process');
	assert.deepEqual(process?.entries.map((e) => e.message), ['no context']);
	await stop();
});

test('a context binds by session too, so a request with that cookie lands in the same visit', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store);
	// The page's socket bound the session; a later HTTP batch carries only the cookie.
	instance.call({ visit: 'v5' }, { user: 'u1', session: 'tok' });
	await instance.record({ visit: 'v5', entries: [entry('status')] }, { user: 'u1', session: 'tok' });
	await instance.write({ kind: 'failed', message: 'by session' }, { user: 'u1', session: 'tok' });
	assert.equal(instance.visitOf({ session: 'tok' }), 'visit:v5');
	assert.deepEqual((await readVisit(store, 'v5'))!.entries.map((e) => e.kind), ['status', 'failed']);
	await stop();
});

test('an entry over the byte cap is trimmed but keeps its kind, and the rest of the batch still lands', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { entry: 200 });
	await instance.record({ visit: 'v6', entries: [entry('console', { level: 'warn', message: 'x'.repeat(500) }), entry('status')] }, null);
	const seen = await readVisit(store, 'v6');
	assert.deepEqual(seen?.entries.map((e) => e.kind), ['console', 'status'], 'the kind survives the cap');
	assert.equal(seen?.entries[0]!.capped, true);
	assert.ok(String(seen?.entries[0]!.message).length < 500 && String(seen?.entries[0]!.message).startsWith('x'), 'the message is trimmed to fit');
	assert.ok(JSON.stringify(seen?.entries[0]).length <= 200, 'the trimmed entry is within the budget');
	await stop();
});

test('an error over the byte cap is still counted and still found by the error readers', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { entry: 200 });
	await instance.record({ visit: 'v6b', entries: [entry('error', { message: 'boom', stack: 'y'.repeat(2000) })] }, null);
	const seen = await readVisit(store, 'v6b');
	assert.equal(seen?.errors, 1, 'a capped error still counts');
	assert.equal(seen?.entries[0]!.kind, 'error');
	const grouped = await errorsOf(store);
	assert.ok(grouped.some((group) => group.kind === 'error'), 'errors() still finds the capped error');
	await stop();
});

test('an entry over the byte cap loses its stack before its name, so a failed call still says which module', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { entry: 200 });
	await instance.record({ visit: 'v6c', entries: [entry('failed', { name: 'app/Save', message: 'boom', stack: 'z'.repeat(2000) })] }, null);
	const seen = (await readVisit(store, 'v6c'))!.entries[0]!;
	assert.equal(seen.name, 'app/Save', 'the name is small and stays');
	assert.equal(seen.message, 'boom');
	assert.equal(seen.stack, undefined, 'the stack is what went');
	assert.equal(seen.capped, true);
	await stop();
});

test('a visit fills to its cap, then holds one capped entry and drops the rest', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { perVisit: 3, batch: 10 });
	await instance.record({ visit: 'v7', entries: [entry('a'), entry('b'), entry('c'), entry('d')] }, null);
	const seen = await readVisit(store, 'v7');
	assert.equal(seen?.entries.length, 3);
	assert.deepEqual(seen?.entries.map((e) => e.kind), ['a', 'b', 'capped']);
	assert.equal(seen?.entries[2]!.of, 'c', 'the sentinel names the entry it stood in for');
	// A later batch adds nothing: the visit is full.
	await instance.record({ visit: 'v7', entries: [entry('e')] }, null);
	assert.equal((await readVisit(store, 'v7'))!.entries.length, 3);
	await stop();
});

test('the process document rotates when full: a fresh one takes the next entry, the full one keeps what it had', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { perVisit: 3 });
	const first = instance.process;
	for (const kind of ['a', 'b', 'c', 'd']) await instance.write({ kind });
	const second = instance.process;
	assert.notEqual(second, first, 'the module moved on to a fresh document');
	assert.deepEqual((await readVisit(store, first))!.entries.map((e) => e.kind), ['a', 'b'], 'the full one never needed a sentinel');
	assert.deepEqual((await readVisit(store, second))!.entries.map((e) => e.kind), ['c', 'd']);
	assert.equal((await readVisit(store, second))!.kind, 'process');
	// The full one is an ordinary old document from here: the sweep takes it once it is old enough.
	const handle = await store.open(first);
	(handle.root as { startedAt: number }).startedAt = 100;
	await store.settled(handle);
	await store.close(handle);
	assert.equal(await instance.sweep(), 1);
	assert.equal(await readVisit(store, first), undefined);
	assert.ok(await readVisit(store, second), 'the running document is spared');
	await stop();
});

test('two first writes to one visit in the same tick open it once, so the one close lets the store let it go', async () => {
	const opens: string[] = [];
	const closes: string[] = [];
	const inner = newStore();
	const store = new Proxy(inner, {
		get: (target, key) => {
			if (key === 'open') return async (doc: string, kind?: 'object' | 'array') => { opens.push(doc); return target.open(doc, kind); };
			if (key === 'close') return async (handle: { doc: string }) => { closes.push(handle.doc); return target.close(handle as never); };
			return Reflect.get(target, key) as unknown;
		},
	});
	const { instance, stop } = await visits(store);
	await Promise.all([
		instance.record({ visit: 'v10', entries: [entry('a')] }, null),
		instance.record({ visit: 'v10', entries: [entry('b')] }, null),
	]);
	await stop();
	assert.deepEqual(opens.filter((doc) => doc === 'visit:v10'), ['visit:v10'], 'opened once');
	assert.deepEqual(closes.filter((doc) => doc === 'visit:v10'), ['visit:v10'], 'closed once, which is all the store needs');
	assert.deepEqual((await readVisit(inner, 'v10'))!.entries.map((e) => e.kind), ['a', 'b']);
});

test('a batch larger than the batch cap is refused, and the visit is untouched', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { batch: 2 });
	await assert.rejects(instance.record({ visit: 'v8', entries: [entry('a'), entry('b'), entry('c')] }, null), (e: unknown) => reasonOf(e) === 'capped');
	assert.equal(await readVisit(store, 'v8'), undefined);
	await stop();
});

test('too many batches for one visit in a minute is refused', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { batchesPerMinute: 2 });
	await instance.record({ visit: 'v9', entries: [entry('a')] }, null);
	await instance.record({ visit: 'v9', entries: [entry('b')] }, null);
	await assert.rejects(instance.record({ visit: 'v9', entries: [entry('c')] }, null), (e: unknown) => reasonOf(e) === 'capped');
	await stop();
});

test('too many new visits in a minute is refused, and a held visit does not count again', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { visitsPerMinute: 2 });
	await instance.record({ visit: 'a', entries: [entry('x')] }, null);
	await instance.record({ visit: 'b', entries: [entry('x')] }, null);
	await instance.record({ visit: 'a', entries: [entry('y')] }, null);   // held, so free
	await assert.rejects(instance.record({ visit: 'c', entries: [entry('x')] }, null), (e: unknown) => reasonOf(e) === 'capped');
	await stop();
});

test('a malformed body or entry is refused, and a visit id has to be a plain id', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store);
	await assert.rejects(instance.record(42, null), (e: unknown) => reasonOf(e) === 'malformed');
	await assert.rejects(instance.record({ visit: 'v', entries: 'no' }, null), (e: unknown) => reasonOf(e) === 'malformed');
	await assert.rejects(instance.record({ visit: 'v', entries: [{ at: 1 }] }, null), (e: unknown) => reasonOf(e) === 'malformed');
	await assert.rejects(instance.record({ visit: '../secret', entries: [entry('x')] }, null), (e: unknown) => reasonOf(e) === 'malformed');
	await stop();
});

test('the sweep removes a visit older than keep and leaves a newer one and the process document', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { keep: 1 });
	await instance.record({ visit: 'old', entries: [entry('x', {}, Date.now())] }, null);
	// Age it: rewrite startedAt to two days ago through the store.
	const handle = await store.open('visit:old');
	(handle.root as { startedAt: number }).startedAt = Date.now() - 2 * 86_400_000;
	await store.settled(handle);
	await store.close(handle);
	await instance.record({ visit: 'new', entries: [entry('x')] }, null);
	assert.equal(await instance.sweep(), 1);
	assert.equal(await readVisit(store, 'old'), undefined);
	assert.ok(await readVisit(store, 'new'));
	assert.ok(await readVisit(store, instance.process), 'the running process is never swept');
	await stop();
});

test('the sweep spares the running process even when its own start is older than keep', async () => {
	const store = newStore();
	const { instance, stop } = await visits(store, { keep: 1 });
	// Age this process's own document into the sweep window.
	const handle = await store.open(instance.process);
	(handle.root as { startedAt: number }).startedAt = 100;
	await store.settled(handle);
	await store.close(handle);
	await instance.record({ visit: 'v', entries: [entry('x')] }, null);
	await instance.sweep();
	assert.ok(await readVisit(store, instance.process), 'the running process is never swept, however old its start');
	await stop();
});

test('a store that does not declare startedAt is refused at load, with the fix', async () => {
	const bare = newStore({ user: ['user'] });
	await assert.rejects(visits(bare), (e: unknown) => reasonOf(e) === 'undeclared');
});

test('a config value of the wrong type is refused at load, and a timer setting a timer cannot hold', async () => {
	await assert.rejects(visits(newStore(), { keep: 0 }), (e: unknown) => reasonOf(e) === 'invalid-config');
	await assert.rejects(visits(newStore(), { build: 42 }), (e: unknown) => reasonOf(e) === 'invalid-config');
	// Over 2^31 - 1 milliseconds Node fires a timer after one millisecond instead.
	await assert.rejects(visits(newStore(), { sweepMs: 2 ** 31 }), (e: unknown) => reasonOf(e) === 'invalid-config');
	await assert.rejects(visits(newStore(), { idleMs: 2 ** 31 }), (e: unknown) => reasonOf(e) === 'invalid-config');
	const { stop } = await visits(newStore(), { sweepMs: 2 ** 31 - 1 });
	await stop();
});
