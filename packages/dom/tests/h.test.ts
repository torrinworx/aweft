// h: elements, attributes and properties, static and reactive.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import type { LightElement } from '../src/index.ts';
import { createDocument, createElement, createTextNode, h, mount, setAttribute, toHtml, watch } from '../src/index.ts';

test('a static element is returned as the element itself, children and attributes set', () => {
	const div = h('div', { class: 'box', title: 'T', hidden: true, 'aria-hidden': false, 'data-n': 3 }, 'a', 1, null, h('i'));
	assert.equal(typeof (div as { nodeType?: unknown }).nodeType, 'number', 'a plain element');
	assert.equal(toHtml(div as never), '<div class="box" title="T" hidden data-n="3">a1<i></i></div>');
	assert.throws(() => h('div', {}, 'a', undefined), /undefined/);
	assert.throws(() => h(null), /tag/);
	assert.throws(() => h(3), /unsupported/);
	assert.throws(() => h('div', { style: { color: 'red' } }), /\$style/);
});

test('$name sets a property, a $style object sets style keys, and both follow a cell', () => {
	const { document, ops } = recordingDocument();
	const value = mutable('typed');
	const color = mutable('red');
	const el = h('input', { $value: value, $style: { color, 'font-weight': 'bold' }, $disabled: false, $custom: { nested: 1 } });
	const stop = mount(document.body, el);
	const input = document.body.firstChild as unknown as LightElement;

	assert.equal(input['value'], 'typed');
	assert.equal(input['disabled'], false);
	assert.deepEqual(input['custom'], { nested: 1 });
	assert.equal(input.style.cssText, 'font-weight: bold; color: red;');

	ops.length = 0;
	value.set('again');
	color.set('blue');
	assert.equal(input['value'], 'again');
	assert.equal(input.style['color'], 'blue');
	assert.deepEqual(ops, [], 'properties are not node operations');

	stop();
	value.set('after');
	assert.equal(input['value'], 'again', 'unbound after removal');
});

test('an attribute follows a cell: null and false remove it, true empties it', () => {
	const { document, ops } = recordingDocument();
	const state = mutable<unknown>('x');
	mount(document.body, h('div', { title: state }));
	const div = document.body.firstChild as unknown as LightElement;
	ops.length = 0;

	state.set(null);
	state.set(true);
	state.set(false);
	state.set(0);
	assert.deepEqual(ops, ['unattr title on <div>', 'attr title="" on <div>', 'unattr title on <div>', 'attr title="0" on <div>']);
	assert.equal(div.getAttribute('title'), '0');
});

test('children as a property, or as a body, but not both', () => {
	assert.equal(toHtml(h('p', { children: ['a', h('b')] }) as never), '<p>a<b></b></p>');
	assert.equal(toHtml(h('p', { children: null }) as never), '<p></p>');
	assert.equal(toHtml(h('p', { children: [] }, 'x') as never), '<p>x</p>');
	assert.throws(() => h('p', { children: 'a' }), /array/);
	assert.throws(() => h('p', { children: ['a'] }, 'b'), /body/);
});

test('a node as the tag is used as the element, a ref', () => {
	const doc = createDocument();
	const box = doc.createElement('section');
	const out = h(box, { id: 'ref' }, 'inside');
	assert.equal(out, box);
	assert.equal(toHtml(box), '<section id="ref">inside</section>');
});

test('reactive children bind where they sit, before and after static siblings', () => {
	const doc = createDocument();
	const a = mutable<unknown>('A');
	const b = mutable<unknown>(null);
	const stop = mount(doc.body, h('p', {}, a, 'mid', b, h('i'), a.map((v) => `${String(v)}!`)));
	assert.equal(toHtml(doc.body), '<body><p>Amid<i></i>A!</p></body>');
	b.set('B');
	a.set('C');
	assert.equal(toHtml(doc.body), '<body><p>CmidB<i></i>C!</p></body>');
	stop();
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('adjacent reactive children keep their order when one of them changes', () => {
	const doc = createDocument();
	const a = mutable<unknown>('A');
	const b = mutable<unknown>('B');
	const c = mutable<unknown>(null);
	mount(doc.body, h('p', {}, a, b, c, 'tail'));
	assert.equal(toHtml(doc.body), '<body><p>ABtail</p></body>');
	a.set(h('i', {}, 'X'));
	assert.equal(toHtml(doc.body), '<body><p><i>X</i>Btail</p></body>', 'a remounted first child goes before its sibling');
	c.set('C');
	assert.equal(toHtml(doc.body), '<body><p><i>X</i>BCtail</p></body>', 'an empty child filled in lands before the static tail');
	b.set(null);
	a.set('A');
	assert.equal(toHtml(doc.body), '<body><p>ACtail</p></body>');
});

test('nested reactive elements flatten into one bound tree', () => {
	const doc = createDocument();
	const inner = mutable('x');
	const stop = mount(doc.body, h('div', {}, h('span', {}, inner), h('b', { title: inner })));
	assert.equal(toHtml(doc.body), '<body><div><span>x</span><b title="x"></b></div></body>');
	inner.set('y');
	assert.equal(toHtml(doc.body), '<body><div><span>y</span><b title="y"></b></div></body>');
	stop();
	inner.set('z');
	assert.equal(toHtml(doc.body), '<body></body>');
});

test('a mounted node cannot be mounted again elsewhere', () => {
	const doc = createDocument();
	const box = h('div');
	mount(doc.body, box);
	assert.throws(() => mount(doc.body, box), /already mounted/);
});

test('the host pieces: createElement, createTextNode, setAttribute and watch', () => {
	const svg = createElement('circle', 'http://www.w3.org/2000/svg');
	assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
	const div = createElement('div');
	assert.equal(div.localName, 'div');
	assert.equal(createTextNode('t').data, 't');

	setAttribute(div, 'a', 1);
	setAttribute(div, 'b', true);
	setAttribute(div, 'c', 'x');
	setAttribute(div, 'c', undefined);
	assert.equal(toHtml(div), '<div a="1" b></div>');

	const seen: unknown[] = [];
	const cell = mutable(1);
	const stop = watch(cell, (v) => seen.push(v));
	cell.set(2);
	stop();
	cell.set(3);
	const plain = watch('static', (v) => seen.push(v));
	plain();
	assert.deepEqual(seen, [1, 2, 'static']);
});

test('inside a static render, h creates through the render document', async () => {
	const { render } = await import('../src/index.ts');
	let made: unknown;
	const App = () => {
		made = createElement('p');
		return made;
	};
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><p></p><!--]-->');
	assert.notEqual((made as { ownerDocument: unknown }).ownerDocument, createDocument());
});
