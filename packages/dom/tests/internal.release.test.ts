// The production paths: what a release build does where a dev build asserts (design 078).
// White-box, because the release switch is a test seam and not surface.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';

import { release } from '../src/assert.ts';
import { createDocument, h, hydrate, mount, render, toHtml } from '../src/index.ts';

test('in release, a mismatched region is replaced with what the client built', async (t) => {
	release(true);
	t.after(() => release(false));

	const markup = await render(h('main', {}, h('p', { class: 'x' }, 'hi'), h('b', {}, 'keep')));
	const doc = createDocument();
	doc.body.innerHTML = markup;
	const main = doc.body.children[0]!;
	const b = main.children[1]!;

	hydrate(doc.body, h('main', {}, h('div', {}, 'new'), h('b', {}, 'keep')));
	assert.equal(doc.body.children[0], main, 'the matched parent is kept');
	assert.equal(toHtml(main), '<main><div>new</div><b>keep</b></main>');
	assert.notEqual(main.children[1], b, 'from the mismatch on, the client nodes stand');

	// A dynamic mount with no region left: mounted fresh, and the server surplus dropped.
	doc.body.innerHTML = await render(h('main', {}, 'static'));
	hydrate(doc.body, h('main', {}, 'static', mutable('cell')));
	assert.equal(toHtml(doc.body), '<body><main>staticcell</main></body>');

	// Surplus the server sent and the client did not render is dropped at the end.
	doc.body.innerHTML = await render(h('main', {}, h('p', {}, 'a'), h('i', {}, 'extra'), mutable('x')));
	hydrate(doc.body, h('main', {}, h('p', {}, 'a')));
	assert.equal(toHtml(doc.body), '<body><main><p>a</p></main></body>');

	// An attribute or text that differs is set to the client's value.
	doc.body.innerHTML = await render(h('p', { class: 'x', id: 'gone' }, 'hi'));
	hydrate(doc.body, h('p', { class: 'y' }, 'bye'));
	assert.equal(toHtml(doc.body), '<body><p class="y">bye</p></body>');
});

test('in release, the footguns pass silently', (t) => {
	release(true);
	t.after(() => release(false));
	const doc = createDocument();
	mount(doc.body, h('p', {}, undefined));
	assert.equal(toHtml(doc.body), '<body><p></p></body>');
});
