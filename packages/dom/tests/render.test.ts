// render and hydrate: static markup out, adopted in place back in.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray, createObject, mutable, observer } from '@aweftjs/core';
import { recordingDocument } from '@aweftjs/testing';

import type { Cleanup, LightElement, Mounted, Pending } from '../src/index.ts';
import { createDocument, getFirst, h, hydrate, mount, render, toHtml } from '../src/index.ts';

interface Row extends Record<string, unknown> { label?: string }
const row = (label: string): Row => createObject<Row>({ label });

test('render brackets every dynamic part and returns markup with no document', async () => {
	const count = mutable(1);
	const rows = createArray<Row>([row('a'), row('b')]);
	const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));
	const App = () => h('main', {}, h('p', {}, 'hello ', count), h('ul', {}, h(Item, { each: rows })));
	const markup = await render(h(App));
	assert.equal(markup,
		'<!--[--><main><p>hello <!--[-->1<!--]--></p><ul><!--[-->'
		+ '<!--[--><!--[--><li><!--[-->a<!--]--></li><!--]--><!--]-->'
		+ '<!--[--><!--[--><li><!--[-->b<!--]--></li><!--]--><!--]-->'
		+ '<!--]--></ul></main><!--]-->');
	assert.equal(await render('plain'), 'plain');
	assert.equal(await render([h('i'), null, 'x']), '<i></i>x');
});

test('render waits for pending content, and the mount is live while it waits', async () => {
	const text = mutable('loading');
	const Loader = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending) => {
		pending(new Promise<void>((resolve) => setTimeout(() => {
			text.set('loaded');
			// A settled promise may register another; render waits for that one too.
			pending(new Promise<void>((r) => setTimeout(() => { text.set('done'); r(); }, 5)));
			resolve();
		}, 5)));
		return h('p', {}, text);
	};
	assert.equal(await render(h(Loader)), '<!--[--><p><!--[-->done<!--]--></p><!--]-->');
	const rejected = (_p: unknown, _c: Cleanup, _m: Mounted, pending: Pending) => {
		pending(Promise.reject(new Error('fetch failed')));
		return 'fallback';
	};
	assert.equal(await render(h(rejected)), '<!--[-->fallback<!--]-->', 'a rejected promise does not hang the render');
});

test('render hands its context to every mounter below', async () => {
	const Reader = () => (elem: never, _i: unknown, before: (a: typeof getFirst) => unknown, context: { site: string }) =>
		mount(elem, context.site, before as never, context);
	assert.equal(await render(h(Reader), { context: { site: 'here' } }), '<!--[-->here<!--]-->');
});

test('hydrate adopts the server nodes in place and the page stays live', async () => {
	const count = mutable(1);
	const rows = createArray<Row>([row('a'), row('b')]);
	let clicks = 0;
	const Item = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));
	const App = () => h('main', {},
		h('p', { class: 'x', $onclick: () => { clicks += 1; } }, 'hello ', count, ' ', 'there'),
		h('ul', {}, h(Item, { each: rows })),
	);

	const markup = await render(h(App));
	const { document, ops } = recordingDocument();
	document.body.innerHTML = markup;
	const main = (document.body as LightElement).children[0]!;
	const p = main.children[0]!;
	const firstLi = main.children[1]!.children[0]!;
	ops.length = 0;

	const stop = hydrate(document.body, h(App));
	assert.equal((document.body as LightElement).children[0], main, 'the main element is the server node');
	assert.equal(main.children[0], p);
	assert.equal(main.children[1]!.children[0], firstLi);
	assert.equal(toHtml(document.body), `<body>${markup}</body>`, 'nothing in the tree changed');
	assert.deepEqual(ops.filter((op) => op.startsWith('remove') || op.startsWith('clear')), [],
		`nothing was removed: ${ops.join(' | ')}`);
	assert.equal(stop(getFirst)!.nodeName, '#comment', 'the outer region marker is the first node');

	p.dispatchEvent({ type: 'click' });
	assert.equal(clicks, 1, 'the listener is on the adopted node');

	count.set(2);
	rows.push(row('c'));
	rows[0]!.label = 'A';
	assert.equal(main.children[0]!.textContent, 'hello 2 there');
	assert.equal(main.children[1]!.textContent, 'Abc');
	assert.equal(main.children[1]!.children[0], firstLi, 'the first row is still the adopted node');

	stop();
	assert.equal(toHtml(document.body), '<body></body>');
});

