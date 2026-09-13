// Wildcard scope steps: skip and tree (design 025).

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createArray, createMap, createObject, idOf, observer } from '../src/index.ts';

interface Column extends Record<string, unknown> {
	name?: string;
	done?: boolean;
	meta?: Record<string, unknown>;
}

const board = (): Record<string, unknown> => createObject({
	todo: createObject<Column>({ name: 'todo', done: false }),
	doing: createObject<Column>({ name: 'doing', done: false }),
	other: 'not a column',
});

test('skip scopes one level of any key', () => {
	const doc = board();
	const seen: unknown[] = [];

	observer(doc).skip().path('done').watch((change) => seen.push(change.deltas[0]!.value));

	(doc.todo as Column).done = true;
	(doc.doing as Column).done = true;
	(doc.todo as Column).name = 'renamed';
	doc.other = 'still not';

	assert.deepEqual(seen, [true, true]);
});

test('skip counts its levels', () => {
	const doc = createObject({
		a: createObject({ b: createObject({ hit: 1 }) }),
	});
	const seen: number[] = [];

	observer(doc).skip(2).path('hit').watch((change) => seen.push(change.deltas.length));

	((doc.a as Record<string, unknown>).b as Record<string, unknown>).hit = 2;
	(doc.a as Record<string, unknown>).b = 3; // one level deep, does not match skip(2) + key
	assert.deepEqual(seen, [1]);
});

test('tree scopes the named key at any depth', () => {
	const doc = createObject({
		draft: 'top',
		nested: createObject({ draft: 'mid', deeper: createObject({ draft: 'low' }) }),
	});
	const seen: unknown[] = [];

	observer(doc).tree('draft').watch((change) => seen.push(change.deltas[0]!.value));

	doc.draft = 't2';
	(doc.nested as Record<string, unknown>).draft = 'm2';
	((doc.nested as Record<string, unknown>).deeper as Record<string, unknown>).draft = 'l2';
	(doc.nested as Record<string, unknown>).other = 'x';

	assert.deepEqual(seen, ['t2', 'm2', 'l2']);
});

test('a scope below a tree step keeps working, and deltas under a match stay in scope', () => {
	const doc = createObject({
		item: createObject({ meta: createObject({ tag: 'a', size: 1 }) }),
	});
	const tags: unknown[] = [];

	observer(doc).tree('meta').path('tag').watch((change) => tags.push(change.deltas[0]!.value));

	const meta = (doc.item as Record<string, unknown>).meta as Record<string, unknown>;
	meta.tag = 'b';
	meta.size = 2;

	assert.deepEqual(tags, ['b']);
});

test('ignore and shallow apply after the wildcard match', () => {
	const doc = board();
	const shallowSeen: unknown[] = [];
	const ignored: unknown[] = [];

	observer(doc).skip().shallow().watch((change) => shallowSeen.push(change.deltas[0]!.value));
	observer(doc).skip().ignore('name').watch((change) => ignored.push(change.deltas[0]!.value));

	const todo = doc.todo as Column;
	todo.done = true;
	todo.name = 'x';
	todo.meta = createObject({ deep: 1 });
	(todo.meta as Record<string, unknown>).deep = 2; // two levels under skip: not shallow

	assert.equal(shallowSeen.length, 3);
	assert.deepEqual(shallowSeen.slice(0, 2), [true, 'x']);
	assert.ok(!ignored.includes('x'));
	assert.ok(ignored.includes(true));
});

test('a wildcard scope has no single value: get is undefined, set throws', () => {
	const doc = board();
	const scope = observer(doc).skip().path('done');

	assert.equal(scope.get(), undefined);
	assert.equal(scope.isImmutable(), true);
	assert.throws(() => scope.set(true), /multi-target/);
});

test('a derived chain over a wildcard scope degrades to its fallback, not a crash', () => {
	const doc = board();
	const label = observer(doc).skip().path('done').def('many');
	assert.equal(label.get(), 'many');
});

