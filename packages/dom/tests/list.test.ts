// Lists: document arrays on the commit grain, mutable arrays, and arrays diffed by reference.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createArray, createObject, mutable, mutableArray, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import type { LightElement } from '../src/index.ts';
import { createDocument, h, mount, toHtml } from '../src/index.ts';

interface Row extends Record<string, unknown> { label?: string }
const row = (label: string): Row => createObject<Row>({ label });
const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));

test('a document array mounts its rows and follows push, splice, replace and clear', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	assert.equal(toHtml(document.body), '<body><ul><li>a</li><li>b</li></ul></body>');

	ops.length = 0;
	rows.push(row('c'));
	assert.deepEqual(ops, ['insert "c" into <li> before end', 'insert <li> into <ul> before end']);

	ops.length = 0;
	rows.splice(1, 0, row('x'));
	assert.deepEqual(ops, ['insert "x" into <li> before end', 'insert <li> into <ul> before <li>']);
	assert.equal(toHtml(document.body), '<body><ul><li>a</li><li>x</li><li>b</li><li>c</li></ul></body>');

	ops.length = 0;
	rows.splice(1, 1);
	assert.deepEqual(ops, ['remove <li> from <ul>']);

	ops.length = 0;
	rows[0]!.label = 'A';
	assert.deepEqual(ops, ['text "a" -> "A"'], 'a field edit touches only its text');

	ops.length = 0;
	rows[1] = row('B');
	assert.deepEqual(ops, ['remove <li> from <ul>', 'insert "B" into <li> before end', 'insert <li> into <ul> before <li>']);
	assert.equal(toHtml(document.body), '<body><ul><li>A</li><li>B</li><li>c</li></ul></body>');

	ops.length = 0;
	rows.splice(0, rows.length);
	assert.deepEqual(ops, ['clear <ul>'], 'emptying the whole list is one write');
	assert.equal(toHtml(document.body), '<body><ul></ul></body>');
	rows.push(row('again'));
	assert.equal(toHtml(document.body), '<body><ul><li>again</li></ul></body>', 'the list fills again after a clear');
});

test('a swap in one commit moves the two rows and keeps their nodes', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<Row>([row('a'), row('b'), row('c'), row('d')]);
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	const ul = (document.body as LightElement).children[0]!;
	const [a, , , d] = ul.children;

	ops.length = 0;
	atomic(() => {
		const t = rows[0]!;
		rows[0] = rows[3]!;
		rows[3] = t;
	});
	assert.equal(toHtml(document.body), '<body><ul><li>d</li><li>b</li><li>c</li><li>a</li></ul></body>');
	const children = ul.children;
	assert.equal(children[0], d, 'the d row is the same node');
	assert.equal(children[3], a, 'the a row is the same node');
	assert.ok(ops.every((op) => op.startsWith('insert <li>') || op.startsWith('remove <li>')), `rows move whole: ${ops.join(' | ')}`);
});

test('a list is not the whole parent: the clear removes row by row and the trailer stays', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<Row>([row('a'), row('b')]);
	mount(document.body, h('ul', {}, h(Item, { each: rows }), h('li', {}, 'trailer')));
	ops.length = 0;
	rows.splice(0, 2);
	assert.deepEqual(ops, ['remove <li> from <ul>', 'remove <li> from <ul>']);
	assert.equal(toHtml(document.body), '<body><ul><li>trailer</li></ul></body>');
});

test('a mutable array of nodes and components follows its changes', () => {
	const doc = createDocument();
	const layers = mutableArray<unknown>([h('i', {}, '1')]);
	const stop = mount(doc.body, layers);
	layers.push(h('i', {}, '2'), 'three');
	layers.unshift(h('b', {}, '0'));
	assert.equal(toHtml(doc.body), '<body><b>0</b><i>1</i><i>2</i>three</body>');
	const [b, i1] = doc.body.children;
	layers.splice(0, 2, i1, b);
	assert.equal(toHtml(doc.body), '<body><i>1</i><b>0</b><i>2</i>three</body>');
	assert.equal(doc.body.children[0], i1, 'a replace by a row already present moves it');
	layers.length = 0;
	assert.equal(toHtml(doc.body), '<body></body>');
	layers.push('x');
	stop();
	layers.push('y');
	assert.equal(toHtml(doc.body), '<body></body>', 'a change after removal is ignored');
});

test('each over a plain array, a cell of an array, and a mutable array', () => {
	const doc = createDocument();
	const Name = ({ each }: { each: string }) => h('span', {}, each);
	const names = mutable(['a', 'b']);
	const local = mutableArray(['x']);
	mount(doc.body, [h(Name, { each: ['p', 'q'] }), h(Name, { each: names }), h(Name, { each: local })]);
	assert.equal(toHtml(doc.body), '<body><span>p</span><span>q</span><span>a</span><span>b</span><span>x</span></body>');
	names.set(['b', 'c']);
	local.push('y');
	assert.equal(toHtml(doc.body), '<body><span>p</span><span>q</span><span>b</span><span>c</span><span>x</span><span>y</span></body>');
	assert.throws(() => names.set('not iterable' as never), /iterable/);
});

