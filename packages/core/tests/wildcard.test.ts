// Wildcard scope steps: skip and tree (design 025).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray, createObject, observer } from '../src/index.ts';

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
