// What `ui`'s `h` claims off an element, and what it leaves to `dom` (design 107).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable, mutableArray } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';
import { Theme, context, h, html, mount, svg } from '@aweftjs/ui';

Theme.define({
	box: { padding: 8 },
	tone_warm: { color: 'red' },
	sized: { $step: '4' },
});

const fire = (node: unknown, type: string, event: Record<string, unknown> = {}): void => {
	const listeners = (node as { listeners: Map<string, Set<(e: unknown) => void>> }).listeners;
	for (const listener of listeners.get(type) ?? []) listener({ type, target: node, ...event });
};

test('an element with nothing ui claims is dom\'s h, node and all', () => {
	const node = h('div', { class: 'plain', id: 'one' });
	assert.equal((node as LightElement).localName, 'div');
	assert.equal((node as LightElement).getAttribute('class'), 'plain');
});

test('a themed element is a mounter, and its class joins the one written beside it', () => {
	const made = h('div', { theme: 'box', class: 'mine' });
	assert.equal(typeof made, 'function', 'a claimed prop means the element mounts rather than being one');

	const document = createDocument();
	const stop = mount(document.body, made);
	// A mount puts no markers in the page; only a static render does, so a hydration can read them.
	assert.equal(toHtml(document.body.childNodes), '<div class="mine aw0"></div>');
	stop();
});

test('a theme list flattens through arrays and cells, and a nested array too', () => {
	const warm = mutable('warm');
	const document = createDocument();
	const own = context();
	const stop = mount(document.body, h('div', { theme: ['box', ['tone', warm]] }), undefined, own);
	assert.match(own.theme.markup(), /\.aw0 \{ padding: 8px; \}/);
	assert.match(own.theme.markup(), /\.aw0 \{ color: red; \}/);
	stop();
});

test('style takes an object, gives a size property px, and resolves a $var from the chain', () => {
	const document = createDocument();
	const stop = mount(document.body, h('div', { theme: 'sized', style: { padding: '$step$px', flexGrow: 1, width: 20 } }));
	assert.equal(
		toHtml(document.body.childNodes),
		'<div class="aw0" style="padding: 4px; flex-grow: 1; width: 20px;"></div>',
	);
	stop();
});

test('a style value that is a cell follows it, in one attribute write', () => {
	const width = mutable(10);
	const document = createDocument();
	const stop = mount(document.body, h('div', { theme: 'box', style: { width } }));
	assert.match(toHtml(document.body.childNodes), /style="width: 10px;"/);
	width.set(30);
	assert.match(toHtml(document.body.childNodes), /style="width: 30px;"/);
	stop();
});

test('a style with no theme still resolves, with nothing to look a $var up in', () => {
	const document = createDocument();
	const stop = mount(document.body, h('div', { style: { content: '$$5', width: 4 } }));
	assert.match(toHtml(document.body.childNodes), /style="content: \$5; width: 4px;"/);
	stop();
});

test('an onXxx prop is a listener, and it comes off when the element unmounts', () => {
	const seen: string[] = [];
	const document = createDocument();
	const stop = mount(document.body, h('button', { onClick: () => seen.push('click') }, 'go'));
	const button = document.body.firstChild as LightElement;

	fire(button, 'click');
	assert.deepEqual(seen, ['click']);
	stop();
	fire(button, 'click');
	assert.deepEqual(seen, ['click'], 'the listener came off with the element');
});

test('the four state cells follow real events, in both directions', () => {
	const isHovered = mutable(false);
	const isFocused = mutable(false);
	const isClicked = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h('button', { isHovered, isFocused, isClicked }, 'go'));
	const button = document.body.firstChild as LightElement;

	fire(button, 'mouseenter');
	assert.equal(isHovered.get(), true);
	fire(button, 'mouseleave');
	assert.equal(isHovered.get(), false);

	fire(button, 'focusin');
	assert.equal(isFocused.get(), true);
	fire(button, 'focusout');
	assert.equal(isFocused.get(), false);

	fire(button, 'mousedown');
	assert.equal(isClicked.get(), true);
	// Leaving the element while the button is down clears it, because the mouseup lands elsewhere.
	fire(button, 'mouseleave');
	assert.equal(isClicked.get(), false);
	stop();
});

test('a state prop that is not a writable cell asserts, and names what to pass', () => {
	// The claim is split where `h` runs and applied where the mount is, so this is where it fires.
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h('button', { isHovered: true })),
		/must be a cell this component can write/,
	);
});

test('each:name hands the item to the component under that name', () => {
	const rows = mutableArray(['a', 'b']);
	const Row = (props: { row?: unknown }) => h('li', {}, props.row as string);
	const document = createDocument();
	const stop = mount(document.body, h('ul', {}, h(Row as never, { 'each:row': rows })));
	assert.match(toHtml(document.body.childNodes), /<li>a<\/li>/);
	assert.match(toHtml(document.body.childNodes), /<li>b<\/li>/);
	stop();
});

test('svg makes its node in the SVG namespace and has no theme', () => {
	const circle = svg('circle', { cx: 1, class: 'ring' }) as LightElement;
	assert.equal(circle.namespaceURI, 'http://www.w3.org/2000/svg');
	assert.equal(circle.getAttribute('class'), 'ring');
});

test('markup in a template literal is themed the same way JSX is', () => {
	const document = createDocument();
	const stop = mount(document.body, html`<div theme="box">hi</div>`);
	assert.equal(toHtml(document.body.childNodes), '<div class="aw0">hi</div>');
	stop();
});

test('nested themed elements mount under one bracket, not one each', async () => {
	const { render } = await import('@aweftjs/ui');
	const markup = await render(h('main', { theme: 'box' }, h('span', { theme: 'box' }, 'x')), { context: context() });
	assert.equal(markup, '<!--[--><main class="aw0"><span class="aw0">x</span></main><!--]-->');
});

test('a null tag is refused, and the message says what to pass', () => {
	assert.throws(() => h(null), /pass an element name, a node, a component or a mark/);
});
