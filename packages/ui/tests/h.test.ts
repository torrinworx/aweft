// What `ui`'s `h` claims off an element, and what it leaves to `dom` (design 107).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable, mutableArray } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';
import { Theme, context, h, html, hydrate, mount, render, svg } from '@aweftjs/ui';

Theme.define({
	box: { padding: 8 },
	tone_warm: { color: 'red' },
	sized: { $step: '4' },
});

/** Deliver one event the way the host would: the handler property included (design 133). */
const fire = (node: unknown, type: string, event: Record<string, unknown> = {}): void => {
	(node as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: node, ...event });
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

test('an onXxx prop is a handler property, and it goes out of the page with its element', () => {
	const seen: string[] = [];
	const document = createDocument();
	const stop = mount(document.body, h('button', { onClick: () => seen.push('click') }, 'go'));
	const button = document.body.firstChild as LightElement;

	fire(button, 'click');
	assert.deepEqual(seen, ['click']);
	stop();
	assert.equal(button.parentNode, null, 'the element is out of the page, and the handler is on it');
	assert.equal(document.body.firstChild, null);
});

test('a caller\'s own $on handler runs beside this package\'s, and runs first', () => {
	const seen: string[] = [];
	const document = createDocument();
	const stop = mount(document.body, h('button', {
		theme: ['button'],
		$onclick: () => seen.push('own'),
		onClick: () => seen.push('claimed'),
	}, 'go'));

	fire(document.body.firstChild, 'click');
	assert.deepEqual(seen, ['own', 'claimed'],
		'the caller\'s handler is the one that may want to stop the event first');
	stop();
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

	// The element's own focus, because that is the event the platform keeps a property for.
	fire(button, 'focus');
	assert.equal(isFocused.get(), true);
	fire(button, 'blur');
	assert.equal(isFocused.get(), false);

	fire(button, 'mousedown');
	assert.equal(isClicked.get(), true);
	// Leaving the element while the button is down clears it, because the mouseup lands elsewhere.
	fire(button, 'mouseleave');
	assert.equal(isClicked.get(), false);
	stop();
});

test('isTouched follows a finger and not a mouse', () => {
	const isTouched = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h('button', { isTouched }, 'go'));
	const button = document.body.firstChild as LightElement;

	fire(button, 'pointerdown', { pointerType: 'mouse' });
	assert.equal(isTouched.get(), false, 'a mouse is not a touch');
	fire(button, 'pointerdown', { pointerType: 'touch' });
	assert.equal(isTouched.get(), true);
	fire(button, 'pointerup', { pointerType: 'touch' });
	assert.equal(isTouched.get(), false);
	stop();
});

test('a state prop that is not a writable cell asserts, and names what to pass', () => {
	// The claim is split where `h` runs, so this is where it fires.
	const document = createDocument();
	assert.throws(
		() => mount(document.body, h('button', { isHovered: true }, 'press')),
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

test('a themed element with a handler and a state cell still works after a hydration', async () => {
	const clicks: string[] = [];
	const isHovered = mutable(false);
	const tone = mutable<unknown>(null);
	const item = (): unknown => h('div', {},
		h('button', {
			theme: ['box', tone, isHovered.bool('tone_warm', null)],
			onClick: () => clicks.push('click'),
			isHovered,
		}, 'go'));

	const rendered = context();
	const markup = await render(h(item), { context: rendered });
	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);

	const buttons = (node: unknown): LightElement[] => {
		const found: LightElement[] = [];
		for (let n = node as { nextSibling: unknown; firstChild: unknown; localName?: string } | null;
			n !== null; n = n.nextSibling as typeof n) {
			if (n.localName === 'button') found.push(n as unknown as LightElement);
			found.push(...buttons(n.firstChild));
		}
		return found;
	};
	const server = buttons(document.body.firstChild)[0]!;

	const stop = hydrate(document.body, item);
	const button = buttons(document.body.firstChild)[0]!;
	assert.equal(button, server, 'the server\'s button, adopted');

	// The page came from a server, so nothing here was ever attached by this browser. What makes
	// it live is that the handler is a property, which the hydration replayed (design 133).
	fire(button, 'click');
	assert.deepEqual(clicks, ['click'], 'a hydrated page is not an inert page');
	const plain = button.getAttribute('class');
	fire(button, 'mouseenter');
	assert.equal(isHovered.get(), true, 'and the state cell follows the element it adopted');
	assert.notEqual(button.getAttribute('class'), plain,
		'and the segment that cell drives reaches the element the page kept');
	fire(button, 'mouseleave');
	assert.equal(isHovered.get(), false);
	assert.equal(button.getAttribute('class'), plain);

	tone.set('tone_warm');
	assert.notEqual(button.getAttribute('class'), plain, 'a theme cell moves the class too');
	stop();
});
