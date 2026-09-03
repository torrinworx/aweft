import test from 'node:test';
import assert from 'node:assert/strict';

import { alias, apply, atomic, createArray, createObject, observer, parentOf, textIdOf } from '@aweftjs/core';
import type { Commit } from '@aweftjs/codec';

import { createStore, memoryDriver } from '../src/index.ts';
import type { Driver } from '../src/index.ts';

// Every case here was a live defect. They are requirements now, and each names the thing it
// protects.

type Doc = Record<string, unknown>;
const capture = (root: object, fn: () => void): Commit[] => {
	const out: Commit[] = [];
	const stop = observer(root).watch((c) => out.push({ deltas: [...c.deltas] }));
	fn();
	stop();
	return out;
};

test('moving an observable inside one commit does not report it as an orphan', async () => {
	const store = createStore({ driver: memoryDriver() });
	const h = await store.open('moving');
	const root = h.root as Doc;
	const a = createArray<Doc>();
	const b = createArray<Doc>();
	atomic(() => { root.a = a; root.b = b; });
	const item = createObject<Doc>({ title: 'the item' });
	a.push(item);
	await store.settled(h);

	// One commit, both halves. The deltas arrive in canonical order, which puts the add before
	// the remove, so reading the remove literally orphans an observable that is very much alive.
	atomic(() => { b.push(item); a.splice(0, 1); });
	await store.settled(h);

	assert.equal(parentOf(item), b, 'core says it moved');
	assert.deepEqual(store.orphans(h), [], 'and store must agree');
	assert.equal(await store.sweep(h), 0, 'so a sweep must not eat it');

	item.title = 'renamed after the move';
	await store.settled(h);
	assert.equal(((h.root as Doc).b as Doc[])[0]!.title, 'renamed after the move');
});

test('a sweep frees the rows, and the document is still resumable afterwards', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const h = await store.open('swept');
	const root = h.root as Doc;
	const list = createArray<Doc>();
	atomic(() => { root.list = list; });
	const item = createObject<Doc>({ title: 'to be swept' });
	list.push(item);
	await store.settled(h);
	list.splice(0, 1);
	await store.settled(h);

	const before = h.seq;
	assert.deepEqual(store.orphans(h), [textIdOf(item)]);
	assert.equal(await store.sweep(h), 1);

	// it is gone from storage, not just from this handle
	const fresh = createStore({ driver });
	const h2 = await fresh.open('swept');
	assert.deepEqual(fresh.orphans(h2), [], 'a swept row must not come back');

	// and the history still decodes, which is what a resuming session depends on
	const history = await store.since('swept', 0);
	assert.ok(history.length > 0);
	assert.equal(await store.head('swept'), before, 'a sweep is not a commit');
});

test('a failed write is terminal, and is not handed to only the first caller', async () => {
	const inner = memoryDriver();
	let fail = false;
	const driver: Driver = { ...inner, write: async (w) => { if (fail) throw new Error('boom'); return inner.write(w); } };
	const store = createStore({ driver });
	const h = await store.open('failing');
	const root = h.root as Doc;
	root.first = 1;
	await store.settled(h);

	fail = true;
	root.second = 2;
	const [one, two] = await Promise.allSettled([store.settled(h), store.settled(h)]);
	assert.equal(one.status, 'rejected');
	assert.equal(two.status, 'rejected', 'the second caller must not be told the write succeeded');

	fail = false;
	root.third = 3;
	await assert.rejects(() => store.settled(h), /boom/, 'the failure stays, because what is stored is behind');
	await assert.rejects(() => store.receive(h, capture(root, () => { root.fourth = 4; })[0]!, 'u'), /boom/);
});

test('a path declared after a document exists is written on the next open', async () => {
	const driver = memoryDriver();
	const first = createStore({ driver, declare: { owner: ['owner'] } });
	const h = await first.open('later');
	atomic(() => { (h.root as Doc).owner = 'u_1'; (h.root as Doc).title = 'a title'; });
	await first.settled(h);
	await first.close(h);

	const second = createStore({ driver, declare: { owner: ['owner'], title: ['title'] } });
	const h2 = await second.open('later');
	(h2.root as Doc).touched = true;
	await second.settled(h2);

	assert.deepEqual((await second.find({ where: [{ field: 'title', op: 'eq', value: 'a title' }] })).map((f) => f.doc),
		['later'], 'a newly declared path must become findable');
});

