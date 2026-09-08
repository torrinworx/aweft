// The per-render object and the three entry points (design 109), asserted against the exact
// operations a mount performed, not only against the tree it left behind.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, mount as domMount, parseHtml, toHtml } from '@aweftjs/dom';
import type { DocumentLike, LightDocument } from '@aweftjs/dom';
import { recordingDocument } from '@aweftjs/testing';
import { createRouter } from '@aweftjs/dom/router';
import type { Router } from '@aweftjs/dom/router';
import { Stage, StageContext, Theme, context, h, hydrate, mount, render, use } from '@aweftjs/ui';

// Entries of this file's own. Defining a property the default theme already sets, with another
// value, is a refusal (design 111), so a test theme picks names the library does not use.
Theme.define({
	slab: { padding: 8 },
	badge: { color: 'red' },
});

/** Count what a document was asked to make, so "zero createElement" is a number, not a claim. */
const counting = (document: LightDocument): { document: DocumentLike; made: Record<string, number> } => {
	const made: Record<string, number> = { createElement: 0, createTextNode: 0, createComment: 0 };
	const target = document as unknown as Record<string, (...args: unknown[]) => unknown>;
	for (const factory of Object.keys(made)) {
		const call = target[factory]!.bind(document);
		target[factory] = (...args: unknown[]) => {
			made[factory]! += 1;
			return call(...args);
		};
	}
	return { document: document as unknown as DocumentLike, made };
};

test('a ui system reached with no ui context asserts, and names the fix', () => {
	const document = createDocument();
	assert.throws(
		() => domMount(document.body, h('p', { theme: 'slab' }, 'x')),
		/mount with ui's mount, render or hydrate/,
	);
});

test('every entry point makes the five systems, and context() makes one to hold', () => {
	const own = context();
	assert.deepEqual(Object.keys(own).sort(), ['head', 'ids', 'popups', 'stage', 'theme']);
	assert.equal(own.ids.next(), 'aw-0');
	assert.equal(own.ids.next('ctx'), 'ctx-1');
	assert.equal(own.popups.items.length, 0);
	// The head list and the stage registry start empty, and a caller can reach both.
	assert.equal(own.head.items.length, 0);
	assert.equal(own.stage.items.length, 0);
});

test('a component reaches the render it is mounted in', () => {
	const seen: unknown[] = [];
	const own = context();
	const App = () => (elem: never, _item: never, before: never, ctx: unknown) => {
		seen.push(use(ctx));
		return () => undefined;
	};
	const document = createDocument();
	const stop = mount(document.body, h(App as never, {}), undefined, own);
	assert.deepEqual(seen, [own]);
	stop();
});

