// The behavioral corpus for store.
//
// Each case is a requirement this package must meet, taken from a class of failure a durable
// store is known to contain: a write that waits for someone to ask, a close that drops what
// was still queued, a refusal that half-landed, a short answer that reads like a complete one,
// and a handle that keeps answering after its document is gone. The corpus is append-only.
// Removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import { idToText, type Commit } from '@aweftjs/codec';
import { RefusedError, alias, atomic, createObject, idOf, intercept, observer, textIdOf } from '@aweftjs/core';

// The two codec functions through this package's own entry: a driver written against store
// reaches them there, and that is the seam under test.
import { createStore, decodeCommit, encodeCommit, memoryDriver, projectionOf } from '../src/index.ts';
import type { Driver, Write } from '../src/index.ts';

type Doc = Record<string, unknown>;

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

/** A driver that records every write it is handed, in order. */
const recording = (): { driver: Driver; writes: Write[] } => {
	const inner = memoryDriver();
	const writes: Write[] = [];
	return {
		writes,
		driver: { ...inner, write: async (w) => { writes.push(w); return inner.write(w); } },
	};
};

const oneCommit = (root: object, edit: () => void): Commit => {
	const out: Commit[] = [];
	const stop = observer(root).watch((change) => out.push({ deltas: [...change.deltas] }));
	edit();
	stop();
	assert.equal(out.length, 1);
	return out[0]!;
};

test('a write is issued when the commit closes, not when someone asks whether it has settled', async () => {
	// `settled` closes the one-turn window between mutating and writing. It is not what
	// starts the write: a store that wrote only when asked would lose every edit a process
	// made and never asked about.
	const { driver, writes } = recording();
	const store = createStore({ driver });
	const board = await store.open('board');

	(board.root as Doc).title = 'typed';
	await tick();
	assert.equal(writes.length, 1, 'the write reached the driver with nobody waiting on it');

	const again = await createStore({ driver }).open('board');
	assert.equal((again.root as Doc).title, 'typed');
});

test('close writes what is still unwritten first, and raises a write that failed', async () => {
	const { driver } = recording();
	const store = createStore({ driver });
	const board = await store.open('board');
	(board.root as Doc).title = 'last words';
	await store.close(board);

	const again = await createStore({ driver }).open('board');
	assert.equal((again.root as Doc).title, 'last words', 'the write before the close is stored');

	// A driver that fails: the failure comes out of the close, not out of nowhere.
	const inner = memoryDriver();
	let fail = false;
	const flaky: Driver = { ...inner, write: async (w) => { if (fail) throw new Error('disk full'); return inner.write(w); } };
	const shaky = createStore({ driver: flaky });
	const doc = await shaky.open('doc');
	fail = true;
	(doc.root as Doc).title = 'lost';
	await assert.rejects(shaky.close(doc), /disk full/);
});

test('a refused receive writes nothing: not the rows, not the tail, not the head', async () => {
	const { driver, writes } = recording();
	const store = createStore({ driver });
	const board = await store.open('board');
	(board.root as Doc).n = 1;
	await store.settled(board);
	const before = writes.length;
	const headBefore = await store.head('board');

	intercept(board.root, () => ((board.root as Doc).n === 13 ? [{ code: 'unlucky', message: 'no' }] : []));

	const twin = createObject<Doc>({ n: 1 }, idOf(board.root));
	const bad = oneCommit(twin, () => { twin.n = 13; });
	await assert.rejects(store.receive(board, bad), RefusedError);

	assert.equal((board.root as Doc).n, 1, 'the document is where it was');
	assert.equal(writes.length, before, 'no write reached the driver');
	assert.equal(await store.head('board'), headBefore, 'the head did not move');
	assert.equal((await store.since('board', headBefore)).length, 0, 'and the tail has nothing after it');
	const stored = await driver.read('board');
	assert.equal(stored?.rows.find((row) => row.id === textIdOf(board.root))?.slots['n'], 1, 'the row still says 1');
});

