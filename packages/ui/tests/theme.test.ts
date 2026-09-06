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
