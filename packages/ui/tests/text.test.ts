// A text token is looked up where it mounts (design 278): the catalog on the render, the message
// syntax, and the four places the resolve runs.
//
// Everything here runs in the light tree. What only a bundle can show, which is a page compiled
// with the build's `text` option, is `recipes/translated-site`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, mount as domMount, parseHtml, render as domRender, toHtml } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';
import {
	Head, TextModifiers, Title, Typography, context, h, hydrate, isText, localeOf, mount, render,
	template, text, textOf, usedText,
} from '@aweftjs/ui';
import type { Catalog } from '@aweftjs/ui';

const fr: Catalog = {
	'Save': 'Enregistrer',
	'Hello {name}': 'Bonjour {name}',
	'Close|dialog': 'Fermer',
	'Search': 'Rechercher',
	'Read <link>the docs</link>': 'Lisez <link>la documentation</link>',
	'{n, plural, one {# item} other {# items}}': '{n, plural, one {# élément} other {# éléments}}',
};

const uk: Catalog = {
	'{n, plural, one {# item} other {# items}}': '{n, plural, one {# елемент} few {# елементи} many {# елементів} other {# елемента}}',
};

/** The first element with this tag under a node, in the light tree. */
const find = (node: LightElement, tag: string): LightElement => {
	for (let n = node.firstChild; n !== null; n = n.nextSibling) {
		if (n.nodeType !== 1) continue;
		const element = n as unknown as LightElement;
		if (element.localName === tag) return element;
		const below = findOrNull(element, tag);
		if (below !== null) return below;
	}
	assert.fail(`no <${tag}> was rendered`);
};
const findOrNull = (node: LightElement, tag: string): LightElement | null => {
	for (let n = node.firstChild; n !== null; n = n.nextSibling) {
		if (n.nodeType !== 1) continue;
		const element = n as unknown as LightElement;
		if (element.localName === tag) return element;
		const below = findOrNull(element, tag);
		if (below !== null) return below;
	}
	return null;
};

/** The markup of an item rendered with a language, brackets and all. */
const markup = async (item: unknown, locale?: string, catalog?: Catalog): Promise<string> =>
	render(item, { context: context(locale === undefined ? {} : { locale, ...(catalog === undefined ? {} : { catalog }) }) });

/** The markup with the brackets a component mounts under taken out, for reading. */
const shown = async (item: unknown, locale?: string, catalog?: Catalog): Promise<string> =>
	(await markup(item, locale, catalog)).replace(/<!--\[-->|<!--\]-->/g, '');

// --- the resolve ---------------------------------------------------------------------------------

test('a token shows the catalog entry for its key, and its source with none', async () => {
	assert.equal(await shown(h('p', {}, text('Save')), 'fr', fr), '<p>Enregistrer</p>');
	assert.equal(await shown(h('p', {}, text('Save')), 'de', {}), '<p>Save</p>');
	assert.equal(await shown(h('p', {}, text('Save'))), '<p>Save</p>');
});

test('a context word is part of the key', async () => {
	assert.equal(await shown(h('p', {}, text('Close', { context: 'dialog' })), 'fr', fr), '<p>Fermer</p>');
	assert.equal(await shown(h('p', {}, text('Close')), 'fr', fr), '<p>Close</p>', 'the bare word is a key of its own');
});

test('a token child is bracketed, so a hydration pairs it beside a static sibling', async () => {
	const App = (): unknown => h('p', {}, text('Hello {name}', { name: 'Ada' }), ' ', h('b', {}, text('Save')), '!');
	const html = await markup(h(App), 'fr', fr);
	assert.equal(html, '<!--[--><p><!--[-->Bonjour Ada<!--]--> <b><!--[-->Enregistrer<!--]--></b>!</p><!--]-->');

	const document = createDocument();
	for (const node of parseHtml(html, document)) document.body.appendChild(node);
	const first = document.body.firstChild;
	const page = hydrate(document.body, h(App), context({ locale: 'fr', catalog: fr }));
	await page.ready;
	assert.equal(document.body.firstChild, first, 'the server\'s nodes were kept');
	assert.equal(toHtml(document.body), `<body>${html}</body>`);
	page();
});

test('the keys a render looked up are recorded, whether or not the catalog had them', async () => {
	const ui = context({ locale: 'fr', catalog: fr });
	await render(h('div', {}, text('Save'), text('Nope'), text('Save')), { context: ui });
	assert.deepEqual(usedText(ui), ['Save', 'Nope']);
});