test('hydrate sets properties and listeners, and splits a server text that serialized two client texts', async () => {
	const App = () => h('label', {}, h('input', { $value: 'typed', $checked: true, type: 'checkbox' }), 'a', 'b');
	const markup = await render(h(App));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const label = doc.body.children[0]!;
	const input = label.children[0]!;
	assert.equal(label.childNodes.length, 2, 'the server has one text node for a and b');

	hydrate(doc.body, h(App));
	assert.equal(input['value'], 'typed');
	assert.equal(input['checked'], true);
	assert.equal(label.childNodes.length, 3, 'split so each client text node has a server one');
	assert.equal(label.textContent, 'ab');
});

test('hydrate refuses a structural mismatch and heals an attribute or text difference loudly', async () => {
	const markup = await render(h('main', {}, h('p', { class: 'x' }, 'hi')));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, h('main', {}, h('div', {}, 'hi'))), /expected a <div> and found a <p>/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, h('main', {}, h('p', { class: 'y' }, 'hi'))), /attribute mismatch/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, h('main', {}, h('p', { class: 'x' }, 'bye'))), /text mismatch/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, h('main', {}, h('p', { class: 'x' }, 'hi'), h('i'))), /ran out/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, h('main', {}, h('p', { class: 'x' }))), /did not render/);

	doc.body.innerHTML = markup;
	assert.throws(() => hydrate(doc.body, h('main', {}, mutable('hi'))), /no marker region/);

	doc.body.innerHTML = `<main>${markup}</main>`;
	assert.throws(() => hydrate(doc.body, h('main', {}, h('p', { class: 'x' }, 'hi'))), /expected a <p> and found a <main>/);
});

test('an attribute a cell drives is set on the adopted node, not read as a mismatch', async () => {
	const done = mutable(true);
	const App = () => h('li', { class: done.bool('done', null), id: 'row' }, 'x');
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><li id="row" class="done">x</li><!--]-->');
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const li = doc.body.children[0]!;
	hydrate(doc.body, h(App));
	assert.equal(doc.body.children[0], li);
	assert.equal(li.getAttribute('class'), 'done');
	done.set(false);
	assert.equal(li.hasAttribute('class'), false);
});

test('a $style object survives render and hydrate: the markup has the attribute, the client sets the property', async () => {
	const App = () => h('div', { $style: { color: 'red' }, class: 'c' }, 'x');
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><div class="c" style="color: red;">x</div><!--]-->');
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const div = doc.body.children[0]!;
	div.style.cssText = '';
	hydrate(doc.body, h(App));
	assert.equal(doc.body.children[0], div, 'the server element is adopted, not read as a mismatch');
	assert.equal(div.style.cssText, 'color: red;', 'the property is set on the adopted node');
});

test('a second hydrate over a live one is refused, and works again once the first is removed', async () => {
	const markup = await render(h('p', {}, 'x'));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const stop = hydrate(doc.body, h('p', {}, 'x'));
	assert.throws(() => hydrate(doc.body, h('p', {}, 'x')), /already holds a live hydration/);
	assert.equal(toHtml(doc.body), '<body><p>x</p></body>', 'the first hydration still holds its nodes');
	stop();
	doc.body.innerHTML = markup;
	const again = hydrate(doc.body, h('p', {}, 'x'));
	assert.equal(toHtml(doc.body), '<body><p>x</p></body>');
	again();
});

test('a node the application made is inserted, never claimed', async () => {
	const doc = createDocument();
	const own = doc.createElement('canvas');
	const App = () => h('div', {}, own);
	const markup = await render(h(App));
	assert.equal(markup, '<!--[--><div><canvas></canvas></div><!--]-->');
	doc.body.innerHTML = markup;
	hydrate(doc.body, h(App));
	assert.equal(doc.body.children[0]!.children[0], own, 'the application node itself is in the tree');
});

test('hydrate needs a document, and answers getFirst', async () => {
	assert.throws(() => hydrate({ insertBefore: () => null, removeChild: () => null, replaceChild: () => null }, 'x'), /document/);
	const doc = createDocument();
	doc.body.innerHTML = await render('x');
	const stop = hydrate(doc.body, 'x');
	assert.equal(stop(getFirst), doc.body.firstChild);
});
