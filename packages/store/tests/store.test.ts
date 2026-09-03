import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeCommit, idToText, type Commit } from '@aweftjs/codec';
import { alias, apply, atomic, createArray, createObject, idOf, observer, textIdOf } from '@aweftjs/core';

import { createStore, memoryDriver } from '../src/index.ts';
import type { Driver, Write } from '../src/index.ts';

type Doc = Record<string, unknown>;

const capture = (root: object, fn: () => void): Commit[] => {
	const out: Commit[] = [];
	const stop = observer(root).watch((c) => out.push({ deltas: [...c.deltas] }));
	fn();
	stop();
	return out;
};

test('a document persists what is written to it, and comes back', async () => {
	const driver = memoryDriver();
	const a = createStore({ driver });
	const board = await a.open('board');
	(board.root as Doc).title = 'a board';
	(board.root as Doc).count = 3;
	await a.settled(board);
	await a.close(board);

	// a second store over the same driver: nothing is shared but the storage
	const b = createStore({ driver });
	const again = await b.open('board');
	assert.equal((again.root as Doc).title, 'a board');
	assert.equal((again.root as Doc).count, 3);
});

test('a nested document comes back whole', async () => {
	const driver = memoryDriver();
	const a = createStore({ driver });
	const board = await a.open('nested');
	const root = board.root as Doc;
	const tasks = createArray<Doc>();
	atomic(() => { root.tasks = tasks; root.title = 'nested'; });
	tasks.push(createObject<Doc>({ title: 'first', done: false }));
	tasks.push(createObject<Doc>({ title: 'second', done: true }));
	await a.settled(board);

	const again = await createStore({ driver }).open('nested');
	const back = (again.root as Doc).tasks as Doc[];
	assert.equal(back.length, 2);
	assert.equal(back[0]!.title, 'first');
	assert.equal(back[1]!.done, true);
});

test('a commit writes only the rows its deltas name', async () => {
	const written: Write[] = [];
	const inner = memoryDriver();
	const driver: Driver = { ...inner, write: async (w) => { written.push(w); return inner.write(w); } };

	const store = createStore({ driver });
	const board = await store.open('sized');
	const root = board.root as Doc;
	const tasks = createArray<Doc>();
	atomic(() => { root.tasks = tasks; });
	for (let i = 0; i < 200; i++) tasks.push(createObject<Doc>({ n: i }));
	await store.settled(board);

	const before = written.length;
	(tasks[7] as Doc).n = 99;
	await store.settled(board);

	assert.equal(written.length, before + 1);
	// the changed task, and nothing else. Not the array, not the root, not the other 199.
	assert.deepEqual(written.at(-1)!.rows.map((r) => r.id), [textIdOf(tasks[7])]);
});

test('opening twice hands back the same document, and the last close tears it down', async () => {
	const store = createStore({ driver: memoryDriver() });
	const one = await store.open('shared');
	const two = await store.open('shared');
	assert.equal(one.root, two.root);

	(one.root as Doc).v = 1;
	await store.settled(one);
	await store.close(one);
	// still open for the second holder
	(two.root as Doc).v = 2;
	await store.settled(two);
	assert.equal((two.root as Doc).v, 2);
	await store.close(two);
});

test('the tail carries every commit, with its actor, and answers a resume', async () => {
	const store = createStore({ driver: memoryDriver() });
	const board = await store.open('tail');
	const root = board.root as Doc;
	root.a = 1;
	root.b = 2;
	await store.settled(board);

	const all = await store.since('tail', 0);
	assert.equal(all.length, 2);
	assert.deepEqual(all.map((h) => h.seq), [1, 2]);
	assert.deepEqual(all.map((h) => h.actor), ['local', 'local']);

	const missed = await store.since('tail', 1);
	assert.equal(missed.length, 1);
	assert.equal(missed[0]!.seq, 2);
	assert.ok(missed[0]!.commit.deltas.length > 0);
});

