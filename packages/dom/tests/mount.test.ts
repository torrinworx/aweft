// mount: every kind of item, in place updates, anchors, removal and duck-typed targets.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, mutable, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import { createDocument, getFirst, h, mount, toHtml } from '../src/index.ts';

test('primitives mount as text, null as nothing, undefined is refused', () => {
	const doc = createDocument();
	for (const [item, markup] of [['text', 'text'], [0, '0'], [false, 'false'], [true, 'true'], [null, '']] as const) {
		const stop = mount(doc.body, item);
		assert.equal(toHtml(doc.body), `<body>${markup}</body>`);
		stop();
		assert.equal(toHtml(doc.body), '<body></body>');
	}
	assert.throws(() => mount(doc.body, undefined), /undefined/);
	assert.throws(() => mount(doc.body, { plain: true }), /plain object/);
});

test('mount returns the remove function, which answers getFirst and removes twice quietly', () => {
	const doc = createDocument();
	const p = doc.createElement('p');
	const stop = mount(doc.body, p);
	assert.equal(stop(getFirst), p);
	stop();
	stop();
	assert.equal(toHtml(doc.body), '<body></body>');
	assert.equal(mount(doc.body, null)(getFirst), null, 'a null mount answers its anchor');
});

test('a cell updates its text node in place, and a type change remounts', () => {
	const { document, ops } = recordingDocument();
	const cell = mutable<unknown>('a');
	const stop = mount(document.body, cell);
	const text = document.body.firstChild;
	ops.length = 0;

	cell.set('b');
	assert.equal(document.body.firstChild, text, 'the same text node');
	assert.deepEqual(ops, ['text "a" -> "b"']);

	ops.length = 0;
	const node = document.createElement('i');
	cell.set(node);
	assert.equal(document.body.firstChild, node);
	assert.deepEqual(ops, ['remove "b" from <body>', 'insert <i> into <body> before end']);

	cell.set(node);
	assert.equal(document.body.firstChild, node, 'the same node is kept');
	cell.set(null);
	assert.equal(document.body.firstChild, null);
	cell.set(1);
	assert.equal(toHtml(document.body), '<body>1</body>');
	assert.throws(() => cell.set(undefined), /undefined/);
	assert.throws(() => cell.set(mutable(1)), /unwrap/);
	stop();
	cell.set('late');
	assert.equal(toHtml(document.body), '<body></body>', 'an update after removal is ignored');
});

test('a scope on a document slot mounts its value and follows it', () => {
	const doc = createDocument();
	const state = createObject<Record<string, unknown>>({ title: 'one' });
	mount(doc.body, h('h1', {}, observer(state).path('title')));
	assert.equal(toHtml(doc.body), '<body><h1>one</h1></body>');
	state.title = 'two';
	assert.equal(toHtml(doc.body), '<body><h1>two</h1></body>');
});

test('an anchor puts a mount before another, and getFirst falls through empties', () => {
	const doc = createDocument();
	const tail = mount(doc.body, h('p', {}, 'tail'));
	const empty = mount(doc.body, null, tail);
	const head = mount(doc.body, h('p', {}, 'head'), empty);
	assert.equal(toHtml(doc.body), '<body><p>head</p><p>tail</p></body>');
	assert.equal(empty(getFirst), tail(getFirst), 'an empty mount answers with what is after it');
	head();
	assert.equal(toHtml(doc.body), '<body><p>tail</p></body>');
});

test('a plain array mounts in order, and an observed array reconciles by reference', () => {
	const { document, ops } = recordingDocument();
	const a = document.createElement('a');
	const b = document.createElement('b');
	const items = mutable<unknown[]>([a, 'x', b]);
	mount(document.body, items);
	assert.equal(toHtml(document.body), '<body><a></a>x<b></b></body>');

	ops.length = 0;
	items.set([b, 'x', a]);
	assert.equal(toHtml(document.body), '<body><b></b>x<a></a></body>');
	assert.ok(ops.every((op) => !op.startsWith('remove <')), `nodes were moved, not rebuilt: ${ops.join(' | ')}`);

	items.set([]);
	assert.equal(toHtml(document.body), '<body></body>');
	assert.throws(() => items.set([a, a]), /already mounted/, 'one node cannot be in two places');
});

test('unmounting removes the top node only; what is below it goes with it', () => {
	const { document, ops } = recordingDocument();
	const inner = mutable<unknown>(h('b', {}, 'x'));
	const rows = mutable(['r1', 'r2']);
	const stop = mount(document.body, h('div', {}, inner, h('ul', {}, rows)));
	ops.length = 0;
	stop();
	assert.deepEqual(ops, ['remove <div> from <body>']);
	assert.equal(toHtml(document.body), '<body></body>');
});

test('a duck-typed target with only the three methods works, and so does a nested mount', () => {
	const doc = createDocument();
	const seen: string[] = [];
	const target = {
		insertBefore: (node: unknown, before: unknown) => { seen.push(`insert ${(node as { localName?: string }).localName ?? 'text'} before ${before === null ? 'end' : 'node'}`); },
		removeChild: (node: unknown) => { seen.push(`remove ${(node as { localName?: string }).localName ?? 'text'}`); },
		replaceChild: () => { seen.push('replace'); },
		ownerDocument: doc,
	};
	const stop = mount(target, [h('p'), 'x']);
	assert.deepEqual(seen, ['insert p before end', 'insert text before end']);
	stop();
	assert.deepEqual(seen.slice(2), ['remove p', 'remove text']);
});

test('a mounter receives the target, its anchor and the context, and its result is used', () => {
	const doc = createDocument();
	const heard: unknown[] = [];
	const inner = (elem: unknown, item: unknown, before: (arg: typeof getFirst) => unknown, context: unknown) => {
		heard.push(elem === doc.body, typeof item, before(getFirst), context);
		return mount(elem as typeof doc.body, h('em', {}, 'in'), before as never, context);
	};
	const tail = mount(doc.body, h('p'));
	const stop = mount(doc.body, inner, tail, { theme: 'dark' });
	assert.deepEqual(heard, [true, 'function', tail(getFirst), { theme: 'dark' }]);
	assert.equal(toHtml(doc.body), '<body><em>in</em><p></p></body>');
	stop();
	assert.equal(toHtml(doc.body), '<body><p></p></body>');
});

test('a target with no document and no page is refused', () => {
	assert.throws(() => mount({ insertBefore: () => null, removeChild: () => null, replaceChild: () => null }, 'x'), /document/);
});
