// The hoisted template, driven directly rather than through the transform that emits it.
//
// The expectations are written from what the equivalent `h` calls do, which is the contract: an
// instance is what `h` would have returned for the same subtree (designs 089, 093, 094).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';

import { createDocument, h, hydrate, joined, mount, parseHtml, render, template, toHtml } from '../src/index.ts';
import type { LightDocument, LightElement, LightNode, LightText } from '../src/index.ts';

/**
 * The light tree with nodes that clone, which is what a browser has and the light tree does not.
 * Written here from what cloning means, so the template's browser path has something to run on.
 *
 * `made` counts only what the document was asked for through `createElement`. Cloning goes around
 * it, as it does in a browser, so the count says how many elements were built rather than copied.
 */
const cloningDocument = (made: { count: number } = { count: 0 }): LightDocument => {
	const document = createDocument();
	const element = document.createElement.bind(document);
	const text = document.createTextNode.bind(document);

	const withText = (node: LightText): LightText => {
		(node as { cloneNode?: unknown }).cloneNode = () => withText(text(node.data));
		return node;
	};
	const withClone = (node: LightElement): LightElement => {
		(node as { cloneNode?: unknown }).cloneNode = (deep: boolean) => clone(node, deep);
		return node;
	};
	const clone = (node: LightNode, deep: boolean): LightNode => {
		if (node.nodeType !== 1) return withText(text((node as LightText).data));
		const source = node as LightElement;
		const copy = withClone(element(source.localName));
		for (const name of source.getAttributeNames()) copy.setAttribute(name, source.getAttribute(name) ?? '');
		if (deep) for (let n = source.firstChild; n !== null; n = n.nextSibling) copy.appendChild(clone(n, true));
		return copy;
	};

	document.createElement = (tag: string): LightElement => {
		made.count += 1;
		return withClone(element(tag));
	};
	document.createTextNode = (data: string): LightText => withText(text(data));
	return document;
};

const markupOf = (item: unknown, make: () => LightDocument = createDocument): string => {
	const document = make();
	mount(document.body, item);
	return toHtml(document.body);
};

const row = template(
	['tr', { class: 'row' }, ['td', { class: 'a' }], ['td', { class: 'b' }, ['span', null, 'fixed']]],
	[['child', [0], -1], ['props', [1, 0]]],
);

test('an instance is the same tree the equivalent h calls make', () => {
	for (const make of [createDocument, cloningDocument]) {
		const built = markupOf(row(['one', { title: 'here' }]), make);
		const written = markupOf(
			h('tr', { class: 'row' },
				h('td', { class: 'a' }, 'one'),
				h('td', { class: 'b' }, h('span', { title: 'here' }, 'fixed'))),
			make,
		);
		assert.equal(built, written);
	}
});

test('an instance with nothing reactive in it is the element itself, as h answers', () => {
	const plain = template(['p', { class: 'x' }, 'body'], []);
	const instance = plain([]) as LightElement;
	assert.equal(instance.nodeType, 1);
	assert.equal(instance.localName, 'p');
	assert.equal(toHtml(instance), '<p class="x">body</p>');
});

test('the prototype belongs to the document, not to the module', () => {
	const first = cloningDocument();
	const second = cloningDocument();
	const App = () => row(['x', null]);
	mount(first.body, h(App));
	mount(second.body, h(App));
	assert.equal(first.body.firstChild!.ownerDocument, first);
	assert.equal(second.body.firstChild!.ownerDocument, second);
});

test('a reactive part anywhere inside reaches mount as one bound value', () => {
	const label = mutable('first');
	const tone = mutable('warm');
	const item = template(
		['div', { class: 'card' }, ['h1', null], ['p', null, 'static']],
		[['child', [0], -1], ['props', [1]], ['props', []]],
	)([label, { class: tone }, { $title: 'set' }]);

	const document = createDocument();
	mount(document.body, item);
	assert.equal(toHtml(document.body), '<body><div class="card"><h1>first</h1><p class="warm">static</p></div></body>');
	label.set('second');
	tone.set('cool');
	assert.equal(toHtml(document.body), '<body><div class="card"><h1>second</h1><p class="cool">static</p></div></body>');
});

test('a varying child that is a node, a primitive or null lands where h puts it', () => {
	const gaps = template(['p', null, ['i', null, 'mid'], 'tail'], [
		['child', [], 0], ['child', [], 0], ['child', [], 1], ['child', [], -1],
	]);
	assert.equal(
		markupOf(gaps([h('b', {}, 'node'), 'text', null, 42])),
		markupOf(h('p', {}, h('b', {}, 'node'), 'text', h('i', {}, 'mid'), null, 'tail', 42)),
	);
});