test('asking for commits after a sequence the tail no longer reaches is refused, even when the whole tail is gone', async () => {
	// Design 051: an empty answer reads exactly like "you are current". Truncating everything
	// is the case where that lie costs the most, and it is the branch a partial truncation
	// does not reach.
	const store = createStore({ driver: memoryDriver() });
	const board = await store.open('board');
	for (let i = 1; i <= 5; i++) {
		(board.root as Doc).n = i;
		await store.settled(board);
	}
	assert.equal((await store.since('board', 2)).length, 3, 'before truncation the tail answers');

	await store.truncate('board', 0);
	await assert.rejects(store.since('board', 0), (error: { reason?: string }) => error.reason === 'truncated');
	await assert.rejects(store.since('board', 2), (error: { reason?: string }) => error.reason === 'truncated');
	assert.deepEqual(await store.since('board', 5), [], 'a caller at the head is current, and is told so');
});

test('a swept observable cannot be re-attached, locally or from elsewhere', async () => {
	const store = createStore({ driver: memoryDriver() });
	const board = await store.open('board');
	const child = createObject<Doc>({ a: 1 });
	(board.root as Doc).child = child;
	await store.settled(board);

	delete (board.root as Doc).child;
	await store.settled(board);
	assert.deepEqual(store.orphans(board), [textIdOf(child)]);
	assert.equal(await store.sweep(board), 1);

	// From elsewhere: refused before anything lands.
	const twin = createObject<Doc>(undefined, idOf(board.root));
	const back = oneCommit(twin, () => { twin.child = createObject<Doc>(undefined, idOf(child)); });
	await assert.rejects(store.receive(board, back), (error: { reason?: string }) => error.reason === 'detached-elsewhere');
	assert.equal((board.root as Doc).child, undefined);

	// Locally: the write has happened, so the store's answer is the latch every unpersistable
	// write takes, raised where the writer asks.
	(board.root as Doc).child = child;
	await assert.rejects(store.settled(board), (error: { reason?: string }) => error.reason === 'detached-elsewhere');
});

test('a commit writes only the slots its deltas name, not the whole row', async () => {
	const { driver, writes } = recording();
	const store = createStore({ driver });
	const board = await store.open('board');
	atomic(() => {
		(board.root as Doc).a = 1;
		(board.root as Doc).b = 2;
		(board.root as Doc).c = 3;
	});
	await store.settled(board);

	(board.root as Doc).b = 20;
	await store.settled(board);
	const last = writes.at(-1)!;
	assert.equal(last.rows.length, 1);
	assert.deepEqual(Object.keys(last.rows[0]!.set), ['b']);
	assert.deepEqual(last.rows[0]!.unset, []);

	delete (board.root as Doc).c;
	await store.settled(board);
	assert.deepEqual(writes.at(-1)!.rows[0]!.unset, ['c']);
	assert.deepEqual(Object.keys(writes.at(-1)!.rows[0]!.set), []);
});

test('after the last close the handle is torn down: it answers not-open, and later writes are not persisted', async () => {
	const { driver, writes } = recording();
	const store = createStore({ driver });
	const board = await store.open('board');
	const twice = await store.open('board');
	assert.equal(twice.root, board.root, 'one document, reference counted');

	await store.close(twice);
	(board.root as Doc).title = 'still open';
	await store.settled(board);
	await store.close(board);
	const written = writes.length;

	await assert.rejects(store.settled(board), (error: { reason?: string }) => error.reason === 'not-open');
	assert.throws(() => store.orphans(board), (error: { reason?: string }) => error.reason === 'not-open');
	await assert.rejects(store.sweep(board), (error: { reason?: string }) => error.reason === 'not-open');
	await assert.rejects(store.receive(board, { deltas: [] }), (error: { reason?: string }) => error.reason === 'not-open');

	(board.root as Doc).title = 'after close';
	await tick();
	assert.equal(writes.length, written, 'the closed document is not watched any more');
	const again = await createStore({ driver }).open('board');
	assert.equal((again.root as Doc).title, 'still open');
});

test('a detached observable keeps its row and its slots, through the patch the store writes for it', async () => {
	// Design 048. Detaching is not deleting: the row stays with everything it held, and only
	// its edge goes. The patch the store writes must say exactly that, or the driver stores
	// an empty row and a later re-attach elsewhere finds nothing.
	const { driver, writes } = recording();
	const store = createStore({ driver });
	const board = await store.open('board');
	const child = createObject<Doc>({ a: 1, b: 'two' });
	(board.root as Doc).child = child;
	await store.settled(board);

	delete (board.root as Doc).child;
	await store.settled(board);

	const patch = writes.at(-1)!;
	assert.deepEqual(patch.dropped, [textIdOf(child)]);
	const row = patch.rows.find((r) => r.id === textIdOf(child));
	assert.equal(row?.edge, null, 'the edge is gone');
	assert.deepEqual(row?.unset, [], 'and no slot with it');

	const stored = (await driver.read('board'))!.rows.find((r) => r.id === textIdOf(child))!;
	assert.equal(stored.parent, null);
	assert.equal(stored.slot, null);
	assert.deepEqual(stored.slots, { a: 1, b: 'two' }, 'what the row held is still there');
});