test('a leading-underscore slot is private from wildcards, and only from wildcards', () => {
	const doc = createObject({
		done: false,
		_draft: 'hidden',
		_private: createObject({ note: 'hidden too' }),
	});
	const skipped: unknown[] = [];
	const named: unknown[] = [];

	observer(doc).skip().watch((change) => skipped.push(change.deltas[0]!.value));
	observer(doc).path('_draft').watch((change) => named.push(change.deltas[0]!.value));

	doc.done = true;
	doc._draft = 'still hidden';
	(doc._private as Record<string, unknown>).note = 'changed';

	assert.deepEqual(skipped, [true]);
	// An explicit path names it and sees it; privacy is from wildcards, not from everyone.
	assert.deepEqual(named, ['still hidden']);
});

test('tree does not walk through a private subtree, and can name a private key itself', () => {
	const doc = createObject({
		note: 'top',
		_private: createObject({ note: 'inner' }),
	});
	const notes: unknown[] = [];
	const explicit: unknown[] = [];

	observer(doc).tree('note').watch((change) => notes.push(change.deltas[0]!.value));
	observer(doc).tree('_private').watch((change) => explicit.push(change.deltas.length));

	doc.note = 't2';
	(doc._private as Record<string, unknown>).note = 'i2';

	assert.deepEqual(notes, ['t2']);
	// Naming the private key explicitly is allowed; the wildcard run before it is what may
	// not swallow one.
	assert.deepEqual(explicit, [1]);
});

test('wildcards see array steps too', () => {
	const doc = createObject({
		rows: createArray([createObject({ done: false }), createObject({ done: false })]),
	});
	const seen: unknown[] = [];

	observer(doc).path('rows').skip().path('done').watch((change) => seen.push(change.deltas[0]!.value));

	const rows = doc.rows as Array<Record<string, unknown>>;
	rows[1]!.done = true;
	assert.deepEqual(seen, [true]);
});

// --- skip(Infinity): any run of open steps (design 259) --------------------------------------

const deltaPaths = (change: { deltas: readonly { ref: { key: unknown } }[] }): string[] =>
	change.deltas.map((delta) => String(delta.ref.key));

test('a trailing run hears a public delta at any depth, each on its own, and never one under a private slot', () => {
	const doc = createObject({
		name: 'a',
		_secret: 'x',
		nested: createObject({ title: 'ok', _token: 't', deeper: createObject({ leaf: 1, _hidden: createObject({ inner: 1 }) }) }),
	});
	const seen: string[] = [];
	observer(doc).skip(Infinity).watch((change) => seen.push(...deltaPaths(change)));

	doc.name = 'b';
	doc._secret = 'y';
	const nested = doc.nested as Record<string, unknown>;
	nested.title = 'ko';
	nested._token = 'u';
	const deeper = nested.deeper as Record<string, unknown>;
	deeper.leaf = 2;
	(deeper._hidden as Record<string, unknown>).inner = 2;
	// Under a private slot of an object, at any depth: not the slot, and not what it holds.
	assert.deepEqual(seen, ['name', 'title', 'leaf']);
});

test('a trailing run delivers only the public deltas of a commit that mixes both', () => {
	const doc = createObject({ name: 'a', _secret: 'x' });
	const seen: string[][] = [];
	observer(doc).skip(Infinity).watch((change) => seen.push(deltaPaths(change)));
	atomic(() => { doc.name = 'b'; doc._secret = 'y'; });
	assert.deepEqual(seen, [['name']]);
});

test('a subtree added in one write reaches a trailing run as its public slots only', () => {
	const doc = createObject<{ nested?: unknown }>({});
	const seen: string[] = [];
	observer(doc).skip(Infinity).watch((change) => seen.push(...deltaPaths(change)));
	doc.nested = createObject({ title: 'ok', _token: 't' });
	assert.deepEqual(seen.sort(), ['nested', 'title']);
});