test('an array diffed by reference keeps matched rows, moves them, and handles duplicates', () => {
	const doc = createDocument();
	const a = h('p', {}, 'a');
	const b = h('p', {}, 'b');
	const list = mutable<unknown[]>([a, b, 'dup', 'dup']);
	mount(doc.body, list);
	assert.equal(toHtml(doc.body), '<body><p>a</p><p>b</p>dupdup</body>');

	const [pa, pb] = doc.body.children;
	list.set(['dup', b, a]);
	assert.equal(toHtml(doc.body), '<body>dup<p>b</p><p>a</p></body>');
	assert.equal(doc.body.children[0], pb);
	assert.equal(doc.body.children[1], pa);
	list.set([a]);
	assert.equal(toHtml(doc.body), '<body><p>a</p></body>');
});

test('a nested list inside a row clears with its row', () => {
	const doc = createDocument();
	const outer = createArray<Row>([row('r')]);
	const inner = createArray<string>(['i', 'j']);
	const Outer = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'), h('ul', {}, inner));
	mount(doc.body, h('ul', {}, h(Outer, { each: outer })));
	assert.equal(toHtml(doc.body), '<body><ul><li>r<ul>ij</ul></li></ul></body>');
	inner.push('k');
	outer.splice(0, 1);
	assert.equal(toHtml(doc.body), '<body><ul></ul></body>');
	inner.push('after');
	assert.equal(toHtml(doc.body), '<body><ul></ul></body>', 'the inner list is unbound with its row');
});

test('a commit that emptied and refilled the list in one block reads as one clear and adds', () => {
	const { document, ops } = recordingDocument();
	const rows = createArray<string>(['a', 'b']);
	mount(document.body, h('ul', {}, rows));
	ops.length = 0;
	atomic(() => {
		rows.splice(0, 2);
		rows.push('c');
	});
	assert.equal(toHtml(document.body), '<body><ul>c</ul></body>');
	assert.ok(!ops.includes('clear <ul>'), 'a block that adds is not a clear');
});

test('a swap of two prebuilt rows in one block moves both and rebuilds neither', () => {
	const { document, ops } = recordingDocument();
	const rows = mutableArray<unknown>([h('i', {}, 'a'), h('i', {}, 'b'), h('i', {}, 'c'), h('i', {}, 'd')]);
	mount(document.body, rows);
	const body = document.body as LightElement;
	const [a, , , d] = body.children;

	ops.length = 0;
	atomic(() => {
		const t = rows[0];
		rows[0] = rows[3];
		rows[3] = t;
	});

	// One change list of two replaces (design 087), so the pool holds both rows by the time
	// either is put back and each keeps its mount.
	assert.equal(toHtml(document.body), '<body><i>d</i><i>b</i><i>c</i><i>a</i></body>');
	assert.equal(body.children[0], d, 'the d row is the same node');
	assert.equal(body.children[3], a, 'the a row is the same node');
	assert.equal(ops.filter((op) => op.startsWith('insert <i> into <body>')).length, 2, ops.join(' | '));
	assert.ok(!ops.some((op) => op.includes('into <i>')), `a row was built again: ${ops.join(' | ')}`);
});

test('a component list swapped in one block moves both rows too', () => {
	const { document, ops } = recordingDocument();
	const rows = mutableArray<Row>([row('a'), row('b'), row('c')]);
	mount(document.body, h('ul', {}, h(Item, { each: rows })));
	const ul = (document.body as LightElement).children[0]!;
	const [first, , third] = ul.children;

	ops.length = 0;
	atomic(() => {
		const t = rows[0]!;
		rows[0] = rows[2]!;
		rows[2] = t;
	});

	assert.equal(toHtml(document.body), '<body><ul><li>c</li><li>b</li><li>a</li></ul></body>');
	assert.equal(ul.children[0], third);
	assert.equal(ul.children[2], first);
	assert.ok(ops.every((op) => op.startsWith('insert <li>') || op.startsWith('remove <li>')),
		`rows move whole: ${ops.join(' | ')}`);
});

test('a row placed between two rows added in the same block lands in order', () => {
	const doc = createDocument();
	const rows = mutableArray<unknown>(['a', 'b', 'c', 'd', 'e', 'f'].map((text) => h('i', {}, text)));
	mount(doc.body, rows);

	const x = h('b', {}, 'x');
	const y = h('b', {}, 'y');
	atomic(() => {
		rows.splice(0, 0, x, y);
		const moved = rows[5];
		rows.splice(5, 1);
		rows.splice(1, 0, moved);
	});

	// The two adds are a run and the move lands between them, so the run's shared anchor is no
	// longer the right answer for the row before it.
	assert.equal(toHtml(doc.body),
		'<body><b>x</b><i>d</i><b>y</b><i>a</i><i>b</i><i>c</i><i>e</i><i>f</i></body>');
});