// --- the syntax ----------------------------------------------------------------------------------

test('a hole takes a value, and a cell among the values is followed', async () => {
	const name = mutable('Ada');
	const document = createDocument();
	const stop = mount(document.body, h('p', {}, text('Hello {name}', { name })), undefined, context({ locale: 'fr', catalog: fr }));
	const p = document.body.firstChild as LightElement;
	assert.equal(p.textContent, 'Bonjour Ada');
	name.set('Grace');
	assert.equal(p.textContent, 'Bonjour Grace');
	stop();
});

test('a plural picks the branch the locale\'s rules give, an exact match first, and # is the number', async () => {
	const items = (n: number): unknown => h('p', {}, text('{n, plural, one {# item} other {# items}}', { n }));
	assert.equal(await shown(items(1), 'en'), '<p>1 item</p>');
	assert.equal(await shown(items(2), 'en'), '<p>2 items</p>');
	assert.equal(await shown(items(1), 'uk', uk), '<p>1 елемент</p>');
	assert.equal(await shown(items(3), 'uk', uk), '<p>3 елементи</p>');
	assert.equal(await shown(items(5), 'uk', uk), '<p>5 елементів</p>');
	assert.equal(await shown(items(1234), 'fr', fr), '<p>1 234 éléments</p>', '# is formatted for the locale');

	const exact = h('p', {}, text('{n, plural, =0 {none} one {one} other {some}}', { n: 0 }));
	assert.equal(await shown(exact, 'en'), '<p>none</p>');
});

test('a plural over a cell moves with the cell', () => {
	const n = mutable(1);
	const document = createDocument();
	const stop = mount(document.body, h('p', {}, text('{n, plural, one {# item} other {# items}}', { n })), undefined, context({ locale: 'uk', catalog: uk }));
	const p = document.body.firstChild as LightElement;
	assert.equal(p.textContent, '1 елемент');
	n.set(3);
	assert.equal(p.textContent, '3 елементи');
	n.set(5);
	assert.equal(p.textContent, '5 елементів');
	stop();
});

test('a hash is a character outside a plural, and the count inside one', async () => {
	assert.equal(await shown(h('p', {}, text('Issue #12')), 'en'), '<p>Issue #12</p>');
	assert.equal(await shown(h('p', {}, text('{n, plural, one {#} other {#}} of {total}', { n: 2, total: 9 })), 'en'), '<p>2 of 9</p>',
		'the count is the plural\'s number and a hole after the plural is its own value');
});

test('a select picks the named branch and other when none matches', async () => {
	const kind = (value: string): unknown => h('p', {}, text('{kind, select, book {a book} other {a thing}}', { kind: value }));
	assert.equal(await shown(kind('book'), 'en'), '<p>a book</p>');
	assert.equal(await shown(kind('lamp'), 'en'), '<p>a thing</p>');
});

test('a tag wraps part of the sentence in what its function answers', async () => {
	const item = h('p', {}, text('Read <link>the docs</link>', { link: (inner: unknown) => h('a', { href: '/docs' }, inner) }));
	assert.equal(await shown(item, 'fr', fr), '<p>Lisez <a href="/docs">la documentation</a></p>');
	const untagged = h('p', {}, text('Read <link>the docs</link>'));
	assert.equal(await shown(untagged, 'en'), '<p>Read the docs</p>', 'no function under the name leaves the inner content');
});

test('branches nest: a tag inside a plural keeps the count', async () => {
	const item = h('p', {}, text('{n, plural, one {<b>#</b> item} other {<b>#</b> items}}', { n: 2, b: (inner: unknown) => h('strong', {}, inner) }));
	assert.equal(await shown(item, 'en'), '<p><strong>2</strong> items</p>');
});

test('an apostrophe quotes a brace, a tag, a hash or itself, and is itself anywhere else', async () => {
	assert.equal(await shown(h('p', {}, text("it''s '{'a'}' '<'b> '#'")), 'en'), "<p>it's {a} &lt;b&gt; #</p>");
	assert.equal(await shown(h('p', {}, text("'{a} and {b}' stay")), 'en'), '<p>{a} and {b} stay</p>', 'a quoted run reaches the next apostrophe');
	assert.equal(await shown(h('p', {}, text("'{unclosed")), 'en'), '<p>{unclosed</p>', 'a run nothing closes is text to the end');
	assert.equal(await shown(h('p', {}, text("don't")), 'en'), '<p>don\'t</p>');
	assert.equal(await shown(h('p', {}, text('a < b')), 'en'), '<p>a &lt; b</p>', 'a lone < is a character');
});