test('a reactive child anchors on the node a later varying child put down', () => {
	const cell = mutable('first');
	const gap = template(['p', { class: 'g' }], [['child', [], -1], ['child', [], -1]]);
	assert.equal(
		markupOf(gap([cell, ' then plain'])),
		markupOf(h('p', { class: 'g' }, cell, ' then plain')),
	);
});

test('the prototype is built once per document and cloned after that', () => {
	// A page that made the prototype again per row would pay `h`'s cost per row, which is the whole
	// saving. Counting what the document was asked to make is how that is visible from outside.
	const made = { count: 0 };
	const document = cloningDocument(made);

	const three = template(['ul', null, ['li', null, 'a'], ['li', null, 'b']], [['props', []]]);
	const App = () => [three([{ title: 'one' }]), three([{ title: 'two' }]), three([{ title: 'three' }])];
	mount(document.body, h(App));

	assert.equal(made.count, 3, 'three elements made: the prototype once, and nothing per instance');
	assert.equal(document.body.children.length, 3);
	assert.equal(document.body.children[2]!.getAttribute('title'), 'three');
});

test('rendering with no browser builds rather than clones, and the markup is the same', async () => {
	const label = mutable('server');
	assert.equal(
		await render(row([label, { title: 'x' }])),
		await render(h('tr', { class: 'row' }, h('td', { class: 'a' }, label), h('td', { class: 'b' }, h('span', { title: 'x' }, 'fixed')))),
	);
});

test('a varying child that is undefined asserts, as h does', () => {
	const one = template(['p', null], [['child', [], -1]]);
	assert.throws(() => one([undefined]), /cannot mount undefined/);
});

test('an edit naming a node the template does not have asserts', () => {
	const bad = template(['p', null], [['props', [4]]]);
	assert.throws(() => bad([{ title: 'x' }]), /names a node the template does not have/);
});

test('one element\'s child edits have to be listed together', () => {
	assert.throws(
		() => template(['p', null, ['i', null]], [['child', [], 0], ['child', [0], -1], ['child', [], -1]]),
		/child edits in two places/,
	);
});

test('a properties edit takes an object', () => {
	const bad = template(['p', null], [['props', []]]);
	assert.throws(() => bad(['not an object']), /takes an object of properties/);
	assert.equal(toHtml(bad([null]) as LightElement), '<p></p>');
});

test('joined concatenates plain parts and derives when one part is a cell', () => {
	assert.equal(joined(['note ', 'warm', ' big']), 'note warm big');

	const tone = mutable('warm');
	const derived = joined(['note ', tone]) as { get(): unknown };
	assert.equal(derived.get(), 'note warm');
	tone.set('cool');
	assert.equal(derived.get(), 'note cool');
});

test('a path is resolved against the untouched instance, before anything is put in', () => {
	// This is the shape `h('ul', { class: 'u' }, plain, h('li', { class: 'x' }, cell))` compiles
	// to. The first step puts a child in front of the `li`, which moves the `li` from index 0 to
	// index 1. Resolve the second step's path when that step runs and it finds the new child
	// instead, and the `li` comes out empty.
	const both = template(['ul', { class: 'u' }, ['li', { class: 'x' }]], [['child', [], 0], ['child', [0], -1]]);
	for (const make of [createDocument, cloningDocument]) {
		assert.equal(markupOf(both(['P', 'B']), make), '<body><ul class="u">P<li class="x">B</li></ul></body>');
	}
});

test('hydration adopts the server nodes whether the instance was cloned or built', async () => {
	// `hydrating()` is only true while a mount runs, and a page builds the item it hands to
	// `hydrate` before that. So the clone path is a hydration path too, and an instance it makes
	// has to be claimable: otherwise hydrating a hoisted page detaches the markup and rebuilds it.
	const plain = template(['p', { class: 'c' }, ['b', null, 'fixed']], []);
	const written = (): unknown => h('p', { class: 'c' }, h('b', {}, 'fixed'));

	const outsideAMount = (document: LightDocument): unknown => {
		const global = globalThis as { document?: unknown };
		global.document = document;
		try {
			return plain([]);
		} finally {
			delete global.document;
		}
	};

	// Each way hydrates over the markup the same shape rendered, so the only difference between
	// them is which path inside `template` made the instance.
	const ways: readonly [where: string, server: () => unknown, client: (document: LightDocument) => unknown][] = [
		['made outside a mount, so cloned', written, outsideAMount],
		['made inside one, so built', () => h(written), () => h(() => plain([]))],
	];

	for (const [where, server, client] of ways) {
		const markup = await render(server());
		const document = cloningDocument();
		const item = client(document);
		for (const node of parseHtml(markup, document)) document.body.appendChild(node as LightElement);
		const sent = document.body.children[0]!;
		hydrate(document.body, item);
		assert.equal(document.body.children[0], sent, `${where}: the server node was not adopted`);
		assert.match(toHtml(document.body), /<p class="c"><b>fixed<\/b><\/p>/, where);
	}
});
