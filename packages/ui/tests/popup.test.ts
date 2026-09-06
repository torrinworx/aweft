// The popup system with no browser: where a popup goes in the tree, and how it comes back out.
// Where it goes on the screen is `internal.placement.test.ts`, and what a real browser does with
// it is `browser.test.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';
import { Detached, Popup, PopupContext, context, h, hydrate, mark, mount, render, trackedMount } from '@aweftjs/ui';

const somewhere = { mode: 'below-start' as const, left: 10, top: 20, maxWidth: 100, maxHeight: 60, transformOrigin: 'top left' };

test('a popup renders nothing where it is written and everything at the sink', () => {
	const where = mutable<typeof somewhere | null>(somewhere);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h('main', {}, 'the page', h(Popup as never, { placement: where }, h('nav', {}, 'menu')))));

	const markup = toHtml(document.body.childNodes);
	assert.match(markup, /^<main>the page<\/main>/, 'the page has no popup inside it');
	assert.match(markup, /<div style="[^"]*left: 10px[^"]*"><nav>menu<\/nav><\/div>$/, 'the popup is after the page');
	stop();
});

test('a null placement hides the popup and a value shows it again', () => {
	const where = mutable<typeof somewhere | null>(null);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {}, h(Popup as never, { placement: where }, 'inside')));

	assert.match(toHtml(document.body.childNodes), /style="display: none;"/);
	where.set(somewhere);
	assert.match(toHtml(document.body.childNodes), /position: fixed/);
	assert.match(toHtml(document.body.childNodes), /max-height: 60px/);
	where.set(null);
	assert.match(toHtml(document.body.childNodes), /style="display: none;"/);
	stop();
});

test('a popup leaves the sink when it unmounts', () => {
	const shown = mutable(true);
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		shown.bool(h(Popup as never, { placement: somewhere }, 'inside'), null)), undefined, own);

	assert.equal(own.popups.items.length, 1);
	shown.set(false);
	assert.equal(own.popups.items.length, 0, 'the popup took itself out of the sink');
	assert.doesNotMatch(toHtml(document.body.childNodes), /inside/);
	stop();
});

test('a popup with no PopupContext above it asserts, and names what to wrap the page in', () => {
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h(Popup as never, { placement: somewhere }, 'inside')),
		/needs a PopupContext above it/,
	);
});

test('two PopupContexts keep their popups apart', () => {
	const own = context();
	const document = createDocument();
	const stop = mount(document.body, [
		h(PopupContext, {}, h('section', {}, 'one'), h(Popup as never, { placement: somewhere }, 'first')),
		h(PopupContext, {}, h('section', {}, 'two'), h(Popup as never, { placement: somewhere }, 'second')),
	], undefined, own);

	// The first provider took the render's own sink; the second made one, because two providers
	// rendering one list would mount every popup in it twice.
	assert.equal(own.popups.items.length, 1);
	const markup = toHtml(document.body.childNodes);
	assert.ok(markup.indexOf('first') < markup.indexOf('two'), 'each popup sits inside its own context');
	stop();
});

test('trackedMount hands back the real nodes without keeping them out of the document', () => {
	const [nodes, virtual] = trackedMount();
	const document = createDocument();
	const stop = mount(document.body, [h(virtual as never, {}, h('b', {}, 'one'), h('i', {}, 'two')), nodes]);

	assert.equal(nodes.length, 2);
	assert.equal((nodes[0] as LightElement).localName, 'b');
	assert.equal(toHtml(document.body.childNodes), '<b>one</b><i>two</i>', 'the nodes still landed in the page');
	stop();
});

test('Detached renders its anchor where it was written and its popup at the sink', () => {
	const open = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext, {},
		h(Detached as never, { enabled: open },
			h('button', {}, 'menu'),
			h(mark.popup, {}, h('nav', {}, 'the menu')))));

	const markup = toHtml(document.body.childNodes);
	assert.match(markup, /^<button>menu<\/button>/);
	// Closed, and with no way to measure anything, the popup is present and hidden.
	assert.match(markup, /<div style="display: none;"><nav>the menu<\/nav><\/div>$/);
	stop();
});

test('nothing in the package writes a z-index', async () => {
	const { readdirSync, readFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { fileURLToPath } = await import('node:url');
	const dir = fileURLToPath(new URL('../src/', import.meta.url));

	const found: string[] = [];
	const walk = (at: string): void => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			const path = join(at, entry.name);
			if (entry.isDirectory()) walk(path);
			// The property being written, in either spelling. The words in a comment are not it.
			else if (/\bzIndex\s*:|z-index\s*:/.test(readFileSync(path, 'utf8'))) found.push(entry.name);
		}
	};
	walk(dir);
	assert.deepEqual(found, [], 'design 113 says this package writes no z-index, anywhere');
});

test('a registry removal is safe to run twice, and takes nothing else with it', () => {
	const own = context();
	const first = own.popups.add('first');
	own.popups.add('second');
	assert.deepEqual([...own.popups.items], ['first', 'second']);

	first();
	first();
	// An index looked up and not found is -1, and splice(-1, 1) takes the last item out instead
	// of nothing, which is how the second one would disappear.
	assert.deepEqual([...own.popups.items], ['second']);
});

test('a registry is claimed once, so two renderers cannot both take it', () => {
	const own = context();
	assert.equal(own.popups.claim(), true);
	assert.equal(own.popups.claim(), false);
});

test('every shape of popup under a PopupContext renders, parses and hydrates', async () => {
	// A popup mounts at the sink, which is after the page, and a hydration takes the server's
	// marker regions in the order the mounts ask for them. Mount the sink before the page and
	// the sink takes the region belonging to a popup written beside the page.
	const shapes: Record<string, () => unknown> = {
		'closed, last': () => {
			const where = mutable<typeof somewhere | null>(null);
			return h(PopupContext, {},
				h('div', { id: 'page' }, 'body'),
				h(Popup as never, { placement: where }, h('div', {}, 'contents')));
		},
		'open at render, last': () => {
			const where = mutable<typeof somewhere | null>(somewhere);
			return h(PopupContext, {},
				h('div', { id: 'page' }, 'body'),
				h(Popup as never, { placement: where }, h('div', {}, 'contents')));
		},
		'closed, first': () => {
			const where = mutable<typeof somewhere | null>(null);
			return h(PopupContext, {},
				h(Popup as never, { placement: where }, h('div', {}, 'contents')),
				h('div', { id: 'page' }, 'body'));
		},
		'inside an element': () => {
			const where = mutable<typeof somewhere | null>(null);
			return h(PopupContext, {},
				h('div', { id: 'page' }, 'body', h(Popup as never, { placement: where }, h('div', {}, 'contents'))));
		},
		'a Detached inside the page': () => {
			const open = mutable(false);
			return h(PopupContext, {},
				h('div', { id: 'page' },
					h(Detached as never, { enabled: open },
						h('button', {}, 'menu'),
						h(mark.popup, {}, h('div', { class: 'menu-body' }, 'contents')))));
		},
		'no popup at all': () => h(PopupContext, {}, h('div', { id: 'page' }, 'body')),
	};

	for (const [name, page] of Object.entries(shapes)) {
		const markup = await render(page(), { context: context() });
		const document = createDocument();
		for (const node of parseHtml(markup, document)) document.body.appendChild(node);
		const stop = hydrate(document.body, page());
		assert.equal(toHtml(document.body.childNodes), markup, `${name}: hydration changed the page`);
		stop();
	}
});