test('a received commit is applied and recorded under its author', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const doc = await store.open('remote');
	(doc.root as Doc).title = 'shared';
	await store.settled(doc);

	// A real remote commit: a replica built from this document's own history, mutated there.
	const replica = createObject<Doc>(undefined, idOf(doc.root)!);
	for (const h of await store.since('remote', 0)) apply(replica, h.commit);
	const remote = capture(replica, () => { replica.fromElsewhere = 'yes'; })[0]!;

	const seq = await store.receive(doc, remote, 'u_7');
	assert.equal((doc.root as Doc).fromElsewhere, 'yes');
	assert.equal(seq, 2);

	const history = await store.since('remote', 0);
	assert.equal(history.at(-1)!.actor, 'u_7');
	assert.equal(history[0]!.actor, 'local');

	// and it survives a reopen
	const again = await createStore({ driver }).open('remote');
	assert.equal((again.root as Doc).fromElsewhere, 'yes');
});

test('truncate bounds the history and leaves the document alone', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const board = await store.open('trunc');
	const root = board.root as Doc;
	for (let i = 0; i < 50; i++) root[`k${i}`] = i;
	await store.settled(board);
	assert.equal(await store.head('trunc'), 50);

	await store.truncate('trunc', 10);

	// Design 051: the tail no longer reaches back to 0, so it says so rather than handing
	// back the ten it kept as though they were everything since.
	await assert.rejects(
		() => store.since('trunc', 0),
		(error: Error & { reason?: string }) => {
			assert.equal(error.reason, 'truncated');
			return true;
		},
	);
	assert.equal((await store.since('trunc', 40)).length, 10, 'and asking from the floor works');

	const again = await createStore({ driver }).open('trunc');
	assert.equal((again.root as Doc).k0, 0);
	assert.equal((again.root as Doc).k49, 49);
});

test('a detached observable keeps its row, and a sweep is what collects it', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const board = await store.open('detach');
	const root = board.root as Doc;
	const list = createArray<Doc>();
	atomic(() => { root.list = list; });
	const item = createObject<Doc>({ title: 'the item' });
	list.push(item);
	await store.settled(board);
	assert.deepEqual(store.orphans(board), []);

	list.splice(0, 1);
	await store.settled(board);
	assert.deepEqual(store.orphans(board), [textIdOf(item)]);

	// still there in the same process: detaching is not deleting
	const back = list;
	back.push(item);
	await store.settled(board);
	assert.equal((back[0] as Doc).title, 'the item');
	assert.deepEqual(store.orphans(board), []);

	list.splice(0, 1);
	await store.settled(board);
	assert.equal(await store.sweep(board), 1);
	assert.deepEqual(store.orphans(board), []);
});

test('re-attaching an observable a reopened document does not hold is refused, not emptied', async () => {
	const driver = memoryDriver();
	const first = createStore({ driver });
	const board = await first.open('reattach');
	const root = board.root as Doc;
	const a = createArray<Doc>();
	const b = createArray<Doc>();
	atomic(() => { root.a = a; root.b = b; });
	const item = createObject<Doc>({ title: 'the item' });
	a.push(item);
	await first.settled(board);

	a.splice(0, 1);                                        // detached
	const reattach = capture(board.root, () => { b.push(item); })[0]!;
	b.splice(0, 1);                                        // detached again, and that is what persists
	await first.settled(board);
	await first.close(board);

	// Reopened: the document holds what is reachable, so not the item. Its row is still there.
	const second = createStore({ driver });
	const again = await second.open('reattach');
	assert.equal(((again.root as Doc).b as Doc[]).length, 0);
	assert.deepEqual(second.orphans(again), [textIdOf(item)]);

	await assert.rejects(
		() => second.receive(again, reattach, 'u_1'),
		(e: Error) => e.message.startsWith('detached-elsewhere') && (e as { reason?: string }).reason === 'detached-elsewhere',
	);

	// and the refusal changed nothing
	assert.equal(((again.root as Doc).b as Doc[]).length, 0);
});

test('a failed write surfaces on settled rather than being swallowed', async () => {
	const inner = memoryDriver();
	let fail = false;
	const driver: Driver = {
		...inner,
		write: async (w) => { if (fail) throw new Error('disk is on fire'); return inner.write(w); },
	};
	const store = createStore({ driver });
	const board = await store.open('failing');
	(board.root as Doc).ok = 1;
	await store.settled(board);

	fail = true;
	(board.root as Doc).lost = 2;
	await assert.rejects(() => store.settled(board), /disk is on fire/);
});

