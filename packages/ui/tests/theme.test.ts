// The theme engine as a page reaches it: `Theme.define`, the `Theme` provider, a `theme` prop and
// the CSS a render produces. What is behind them, the matcher and the compiler and the value
// language, is `internal.theme.test.ts`.
//
// Every expected value here is written from the design rather than taken from a run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import { Theme, context, h, mount, render } from '@aweftjs/ui';

test('an identical re-define is tolerated and a different one is refused', () => {
	Theme.define({ reDefined: { color: 'red' } });
	Theme.define({ reDefined: { color: 'red' } });
	assert.throws(() => Theme.define({ reDefined: { color: 'blue' } }), /already sets color to something else/);
	// Two modules adding different properties to one entry is the ordinary case and is allowed.
	Theme.define({ reDefined: { padding: 4 } });
});

test('two renders at once share nothing, including the style text', async () => {
	const one = context();
	const other = context();
	Theme.define({ leftOnly: { color: 'red' }, rightOnly: { color: 'blue' } });

	const a = await render(h('div', { theme: 'leftOnly' }), { context: one });
	const b = await render(h('div', { theme: 'rightOnly' }), { context: other });

	// A themed element is a component, so a static render brackets it (design 107).
	assert.equal(a, '<!--[--><div class="aw0"></div><!--]-->');
	assert.equal(b, '<!--[--><div class="aw0"></div><!--]-->');
	assert.match(one.theme.markup(), /color: red/);
	assert.doesNotMatch(one.theme.markup(), /color: blue/);
	assert.match(other.theme.markup(), /color: blue/);
	assert.doesNotMatch(other.theme.markup(), /color: red/);
});

test('a nested theme generates its own classes and leaves the outer one alone', () => {
	Theme.define({ nested: { color: 'red' } });
	const document = createDocument();
	const own = context();
	const stop = mount(
		document.body,
		[
			h('p', { theme: 'nested' }, 'outer'),
			h(Theme, { value: { nested: { color: 'green' } } }, h('p', { theme: 'nested' }, 'inner')),
		],
		undefined,
		own,
	);

	assert.equal(toHtml(document.body.childNodes), '<p class="aw0">outer</p><p class="aw1">inner</p>');
	assert.match(own.theme.markup(), /\.aw0 \{ color: red; \}/);
	assert.match(own.theme.markup(), /\.aw1 \{ color: green; \}/);
	stop();
});

test('a theme on a cell moves the class and keeps the node', () => {
	Theme.define({ tone_a: { color: 'red' }, tone_b: { color: 'blue' } });
	const tone = mutable('a');
	const document = createDocument();
	const stop = mount(document.body, h('p', { theme: ['tone', tone] }, 'x'));
	const node = document.body.firstChild;
	assert.equal(toHtml(document.body.childNodes), '<p class="aw0">x</p>');
	tone.set('b');
	assert.equal(toHtml(document.body.childNodes), '<p class="aw1">x</p>');
	assert.equal(document.body.firstChild, node, 'the element is written on, not replaced');
	stop();
});

test('a theme defines its own functions, and a nested theme shadows one', () => {
	Theme.define({
		'*': { $double: (args: string[]) => String(Number(args[0]) * 2) },
		widened: { padding: '$double(4)px' },
	});
	const document = createDocument();
	const own = context();
	const stop = mount(
		document.body,
		[
			h('p', { theme: 'widened' }, 'outer'),
			h(
				Theme,
				{ value: { '*': { $double: (args: string[]) => String(Number(args[0]) * 10) } } },
				h('p', { theme: 'widened' }, 'inner'),
			),
		],
		undefined,
		own,
	);

	assert.match(own.theme.markup(), /\.aw0 \{[^}]*padding: 8px;/, 'the application\'s own function ran');
	assert.match(own.theme.markup(), /\.aw1 \{[^}]*padding: 40px;/, 'the nested theme\'s function shadowed it');
	stop();
});

test('a Theme written inline is one theme, however many times it mounts', () => {
	Theme.define({ inline: { color: 'red' } });
	const own = context();
	const document = createDocument();
	const page = (): unknown =>
		// The README's own shape: a fresh value object on every mount.
		h(Theme, { value: { inline: { color: 'red' } } }, h('div', { theme: 'inline' }, 'x'));

	const stop = mount(document.body, page(), undefined, own);
	const one = own.theme.markup();
	stop();

	for (let i = 0; i < 2000; i += 1) {
		const cycle = mount(document.body, page(), undefined, own);
		cycle();
	}
	assert.equal(own.theme.markup(), one, '2000 cycles left the sheet the size of one');
	assert.deepEqual(own.theme.markup().match(/\.aw\d+/g), one.match(/\.aw\d+/g));
});

test('a module holding a theme function loads twice without a refusal', async () => {
	// A function is theme data, so `same()` cannot compare the two copies by identity: the second
	// load's function is a different object saying the same thing.
	// The second specifier is built rather than written, so this is one module loaded twice at run
	// time rather than two modules the compiler resolves.
	const again: string = './fixtures/app-theme.ts?again';
	await import('./fixtures/app-theme.ts');
	await import(again);

	const own = context();
	const document = createDocument();
	const stop = mount(document.body, h('div', { theme: 'boxed' }, 'x'), undefined, own);
	assert.match(own.theme.markup(), /padding: 16px;/, 'and the function still runs');
	stop();
});

test('a theme key with an empty segment is refused, and the message says what to write', () => {
	// `a__b` splits to three segments, one of them empty, and an element's `theme` list drops
	// empty segments, so nothing on any page can ever match it.
	assert.throws(() => Theme.define({ a__b: { color: 'red' } }), /the theme key a__b has an empty segment.*write a_b/);
	assert.throws(() => Theme.define({ trail_: { color: 'red' } }), /write trail/);
	// A single underscore is the ordinary case and stays fine.
	Theme.define({ good_key: { color: 'red' } });
});