test('a trailing run walks through arrays and maps, whose steps are always open', () => {
	const keyed = createObject({ v: 1, _w: 1 });
	const doc = createObject({
		rows: createArray([createObject({ done: false, _note: 'n' })]),
		byKey: createMap([[idOf(keyed), keyed]]),
	});
	const seen: string[] = [];
	observer(doc).skip(Infinity).watch((change) => seen.push(...deltaPaths(change)));
	const row = (doc.rows as Array<Record<string, unknown>>)[0]!;
	row.done = true;
	row._note = 'm';
	keyed.v = 2;
	keyed._w = 2;
	// The array position and the map key are steps too, and neither is an object slot.
	assert.deepEqual(seen, ['done', 'v']);
});

test('a run followed by a key reaches the key at any depth and never below a private slot', () => {
	const doc = createObject({
		draft: 'top',
		nested: createObject({ draft: 'mid', _private: createObject({ draft: 'hidden' }) }),
	});
	const seen: unknown[] = [];
	observer(doc).skip(Infinity).path('draft').watch((change) => seen.push(change.deltas[0]!.value));
	doc.draft = 't2';
	(doc.nested as Record<string, unknown>).draft = 'm2';
	((doc.nested as Record<string, unknown>)._private as Record<string, unknown>).draft = 'h2';
	(doc.nested as Record<string, unknown>).other = 'x';
	assert.deepEqual(seen, ['t2', 'm2']);
});

test('ignore drops a step the run would consume, and everything under it', () => {
	const doc = createObject<Record<string, unknown>>({
		keep: createObject({ a: 1 }),
		draft: createObject({ a: 1, deep: createObject({ b: 1 }) }),
	});
	const seen: string[] = [];
	observer(doc).skip(Infinity).ignore('draft').watch((change) => seen.push(...deltaPaths(change)));
	(doc.keep as Record<string, unknown>).a = 2;
	const draft = doc.draft as Record<string, unknown>;
	draft.a = 2;
	(draft.deep as Record<string, unknown>).b = 2;
	doc.draft = 'gone';
	assert.deepEqual(seen, ['a']);
});

test('shallow after a trailing run changes nothing, and a run has no single value', () => {
	const doc = createObject({ a: createObject({ b: 1 }) });
	const seen: string[] = [];
	const scope = observer(doc).skip(Infinity);
	scope.shallow().watch((change) => seen.push(...deltaPaths(change)));
	(doc.a as Record<string, unknown>).b = 2;
	assert.deepEqual(seen, ['b']);
	assert.equal(scope.get(), undefined);
	assert.throws(() => scope.set(1), (error: { reason?: string }) => error.reason === 'multi-target');
});

test('a run after a path starts under it, and hears the slot the path names too', () => {
	const doc = createObject<Record<string, unknown>>({ a: createObject({ b: 1, _c: 1 }), other: createObject({ b: 1 }) });
	const seen: string[] = [];
	observer(doc).path('a').skip(Infinity).watch((change) => seen.push(...deltaPaths(change)));
	(doc.a as Record<string, unknown>).b = 2;
	(doc.a as Record<string, unknown>)._c = 2;
	(doc.other as Record<string, unknown>).b = 2;
	doc.a = createObject({ b: 3 });
	// The replacement and the slot inside it land in one commit, whose deltas have no order.
	assert.deepEqual(seen.slice(0, 1), ['b']);
	assert.deepEqual(seen.slice(1).sort(), ['a', 'b']);
});

test('skip(Infinity) builds one step, in constant memory', () => {
	const before = process.memoryUsage().heapUsed;
	const scope = observer(createObject({})).skip(Infinity);
	assert.ok(scope.isImmutable());
	assert.ok(process.memoryUsage().heapUsed - before < 8 * 1024 * 1024);
});