test('a dangling alias does not make a document unopenable', async () => {
	const driver = memoryDriver();
	const store = createStore({ driver });
	const h = await store.open('aliasing');
	const root = h.root as Doc;
	const holder = createObject<Doc>();
	atomic(() => { root.holder = holder; });
	const x = createObject<Doc>({ v: 1 });
	holder.x = x;
	root.namesIt = alias(x);
	delete holder.x;                       // x is detached; root.namesIt still names it
	await store.settled(h);
	await store.close(h);

	const again = await createStore({ driver }).open('aliasing');
	assert.ok(!('namesIt' in (again.root as Doc)), 'the dangling alias slot is dropped, not carried');
	assert.equal((again.root as Doc).holder !== undefined, true, 'and the rest of the document survives');
});

test('reopening while a close is draining does not hand back a dead handle', async () => {
	const store = createStore({ driver: memoryDriver() });
	const h = await store.open('racing');
	(h.root as Doc).x = 1;

	const closing = store.close(h);
	const h2 = await store.open('racing');
	await closing;

	(h2.root as Doc).y = 2;
	await store.settled(h2);
	assert.equal((h2.root as Doc).y, 2);
});

test('find hands back the projection it already read', async () => {
	const store = createStore({ driver: memoryDriver(), declare: { owner: ['owner'], title: ['title'] } });
	const h = await store.open('listing');
	atomic(() => { (h.root as Doc).owner = 'u_1'; (h.root as Doc).title = 'the title'; });
	await store.settled(h);

	const [hit] = await store.find({ where: [{ field: 'owner', op: 'eq', value: 'u_1' }] });
	assert.equal(hit?.doc, 'listing');
	assert.equal(hit?.fields.title, 'the title', 'listing must not mean reopening every document');
});

test('a local write can be attributed to whoever made it', async () => {
	const store = createStore({ driver: memoryDriver(), actor: 'u_7' });
	const h = await store.open('attributed');
	(h.root as Doc).v = 1;
	await store.settled(h);
	assert.deepEqual((await store.since('attributed', 0)).map((e) => e.actor), ['u_7']);
});

test('a declared path may not cross an array, and says so', async () => {
	const store = createStore({ driver: memoryDriver(), declare: { first: ['tasks', '0', 'title'] } });
	const h = await store.open('arrayed');
	const tasks = createArray<Doc>();
	(h.root as Doc).tasks = tasks;
	tasks.push(createObject<Doc>({ title: 'a task' }));

	await assert.rejects(() => store.settled(h), /array/,
		'an array position is not a stable name, so a literal step into one is a mistake, not an empty result');
	void apply;
});

// `open` awaits the driver four times between checking the map of open documents and writing
// to it, so two callers in one tick both missed and both built a document. The second
// overwrote the first, which left two live copies of one name: a write through one was
// invisible to the other, one `close` unregistered the document so the other handle's
// `settled` threw, and the losing copy's observer went on writing to the driver after its
// handle was closed, out of reach of `stop()`. `Promise.all([open(d), open(d)])` is what a
// server does on every request that arrives in a pair.
test('two opens of one name in the same tick share one document', async () => {
	const store = createStore({ driver: memoryDriver(), actor: 'u_1' });

	const [first, second] = await Promise.all([store.open('board'), store.open('board')]);
	assert.equal(first.root, second.root, 'one live document, not two');

	const root = first.root as Doc;
	root.title = 'written through the first handle';
	assert.equal((second.root as Doc).title, 'written through the first handle');

	// Two openers means two references, so one close leaves the document open for the other.
	await store.close(first);
	await store.settled(second);
	(second.root as Doc).after = 'still writing';
	await store.settled(second);

	await store.close(second);
	await store.stop();

	const back = createStore({ driver: memoryDriver(), actor: 'u_1' });
	await back.stop();
});