test('mount puts the stylesheet in the head and takes it back out', () => {
	const document = createDocument();
	const stop = mount(document.body, h('p', { theme: 'slab' }, 'x'));
	assert.match(toHtml(document.head.childNodes), /<style data-aweft>@layer aweft \{\n/);
	assert.match(toHtml(document.head.childNodes), /\.aw0 \{ padding: 8px; \}/);
	stop();
	assert.equal(toHtml(document.head.childNodes), '');
});

test('two default mounts into one page get different classes and share one stylesheet', () => {
	const document = createDocument();
	const one = mount(document.body, h('p', { theme: 'slab' }, 'one'));
	const two = mount(document.body, h('p', { theme: 'badge' }, 'two'));

	assert.equal(toHtml(document.body.childNodes), '<p class="aw0">one</p><p class="aw1">two</p>');
	assert.equal(document.head.childNodes.length, 1, 'one <style>, not one per mount');
	const css = document.head.firstChild!.textContent ?? '';
	assert.match(css, /\.aw0 \{ padding: 8px; \}/);
	assert.match(css, /\.aw1 \{ color: red; \}/, 'both mounts\' rules are in the one sheet');

	// The sheet belongs to both, so the first to go takes nothing away from the second.
	one();
	assert.equal(document.head.childNodes.length, 1);
	two();
	assert.equal(toHtml(document.head.childNodes), '');
});

test('a mount given its own context is not adopted into the document\'s', () => {
	const document = createDocument();
	const own = context();
	const shared = mount(document.body, h('p', { theme: 'slab' }, 'one'));
	const apart = mount(document.body, h('p', { theme: 'slab' }, 'two'), undefined, own);

	// Naming a context is asking for a render of your own, so it keeps its own sheet.
	assert.equal(document.head.childNodes.length, 2);
	assert.match(own.theme.markup(), /\.aw0 \{ padding: 8px; \}/);
	shared();
	apart();
	assert.equal(toHtml(document.head.childNodes), '');
});

test('the stylesheet is not escaped, so a child selector survives', () => {
	Theme.define({ nest: { _children_span: { color: 'red' } } });
	const document = createDocument();
	const stop = mount(document.body, h('p', { theme: 'nest' }, 'x'));
	assert.match(toHtml(document.head.childNodes), /\.aw0 > span \{ color: red; \}/);
	assert.doesNotMatch(toHtml(document.head.childNodes), /&gt;/);
	stop();
});

test('mounting a themed element built outside the mount inserts it and nothing else', () => {
	const { document, ops } = recordingDocument();
	// Built before the mount, so its nodes came from the ambient document rather than this one:
	// what this document sees is the one insert.
	const stop = mount(document.body, h('p', { theme: 'slab' }, 'x'));

	// The style element is the render's, not the page's, so it is asserted on its own above.
	const page = ops.filter((line) => !line.includes('<style>'));
	assert.deepEqual(page, ['insert <p> into <body> before end']);
	stop();
});

test('a theme change on a cell is exactly one class write', () => {
	const tone = mutable('card');
	const { document, ops } = recordingDocument();
	const stop = mount(document.body, h('p', { theme: tone }, 'x'));
	ops.length = 0;

	tone.set('badge');
	assert.deepEqual(ops.filter((line) => !line.includes('<style>')), ['attr class="aw1" on <p>']);
	stop();
});

test('a page renders to markup, and the CSS comes off the render', async () => {
	const own = context();
	const markup = await render(h('main', { theme: 'slab' }, h('span', { theme: 'badge' }, 'hi')), { context: own });
	// A themed element is a component, so a static render brackets it and a hydration reads the
	// brackets to know where the dynamic mount sits (design 107).
	assert.equal(markup, '<!--[--><main class="aw0"><span class="aw1">hi</span></main><!--]-->');
	assert.match(own.theme.markup(), /\.aw0 \{ padding: 8px; \}/);
	assert.match(own.theme.markup(), /\.aw1 \{ color: red; \}/);
});

test('hydration of a rendered page makes no element and adopts every one', async () => {
	const item = (): unknown => h('main', { theme: 'slab' },
		h('span', { theme: 'badge' }, 'hi'),
		h('p', {}, mutable('live')),
	);

	const server = context();
	const markup = await render(h(item), { context: server });
	const css = server.theme.markup();

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	// The page the server wrote carries the sheet, so the client adopts it rather than making one.
	for (const node of parseHtml(`<style data-aweft>${css}</style>`, document)) document.head.appendChild(node);

	const elements: unknown[] = [];
	const walk = (node: { nodeType: number; firstChild: unknown; nextSibling: unknown } | null): void => {
		for (let n = node; n !== null; n = n.nextSibling as typeof n) {
			if (n.nodeType === 1) elements.push(n);
			walk(n.firstChild as never);
		}
	};
	walk(document.body.firstChild as never);
	assert.equal(elements.length, 3, 'the server wrote a main, a span and a p');

	const counted = counting(document);
	const stop = hydrate(document.body, item);

	// `dom` builds the client tree inside the hydration and pairs it with the server's
	// (designs 077 and 157), so the three elements are built and then claim the server's three.
	// What matters is that the server's nodes are the ones left standing, which the walk below
	// checks by identity.
	assert.equal(counted.made['createElement'], 3, 'the client built its own tree to pair with');
	// The 'hi' inside the span and the reactive child's text: both are built with the tree and
	// then claim the server's.
	assert.equal(counted.made['createTextNode'], 2);

	const after: unknown[] = [];
	const collect = (node: { nodeType: number; firstChild: unknown; nextSibling: unknown } | null): void => {
		for (let n = node; n !== null; n = n.nextSibling as typeof n) {
			if (n.nodeType === 1) after.push(n);
			collect(n.firstChild as never);
		}
	};
	collect(document.body.firstChild as never);
	assert.deepEqual(after, elements, 'every server element is the same object it was');

	assert.equal(toHtml(document.body.childNodes), markup);
	assert.equal(document.head.childNodes.length, 1, 'the server\'s stylesheet was adopted, not doubled');
	assert.equal(document.head.firstChild!.textContent, css, 'and it was not rewritten');
	stop();
});

test('two renders at once share no ids and no classes', async () => {
	const a = context();
	const b = context();
	const page = (): unknown => h('p', { theme: 'slab' }, 'x');
	const [one, two] = await Promise.all([render(page(), { context: a }), render(page(), { context: b })]);
	assert.equal(one, two);
	assert.equal(a.ids.next(), 'aw-0');
	assert.equal(b.ids.next(), 'aw-0');
	assert.notEqual(a.theme, b.theme);
});

test('a theme cell that moves twice writes once each time, and stops when the element goes', () => {
	const tone = mutable('card');
	const { document, ops } = recordingDocument();
	const stop = mount(document.body, h('p', { theme: tone }, 'x'));
	const page = (): string[] => ops.filter((line) => !line.includes('<style>'));

	ops.length = 0;
	tone.set('badge');
	assert.deepEqual(page(), ['attr class="aw1" on <p>']);

	// The tracker rebuilds its subscriptions on every pass. If it did not drop the old ones first,
	// this second move would arrive twice and write twice.
	ops.length = 0;
	tone.set('card');
	assert.deepEqual(page(), ['attr class="aw0" on <p>']);

	stop();
	ops.length = 0;
	tone.set('badge');
	assert.deepEqual(page(), [], 'nothing is written to an element that has been unmounted');
});

test('a render keeps the stages its page mounted, so a static walk can read them afterwards', async () => {
	// `render` mounts the page, serializes it and takes it down, so by the time a caller reads the
	// registry every stage has been removed from it. The list is held for the length of the call
	// (design 145), which is what a walk over the pages of a site needs.
	const acts = { '': () => h('main', {}, 'home'), 'posts/:id': () => h('main', {}, 'post') };
	const Site = (props: { router: Router }): unknown =>
		h(StageContext, { router: props.router, acts }, h(Stage, {}));

	const own = context();
	assert.equal(own.stage.items.length, 0, 'a fresh render has no stages in it');

	const markup = await render(h(Site, { router: createRouter({ url: '/' }) }), { context: own });
	assert.ok(markup.includes('home'));

	assert.equal(own.stage.items.length, 1, 'and one page leaves one entry behind');
	const entry = own.stage.items[0]!;
	assert.equal(entry.prefix, '');
	assert.equal(entry.parent, null);
	assert.deepEqual(entry.acts.map((act) => act.name), ['', 'posts/:id']);

	// A page that mounts is the other half of the rule: it keeps letting go, so a live page's
	// registry is what is on the page now.
	const document = createDocument();
	const live = context();
	const stop = mount(document.body, h(Site, { router: createRouter({ url: '/' }) }), undefined, live);
	assert.equal(live.stage.items.length, 1);
	stop();
	assert.equal(live.stage.items.length, 0, 'a mount that is taken down leaves nothing behind');
});