test('scan orders by name, whatever order the documents were made in', async () => {
	const store = createStore({ driver: memoryDriver() });
	for (const name of ['cherry', 'apple', 'banana']) await store.close(await store.open(name));

	const page = await store.scan(10);
	assert.deepEqual(page.map((found) => found.doc), ['apple', 'banana', 'cherry']);
	const rest = await store.scan(10, page[0]!.cursor);
	assert.deepEqual(rest.map((found) => found.doc), ['banana', 'cherry'], 'a page after the first carries on in the same order');
});

test('the open that drops a dangling alias says which slots went', async () => {
	// Design 050. A slot naming, by alias, an observable nothing attaches cannot be rebuilt,
	// so it is left out rather than making the document unopenable; and the caller who opened
	// it is told, because from the document's point of view a slot has silently disappeared.
	const driver = memoryDriver();
	const first = createStore({ driver });
	const board = await first.open('board');
	const child = createObject<Doc>({ a: 1 });
	const root = board.root as Doc;
	atomic(() => {
		root.home = child;
		root.also = alias(child);
	});
	await first.settled(board);
	assert.deepEqual(board.droppedSlots, [], 'nothing was dropped opening a fresh document');

	delete root.home;
	await first.settled(board);
	await first.close(board);

	const again = await createStore({ driver }).open('board');
	assert.deepEqual(again.droppedSlots, [`${textIdOf(again.root)}.also`]);
	assert.equal((again.root as Doc).also, undefined, 'the slot is gone from the document');
	assert.equal((again.root as Doc).home, undefined);
});

test('a declaration is checked before anything is built, and a query is refused before it reaches the driver', async () => {
	assert.throws(() => createStore({ driver: memoryDriver(), declare: { title: [] } }),
		(error: { reason?: string }) => error.reason === 'empty-path');
	assert.throws(() => createStore({ driver: memoryDriver(), declare: { title: ['tasks', 0 as unknown as string, 'title'] } }),
		(error: { reason?: string }) => error.reason === 'wildcard-path');

	const store = createStore({ driver: memoryDriver(), declare: { title: ['title'] } });
	await assert.rejects(store.find({ where: [] }), (error: { reason?: string }) => error.reason === 'empty-query');
});

test('a driver that neither creates a document nor holds it has broken its contract, and open says so', async () => {
	const inner = memoryDriver();
	const broken: Driver = { ...inner, create: async () => false };
	const store = createStore({ driver: broken });
	await assert.rejects(store.open('ghost'), (error: { reason?: string }) => error.reason === 'create-not-held');
});

test('the projection a driver keeps is what projectionOf computes from the rows, and the tail decodes with decodeCommit', async () => {
	// Both are the seam a driver written outside this package works against.
	const declare = { title: ['title'], first: ['tasks', 'first', 'title'] };
	const driver = memoryDriver();
	const store = createStore({ driver, declare });
	const board = await store.open('board');
	const root = board.root as Doc;
	atomic(() => {
		root.title = 'plan';
		root.tasks = createObject<Doc>({ first: createObject<Doc>({ title: 'ship' }) });
	});
	await store.settled(board);

	const stored = (await driver.read('board'))!;
	const fields = projectionOf(stored.rows, stored.root, declare);
	assert.deepEqual(fields, { title: 'plan', first: 'ship' });
	const found = await store.find({ where: [{ field: 'title', op: 'eq', value: 'plan' }] });
	assert.deepEqual(found.map((f) => f.fields), [fields], 'the index agrees with the rows');

	const bodies = await driver.since('board', 0);
	const held = await store.since('board', 0);
	assert.equal(bodies.length, held.length);
	for (const [i, entry] of bodies.entries()) {
		assert.deepEqual(decodeCommit(entry.body), held[i]!.commit);
		assert.deepEqual(encodeCommit(decodeCommit(entry.body)), entry.body, 'and the bytes are the canonical spelling');
	}
	assert.ok(held[0]!.commit.deltas.some((d) => idToText(d.id) === textIdOf(root)), 'the first commit wrote the root');
});