test('a cell in a Theme value keeps the theme live, and a plain object still works', async () => {
	// `contexts.ts` says a cell keeps a provider's value live: the transform runs again on every
	// write. The theme transform has to read the cell rather than merge it, or a light and dark
	// switch merges the cell object's own properties as theme entries and the page stays as it was.
	Theme.define({ swatch: { color: '$foreground' } });
	const pale = { swatch: { color: 'rgb(1, 1, 1)' } };
	const deep = { swatch: { color: 'rgb(9, 9, 9)' } };

	const mode = mutable(pale);
	const App = (): unknown => h(Theme, { value: mode }, h('p', { id: 'box', theme: 'swatch' }, 'x'));

	const first = context();
	await render(h(App, {}), { context: first });
	assert.ok(first.theme.markup().includes('rgb(1, 1, 1)'), 'the cell\'s value is the theme');
	assert.ok(!first.theme.markup().includes('rgb(9, 9, 9)'));

	mode.set(deep);
	const second = context();
	await render(h(App, {}), { context: second });
	assert.ok(second.theme.markup().includes('rgb(9, 9, 9)'), 'and it follows the cell when it moves');
	assert.ok(!second.theme.markup().includes('rgb(1, 1, 1)'));

	// A plain object is the ordinary case and is unchanged by any of that.
	const plain = context();
	await render(h(Theme, { value: deep }, h('p', { theme: 'swatch' }, 'x')), { context: plain });
	assert.ok(plain.theme.markup().includes('rgb(9, 9, 9)'));
});

test('a theme cell that moves under a live page moves the class the page carries', () => {
	Theme.define({ chip: { color: '$foreground' } });
	const mode = mutable({ chip: { color: 'rgb(2, 2, 2)' } });
	const document = createDocument();
	const own = context();
	const stop = mount(document.body, h(Theme, { value: mode }, h('p', { id: 'chip', theme: 'chip' }, 'x')), undefined, own);

	const before = /id="chip" class="([^"]+)"/.exec(toHtml(document.body))?.[1];
	assert.ok(before !== undefined, 'the page carries a generated class');

	mode.set({ chip: { color: 'rgb(3, 3, 3)' } });
	const after = /id="chip" class="([^"]+)"/.exec(toHtml(document.body))?.[1];
	assert.notEqual(after, before, 'and a write to the cell moves it to the class for the new theme');
	assert.ok(own.theme.markup().includes('rgb(3, 3, 3)'));
	stop();
});

test('a Theme cell is still followed with a provider nested below it', () => {
	// A provider resolves against the value above it and caches the answer, so a cell that moves
	// has to make every provider under it stale too. Without the cascade the inner node answers
	// what it cached and the page stays on the theme it started with, however many providers deep.
	Theme.define({ stack: { color: '$foreground' } });
	const outer = mutable({ stack: { color: 'rgb(4, 4, 4)' } });

	for (const [what, inner] of [
		['a plain object below', { stack: { fontWeight: 'bold' } }],
		['nothing below', undefined],
	] as const) {
		const document = createDocument();
		const own = context();
		const leaf = h('p', { id: 'leaf', theme: 'stack' }, 'x');
		const tree = inner === undefined
			? h(Theme, { value: outer }, leaf)
			: h(Theme, { value: outer }, h(Theme, { value: inner }, leaf));
		outer.set({ stack: { color: 'rgb(4, 4, 4)' } });
		const stop = mount(document.body, tree, undefined, own);

		const before = /id="leaf" class="([^"]+)"/.exec(toHtml(document.body))?.[1];
		outer.set({ stack: { color: 'rgb(5, 5, 5)' } });
		const after = /id="leaf" class="([^"]+)"/.exec(toHtml(document.body))?.[1];

		assert.notEqual(after, before, `the outer cell moved the class with ${what}`);
		assert.ok(own.theme.markup().includes('rgb(5, 5, 5)'), `and the new colour is in the sheet with ${what}`);
		stop();
	}
});

test('two Theme cells, one inside the other, each move the page on their own', () => {
	Theme.define({ pair: { color: '$foreground' } });
	const outer = mutable<Record<string, unknown> | null>({ pair: { color: 'rgb(6, 6, 6)' } });
	const inner = mutable<Record<string, unknown> | null>({ pair: { letterSpacing: '1px' } });

	const document = createDocument();
	const own = context();
	const stop = mount(document.body,
		h(Theme, { value: outer }, h(Theme, { value: inner }, h('p', { id: 'leaf', theme: 'pair' }, 'x'))),
		undefined, own);

	const classNow = (): string => /id="leaf" class="([^"]+)"/.exec(toHtml(document.body))?.[1] ?? '';
	const first = classNow();

	outer.set({ pair: { color: 'rgb(7, 7, 7)' } });
	const afterOuter = classNow();
	assert.notEqual(afterOuter, first, 'the outer cell moved it');

	inner.set({ pair: { letterSpacing: '2px' } });
	const afterInner = classNow();
	assert.notEqual(afterInner, afterOuter, 'and so did the inner one');
	assert.ok(own.theme.markup().includes('letter-spacing: 2px'));

	// A cell that moves to null hands the subtree back to the theme above it.
	inner.set(null);
	assert.notEqual(classNow(), afterInner, 'and a cell moving to null moved it again');
	assert.ok(own.theme.markup().includes('rgb(7, 7, 7)'));
	stop();
});