test('a message that cannot be read is refused with the offset and the fix', () => {
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h('p', {}, text('{n, plural, one {x}}', { n: 1 })), undefined, context()),
		(error: Error) => /offset 19 of "\{n, plural, one \{x\}\}": expected an other branch/.test(error.message) && /braces in pairs/.test(error.message),
	);
	assert.throws(
		() => mount(document.body, h('p', {}, text('Hello {name')), undefined, context()),
		(error: Error) => /offset 11 .*expected a closing brace/.test(error.message),
	);
	assert.throws(
		() => mount(document.body, h('p', {}, text('<b>x</i>', { b: (v: unknown) => v })), undefined, context()),
		(error: Error) => /expected <\/b>/.test(error.message),
	);
});

// --- the four places the resolve runs -------------------------------------------------------------

test('a token in a prop is written on the element as the string', async () => {
	const item = h('input', { id: 'q', placeholder: text('Search'), 'aria-label': text('Search') });
	assert.equal(await shown(item, 'fr', fr), '<input id="q" placeholder="Rechercher" aria-label="Rechercher">');
});

test('a token in a prop follows a cell among its values', () => {
	const n = mutable(1);
	const document = createDocument();
	const stop = mount(document.body, h('input', { id: 'q', title: text('{n, plural, one {# item} other {# items}}', { n }) }), undefined, context({ locale: 'en' }));
	const input = find(document.body as unknown as LightElement, 'input');
	assert.equal(input.getAttribute('title'), '1 item');
	n.set(4);
	assert.equal(input.getAttribute('title'), '4 items');
	stop();
});

test('a token in a prop of a hoisted template instance is written the same way', async () => {
	const row = template(['li', null, ['input', { id: 'q' }]], [['props', [0]]]);
	const item = row([{ placeholder: text('Search') }]);
	assert.equal(await shown(item, 'fr', fr), '<li><input id="q" placeholder="Rechercher"></li>');
});

test('Typography resolves a token label before its modifiers, so a modifier matches the translated word', async () => {
	const item = h(TextModifiers, { value: [{ check: 'Enregistrer', return: (word: string) => h('b', {}, word) }] },
		h(Typography, { label: text('Save') }));
	assert.match(await shown(item, 'fr', fr), /<span class="[^"]+"><b>Enregistrer<\/b><\/span>/);
});

test('Typography follows a cell among a token label\'s values', () => {
	const n = mutable(1);
	const document = createDocument();
	const stop = mount(document.body, h(Typography, { label: text('{n, plural, one {# item} other {# items}}', { n }) }), undefined, context({ locale: 'en' }));
	const span = find(document.body as unknown as LightElement, 'span');
	assert.equal(span.textContent, '1 item');
	n.set(2);
	assert.equal(span.textContent, '2 items');
	stop();
});

test('a head component writes a token as its text and in its attributes', async () => {
	const ui = context({ locale: 'fr', catalog: fr });
	await render(h(Head, {}, h(Title, {}, text('Save'))), { context: ui });
	assert.equal(ui.head.title(), 'Enregistrer');
	assert.match(ui.head.markup(), /<title[^>]*>Enregistrer<\/title>/);
});

test('a token mounted under dom\'s own mount, with no ui systems, shows its source', async () => {
	const html = await domRender(h('p', {}, text('Hello {name}', { name: 'Ada' })));
	assert.equal(html.replace(/<!--\[-->|<!--\]-->/g, ''), '<p>Hello Ada</p>');
	const document = createDocument();
	const stop = domMount(document.body, h('p', {}, text('Save')));
	assert.equal((document.body.firstChild as LightElement).textContent, 'Save');
	stop();
});

// --- the helpers -----------------------------------------------------------------------------------

test('textOf answers the string for a token, a string, a number and nothing', () => {
	let seen: string[] = [];
	const Probe = (): unknown => (elem: unknown, _i: unknown, before: unknown, ctx: unknown) => {
		seen = [textOf(ctx, text('Save')), textOf(ctx, 'plain'), textOf(ctx, 3), textOf(ctx, null), textOf(ctx, text('Hello {name}', { name: mutable('Ada') }))];
		return domMount(elem as never, null, before as never, ctx);
	};
	const document = createDocument();
	mount(document.body, h(Probe), undefined, context({ locale: 'fr', catalog: fr }))();
	assert.deepEqual(seen, ['Enregistrer', 'plain', '3', '', 'Bonjour Ada']);
});