test('remove forgets the document', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const board = await store.open('gone');
	(board.root as Doc).v = 1;
	await store.settled(board);
	await store.remove('gone');

	const again = await createStore({ driver }).open('gone');
	assert.equal((again.root as Doc).v, undefined);
	assert.equal(await store.head('gone'), 0);
});

test('an array root and a map root both round trip', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const list = await store.open('as-array', 'array');
	(list.root as unknown as string[]).push('one', 'two');
	await store.settled(list);

	const again = await createStore({ driver }).open('as-array', 'array');
	assert.deepEqual([...(again.root as unknown as string[])], ['one', 'two']);
});

test('the driver refuses to be used after it is closed', async () => {
	const store = createStore({ driver: memoryDriver() });
	const board = await store.open('closing');
	(board.root as Doc).v = 1;
	await store.settled(board);
	await store.stop();
	await assert.rejects(() => store.open('closing'), /closed/);
});

test('encodeCommit round trips through the tail unchanged', async () => {
	const store = createStore({ driver: memoryDriver() });
	const board = await store.open('bytes');
	const commits = capture(board.root, () => { (board.root as Doc).x = 'y'; });
	await store.settled(board);
	const held = await store.since('bytes', 0);
	assert.deepEqual(encodeCommit(held[0]!.commit), encodeCommit(commits[0]!));
	void idToText; void idOf;
});

test('a map root round trips', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const held = await store.open('as-map', 'map');
	const map = held.root as unknown as { add(v: unknown): void; size: number };
	map.add(createObject<Doc>({ title: 'in a map' }));
	await store.settled(held);

	const again = await createStore({ driver }).open('as-map', 'map');
	const back = again.root as unknown as { size: number; values(): Iterable<Doc> };
	assert.equal(back.size, 1);
	assert.equal([...back.values()][0]!.title, 'in a map');
});

test('a driver that will neither create nor hold a document is reported, not worked around', async () => {
	const inner = memoryDriver();
	const driver: Driver = { ...inner, create: async () => false, read: async () => null };
	await assert.rejects(() => createStore({ driver }).open('nowhere'), /would not create/);
});

test('an alias is persisted as an alias, and moves nothing', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const board = await store.open('aliased');
	const root = board.root as Doc;
	const holder = createObject<Doc>();
	atomic(() => { root.holder = holder; });
	const x = createObject<Doc>({ v: 1 });
	holder.x = x;
	root.namesIt = alias(x);
	await store.settled(board);

	const again = await createStore({ driver }).open('aliased');
	const back = again.root as Doc;
	assert.equal(((back.holder as Doc).x as Doc).v, 1);
	assert.equal(back.namesIt, (back.holder as Doc).x, 'an alias names the same observable');
	assert.deepEqual(store.orphans(board), [], 'an alias is not an attach edge, so nothing is orphaned');
});

test('removing a slot, and removing bytes, both round trip', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const board = await store.open('removing');
	const root = board.root as Doc;
	root.keep = 'yes';
	root.bytes = new Uint8Array([1, 2, 3]);
	root.gone = 'for now';
	await store.settled(board);
	delete root.gone;
	await store.settled(board);

	const again = (await createStore({ driver }).open('removing')).root as Doc;
	assert.equal(again.keep, 'yes');
	assert.deepEqual([...(again.bytes as Uint8Array)], [1, 2, 3]);
	assert.ok(!('gone' in again), 'a removed slot stays removed');
});

test('a slot written twice in one commit keeps the last value', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const board = await store.open('atomic');
	const root = board.root as Doc;
	atomic(() => { root.a = 1; root.b = 2; root.a = 3; });
	await store.settled(board);

	const again = (await createStore({ driver }).open('atomic')).root as Doc;
	assert.equal(again.a, 3);
	assert.equal(again.b, 2);
	assert.equal(await store.head('atomic'), 1, 'an atomic block is one commit');
});

test('a commit naming an observable the document never held changes nothing', async () => {
	const store = createStore({ driver: memoryDriver() });
	const a = await store.open('one');
	const b = await store.open('two');
	const stray = capture(b.root, () => { (b.root as Doc).v = 1; })[0]!;
	await store.settled(b);

	await assert.rejects(() => store.receive(a, stray, 'u_1'), /unreachable/);
	assert.equal((a.root as Doc).v, undefined);
});