test('isText tells a token from a component call and a string', () => {
	assert.ok(isText(text('Save')));
	assert.ok(!isText(h(() => null)));
	assert.ok(!isText('Save'));
});

test('localeOf answers the render\'s tag, and undefined for a page that named none', () => {
	let seen: (string | undefined)[] = [];
	const Probe = (): unknown => (elem: unknown, _i: unknown, before: unknown, ctx: unknown) => {
		seen.push(localeOf(ctx));
		return domMount(elem as never, null, before as never, ctx);
	};
	const document = createDocument();
	mount(document.body, h(Probe), undefined, context({ locale: 'uk' }))();
	mount(document.body, h(Probe), undefined, context())();
	assert.deepEqual(seen, ['uk', undefined]);
});

test('text refuses a source that is not a string', () => {
	assert.throws(() => text(3 as unknown as string), /text takes the message as a string/);
});

// --- the list build wraps, against the props this package's components take -----------------------

test('every text prop a component takes is on build\'s list, and the ones that are not are named', async () => {
	const { TEXT_PROPS } = await import('@aweftjs/build');
	// The names this package's components show as text, read off their props interfaces by hand.
	const shown = ['label', 'description', 'placeholder', 'title', 'alt', 'error', 'caption'];
	for (const name of shown) assert.ok(TEXT_PROPS.has(name), `${name} is a text prop and is on the list`);
	// A text prop under another name is written as a text() call by hand, and this is the list of
	// them; a new one belongs here or on build's list.
	const byHand = ['search', 'none', 'heading'];
	for (const name of byHand) assert.ok(!TEXT_PROPS.has(name), `${name} is not on the list`);
	// A name the list must never grow, because it is a word for the machine.
	for (const name of ['name', 'type', 'class', 'href', 'id', 'value', 'theme']) assert.ok(!TEXT_PROPS.has(name), name);
});

// --- the edges: prototype names, a bad tag, a bad entry, no mount ------------------------------

test('a key or a branch named like an Object.prototype member reads nothing off the prototype', async () => {
	assert.equal(await shown(h('p', {}, text('constructor')), 'fr', { a: 'b' }), '<p>constructor</p>');
	assert.equal(await shown(h('p', {}, text('toString')), 'fr', {}), '<p>toString</p>');
	assert.equal(await shown(h('p', {}, text('{k, select, x {x} other {o}}', { k: 'constructor' })), 'en'), '<p>o</p>');
	assert.equal(await shown(h('p', {}, text('{constructor} x', { other: 1 })), 'en'), '<p> x</p>', 'a hole with no own value is empty');
	const ui = context({ locale: 'fr', catalog: {} });
	await render(h('p', {}, text('constructor')), { context: ui });
	assert.deepEqual(usedText(ui), ['constructor'], 'and it is recorded as looked up');
});

test('an empty locale is no locale, and a tag Intl cannot read falls back to the host\'s rules', async () => {
	assert.equal(context({ locale: '' }).locale, undefined);
	const items = h('p', {}, text('{n, plural, one {# item} other {# items}}', { n: 1 }));
	assert.equal(await shown(items, ''), '<p>1 item</p>');
	assert.equal(await shown(items, 'xx-nonsense!!'), '<p>1 item</p>');
});

test('a catalog entry that is not a string, and a plural over what is not a number, are refused by name', () => {
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h('p', {}, text('Save')), undefined, context({ locale: 'fr', catalog: { Save: 5 as unknown as string } })),
		/the catalog entry for "Save" is 5 and a translation is a string/,
	);
	assert.throws(
		() => mount(document.body, h('p', {}, text('{n, plural, one {a} other {b}}', { n: 'abc' })), undefined, context()),
		/a plural takes a number and "n" holds "abc"/,
	);
	assert.throws(
		() => mount(document.body, h('p', {}, text('{link}', { link: () => 'x' })), undefined, context()),
		/a hole takes a value and was given a function/,
	);
});

test('textOf and localeOf take the render context() made, for code with no mount', () => {
	const ui = context({ locale: 'fr', catalog: { Save: 'Enregistrer' } });
	assert.equal(textOf(ui, text('Save')), 'Enregistrer');
	assert.equal(localeOf(ui), 'fr');
	assert.deepEqual(usedText(ui), ['Save']);
});
