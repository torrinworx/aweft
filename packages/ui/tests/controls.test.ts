// Every control this package ships, in the light tree: what it renders, what a screen reader
// would call it, and that the cell and the element follow each other in both directions.
//
// What only a browser can answer, which is every real key press, is `browser.test.ts`. What the
// gallery page answers is `recipes/ui/main.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import { recordingDocument } from '@aweftjs/testing';
import {
	Button, Checkbox, LoadingDots, Paper, Radio, Select, Slider, TextArea, TextField, Toggle,
	context, h, hydrate, mount, render,
} from '@aweftjs/ui';

// --- reading the tree the way a screen reader would -------------------------------------------

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

/** The implicit role of a native element, which is the whole point of using one. */
const roleOf = (element: LightElement): string => {
	const explicit = element.getAttribute('role');
	if (explicit !== null) return explicit;
	const tag = element.localName;
	if (tag === 'button') return 'button';
	if (tag === 'a') return element.hasAttribute('href') ? 'link' : 'generic';
	if (tag === 'select') return 'combobox';
	if (tag === 'textarea') return 'textbox';
	if (tag !== 'input') return tag;
	const type = element.getAttribute('type') ?? 'text';
	if (type === 'checkbox') return 'checkbox';
	if (type === 'radio') return 'radio';
	if (type === 'range') return 'slider';
	if (type === 'password') return 'textbox';
	return 'textbox';
};

/** The first element with this role. */
const byRole = (root: NodeLike | null, role: string): LightElement => {
	const found = elements(root).find((element) => roleOf(element) === role);
	assert.ok(found !== undefined, `no element with role ${role}`);
	return found;
};

/** The element with this role and this name, which is how a person names a control out loud. */
const byRoleName = (root: NodeLike | null, role: string, name: string): LightElement => {
	const found = elements(root).find((element) =>
		roleOf(element) === role && nameOf(root, element) === name);
	assert.ok(found !== undefined, `no element with role ${role} named ${name}`);
	return found;
};

/**
 * The accessible name, worked out the way the platform works it out for these elements: an
 * `aria-label` if there is one, otherwise the `<label>` whose `for` names it, otherwise its own
 * text. Written here rather than taken from the components, so it is the specification's answer
 * and not theirs.
 */
const nameOf = (root: NodeLike | null, element: LightElement): string => {
	const aria = element.getAttribute('aria-label');
	if (aria !== null) return aria;
	const id = element.getAttribute('id');
	if (id !== null) {
		const label = elements(root).find((node) =>
			node.localName === 'label' && node.getAttribute('for') === id);
		if (label !== undefined) return label.textContent ?? '';
	}
	return element.textContent ?? '';
};

const described = (root: NodeLike | null, element: LightElement): string => {
	const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id !== '');
	return ids
		.map((id) => elements(root).find((node) => node.getAttribute('id') === id)?.textContent ?? '')
		.join(' ');
};

/** Deliver one event the way the host would, with the element as its target. */
const fire = (element: LightElement, type: string, extra: Record<string, unknown> = {}): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element, ...extra });
};

const propOf = (element: LightElement, name: string): unknown =>
	(element as unknown as Record<string, unknown>)[name];

const setProp = (element: LightElement, name: string, value: unknown): void => {
	(element as unknown as Record<string, unknown>)[name] = value;
};

/** Mount an item into a fresh light document and hand back its body and the teardown. */
const page = (item: unknown): { body: ElementLike; stop: () => void } => {
	const document = createDocument();
	const stop = mount(document.body, item);
	return { body: document.body, stop: () => { stop(); } };
};

// --- what each control is ---------------------------------------------------------------------

test('every control is found by its role and its accessible name', () => {
	const { body, stop } = page([
		h(Button as never, { label: 'Save' }),
		h(TextField as never, { label: 'Email' }),
		h(TextArea as never, { label: 'Notes' }),
		h(Checkbox as never, { label: 'Remember me' }),
		h(Radio as never, { label: 'Small', option: 'small' }),
		h(Toggle as never, { label: 'Email me' }),
		h(Slider as never, { label: 'Volume' }),
		h(Select as never, { label: 'Size', options: ['small', 'large'] }),
	]);

	// Every one of them by role and name, the textarea included: a textarea with a label is a
	// textbox called what its label says, and it is the second textbox on the page.
	for (const [role, name, tag] of [
		['button', 'Save', 'button'],
		['textbox', 'Email', 'input'],
		['textbox', 'Notes', 'textarea'],
		['checkbox', 'Remember me', 'input'],
		['radio', 'Small', 'input'],
		['switch', 'Email me', 'input'],
		['slider', 'Volume', 'input'],
		['combobox', 'Size', 'select'],
	] as const) {
		assert.equal(byRoleName(body.firstChild, role, name).localName, tag,
			`the ${role} called ${name} is a <${tag}>`);
	}
	stop();
});

test('a button with an href is a link, and one without is a button', () => {
	const { body, stop } = page([
		h(Button as never, { label: 'Save' }),
		h(Button as never, { label: 'Docs', href: 'https://example.com/docs' }),
	]);

	const button = byRole(body.firstChild, 'button');
	assert.equal(button.localName, 'button');
	assert.equal(button.getAttribute('type'), 'button', 'never a submit by accident');

	const link = byRole(body.firstChild, 'link');
	assert.equal(link.localName, 'a');
	assert.equal(link.getAttribute('href'), 'https://example.com/docs');
	assert.equal(link.getAttribute('target'), '_blank');
	assert.equal(link.getAttribute('rel'), 'noopener noreferrer',
		'a new tab that can reach back at the page it came from is a hole nobody meant to open');
	stop();
});

test('hrefNewTab false leaves the link in the tab it is in', () => {
	const { body, stop } = page(h(Button as never, { label: 'Docs', href: '/docs', hrefNewTab: false }));
	const link = byRole(body.firstChild, 'link');
	assert.equal(link.getAttribute('target'), null);
	assert.equal(link.getAttribute('rel'), null);
	stop();
});

test('a control with no label, description or error is the element and nothing else', () => {
	const { body, stop } = page(h(TextField as never, { placeholder: 'Search' }));
	assert.equal(toHtml(body.childNodes as NodeLike[]), '<input id="field-0" type="text" placeholder="Search" class="aw0">',
		'no wrapper is built for a field that has nothing to put around it');
	stop();
});

// --- the cell moves the DOM, and the DOM moves the cell ----------------------------------------

test('a text field follows its cell, and its cell follows the field', () => {
	const value = mutable('start');
	const { body, stop } = page(h(TextField as never, { label: 'Email', value }));
	const input = byRole(body.firstChild, 'textbox');

	assert.equal(propOf(input, 'value'), 'start', 'the cell wrote the element');
	value.set('moved');
	assert.equal(propOf(input, 'value'), 'moved', 'and again when it changed');

	setProp(input, 'value', 'typed');
	fire(input, 'input');
	assert.equal(value.get(), 'typed', 'the input event wrote the cell');
	stop();
});

test('a checkbox follows its cell, and inverting flips what ticked means', () => {
	const on = mutable(false);
	const seen: boolean[] = [];
	const { body, stop } = page(h(Checkbox as never, { label: 'Yes', value: on, onChange: (next: boolean) => seen.push(next) }));
	const box = byRole(body.firstChild, 'checkbox');

	assert.equal(propOf(box, 'checked'), false);
	on.set(true);
	assert.equal(propOf(box, 'checked'), true);

	setProp(box, 'checked', false);
	fire(box, 'change');
	assert.equal(on.get(), false);
	assert.deepEqual(seen, [false], 'onChange got what the cell now holds');
	stop();

	const off = mutable(false);
	const inverted = page(h(Checkbox as never, { label: 'Hide', value: off, invert: true }));
	const flipped = byRole(inverted.body.firstChild, 'checkbox');
	assert.equal(propOf(flipped, 'checked'), true, 'inverted, false is ticked');
	setProp(flipped, 'checked', false);
	fire(flipped, 'change');
	assert.equal(off.get(), true, 'and unticking it writes true');
	inverted.stop();
});

test('every radio sharing one cell is one group, and picking one writes its option', () => {
	const size = mutable('small');
	const { body, stop } = page([
		h(Radio as never, { label: 'Small', value: size, option: 'small' }),
		h(Radio as never, { label: 'Large', value: size, option: 'large' }),
	]);

	const dots = elements(body.firstChild).filter((element) => roleOf(element) === 'radio');
	assert.equal(dots.length, 2);
	assert.equal(dots[0]!.getAttribute('name'), dots[1]!.getAttribute('name'),
		'one name is what makes the platform treat them as one group');
	assert.notEqual(dots[0]!.getAttribute('name'), null);
	assert.equal(propOf(dots[0]!, 'checked'), true);
	assert.equal(propOf(dots[1]!, 'checked'), false);

	fire(dots[1]!, 'change');
	assert.equal(size.get(), 'large');
	assert.equal(propOf(dots[0]!, 'checked'), false, 'and the other one let go');
	stop();
});

test('two radio groups on one page get two names', () => {
	const one = mutable('a');
	const two = mutable('a');
	const { body, stop } = page([
		h(Radio as never, { label: 'One', value: one, option: 'a' }),
		h(Radio as never, { label: 'Two', value: two, option: 'a' }),
	]);
	const dots = elements(body.firstChild).filter((element) => roleOf(element) === 'radio');
	assert.notEqual(dots[0]!.getAttribute('name'), dots[1]!.getAttribute('name'));
	stop();
});

test('a toggle is a checkbox wearing the switch role', () => {
	const on = mutable(false);
	const { body, stop } = page(h(Toggle as never, { label: 'Email me', value: on }));
	const control = byRole(body.firstChild, 'switch');
	assert.equal(control.localName, 'input');
	assert.equal(control.getAttribute('type'), 'checkbox');

	on.set(true);
	assert.equal(propOf(control, 'checked'), true);
	setProp(control, 'checked', false);
	fire(control, 'change');
	assert.equal(on.get(), false);
	stop();
});

test('a slider holds a number, and step zero is written out as any', () => {
	const volume = mutable(3);
	const { body, stop } = page(h(Slider as never, { label: 'Volume', value: volume, min: 0, max: 10 }));
	const line = byRole(body.firstChild, 'slider');
	assert.equal(line.getAttribute('min'), '0');
	assert.equal(line.getAttribute('max'), '10');
	assert.equal(line.getAttribute('step'), '1');
	assert.equal(propOf(line, 'value'), '3');

	setProp(line, 'value', '7');
	fire(line, 'input');
	assert.equal(volume.get(), 7);
	assert.equal(typeof volume.get(), 'number', 'a number, not the text the element carries');
	stop();

	const any = page(h(Slider as never, { label: 'Fine', step: 0 }));
	assert.equal(byRole(any.body.firstChild, 'slider').getAttribute('step'), 'any');
	any.stop();
});

test('a slider calls an onInput of the caller\'s own, after it has written the cell', () => {
	const volume = mutable(3);
	const seen: number[] = [];
	const { body, stop } = page(h(Slider as never, {
		label: 'Volume', value: volume, min: 0, max: 10,
		onInput: () => { seen.push(volume.get() as number); },
	}));

	const line = byRole(body.firstChild, 'slider');
	setProp(line, 'value', '7');
	fire(line, 'input');
	// Spreading the caller's props alone put this handler on the element and then wrote over it,
	// which lost it in silence. `ColorPicker` is what needs it: a slider's `input` is the only
	// thing that writes its colour.
	assert.deepEqual(seen, [7], 'called once, with the cell already written');
	stop();
});

test('a text area grows to its content where there is a layout to measure', () => {
	const value = mutable('');
	const document = createDocument();
	const stop = mount(document.body, h(TextArea as never, { value }));
	const area = elements(document.body.firstChild).find((element) => element.localName === 'textarea')!;

	// The light tree has no layout, so there is nothing to measure and nothing is written.
	assert.equal(area.getAttribute('style'), null);

	// A host that measures gets the height written into the same style attribute the theme's
	// values go through, so there is one writer of it.
	Object.defineProperty(area, 'scrollHeight', { value: 84, configurable: true });
	setProp(area, 'value', 'three\nlines\nhere');
	fire(area, 'input');
	assert.equal(area.getAttribute('style'), 'height: 84px;');
	assert.equal(value.get(), 'three\nlines\nhere');
	stop();
});

// --- what the states put on the element --------------------------------------------------------

test('disabled is one attribute and one theme segment, and it touches one node', () => {
	const off = mutable(false);
	const { document, ops } = recordingDocument();
	const stop = mount(document.body, h(Button as never, { label: 'Save', disabled: off }));
	const button = elements(document.body.firstChild).find((element) => element.localName === 'button')!;
	const plain = button.getAttribute('class');

	ops.length = 0;
	off.set(true);
	const stopped = ops.filter((line) => !line.includes('<style>'));
	assert.equal(stopped.length, 2, 'one class write and one attribute write, and nothing else');
	assert.deepEqual(stopped.filter((line) => line.endsWith('on <button>')), stopped, 'both on one node');
	assert.ok(stopped.some((line) => line === 'attr disabled="" on <button>'));
	assert.notEqual(button.getAttribute('class'), plain, 'the disabled segment reached the class list');

	ops.length = 0;
	off.set(false);
	const again = ops.filter((line) => !line.includes('<style>'));
	assert.equal(again.length, 2);
	assert.ok(again.some((line) => line === 'unattr disabled on <button>'));
	assert.equal(button.getAttribute('class'), plain, 'and back to the class it had, not a third one');
	stop();
});

test('a caller\'s own state cells are the ones the element writes', () => {
	const hovered = mutable(false);
	const focused = mutable(false);
	const clicked = mutable(false);
	const { body, stop } = page(h(Button as never, {
		label: 'Save', isHovered: hovered, isFocused: focused, isClicked: clicked,
	}));
	const button = byRole(body.firstChild, 'button');
	const plain = button.getAttribute('class');

	fire(button, 'mouseenter');
	assert.equal(hovered.get(), true, 'the cell the caller handed in is the one that is written');
	assert.notEqual(button.getAttribute('class'), plain, 'and it is the one the hovered segment follows');
	fire(button, 'focus');
	assert.equal(focused.get(), true);
	fire(button, 'mousedown');
	assert.equal(clicked.get(), true);

	fire(button, 'mouseleave');
	assert.equal(hovered.get(), false, 'and it is written again when the pointer leaves');
	assert.equal(clicked.get(), false);
	assert.equal(button.getAttribute('class'), plain, 'back to the class it started with');
	stop();
});

test('a control given no state cell keeps its own', () => {
	const { body, stop } = page(h(Button as never, { label: 'Save' }));
	const button = byRole(body.firstChild, 'button');
	const plain = button.getAttribute('class');
	fire(button, 'mouseenter');
	assert.notEqual(button.getAttribute('class'), plain, 'the hovered segment is on it');
	fire(button, 'mouseleave');
	assert.equal(button.getAttribute('class'), plain);
	stop();
});

test('an element of the wrong tag is refused, naming the tag it wanted and the tag it got', () => {
	const document = createDocument();
	const wrong = (make: (element: ElementLike) => unknown, wanted: string, given: string): void => {
		assert.throws(
			() => { mount(document.body, make(document.createElement(given) as unknown as ElementLike)); },
			new RegExp(`element must be <${wanted}>[^]*and this one is <${given}>`),
			`a <${given}> is not a <${wanted}>`,
		);
	};

	wrong((element) => h(Button as never, { label: 'Save', element }), 'button', 'div');
	wrong((element) => h(TextField as never, { element }), 'input', 'div');
	wrong((element) => h(TextArea as never, { element }), 'textarea', 'div');
	wrong((element) => h(Checkbox as never, { element }), 'input', 'div');
	wrong((element) => h(Radio as never, { element, option: 'a' }), 'input', 'div');
	wrong((element) => h(Toggle as never, { element }), 'input', 'div');
	wrong((element) => h(Slider as never, { element }), 'input', 'span');
	wrong((element) => h(Select as never, { element, options: ['a'] }), 'select', 'p');
});

test('an element of the right tag is decorated rather than replaced', () => {
	const document = createDocument();
	const own = document.createElement('input');
	const stop = mount(document.body, h(Checkbox as never, { label: 'Ok', element: own }));
	const box = byRole(document.body.firstChild, 'checkbox');
	assert.equal(box, own as unknown as LightElement, 'the caller keeps the node it handed in');
	assert.equal(box.getAttribute('type'), 'checkbox');
	stop();
});

test('a disabled button fires nothing', () => {
	const clicks: number[] = [];
	const { body, stop } = page(h(Button as never, { label: 'Save', disabled: true, onClick: () => clicks.push(1) }));
	fire(byRole(body.firstChild, 'button'), 'click');
	assert.deepEqual(clicks, []);
	stop();
});

test('a promise the click handler returns disables the button until it settles', async () => {
	let land = (): void => undefined;
	const waiting = new Promise<void>((resolve) => { land = resolve; });
	const { body, stop } = page(h(Button as never, { label: 'Save', onClick: () => waiting }));
	const button = byRole(body.firstChild, 'button');

	assert.equal(button.getAttribute('disabled'), null);
	fire(button, 'click');
	assert.equal(button.getAttribute('disabled'), '', 'busy while the promise is out');

	land();
	await waiting;
	await Promise.resolve();
	assert.equal(button.getAttribute('disabled'), null, 'and pressable again once it lands');
	stop();
});

test('a rejected click still gives the button back', async () => {
	const failing = Promise.reject(new Error('no'));
	failing.catch(() => undefined);
	const { body, stop } = page(h(Button as never, { label: 'Save', onClick: () => failing }));
	const button = byRole(body.firstChild, 'button');

	fire(button, 'click');
	assert.equal(button.getAttribute('disabled'), '');
	await failing.catch(() => undefined);
	await Promise.resolve();
	assert.equal(button.getAttribute('disabled'), null);
	stop();
});

// --- the field wiring, from the outside ---------------------------------------------------------

test('an error names itself in aria-describedby and comes and goes with the cell', () => {
	const error = mutable<string | null>(null);
	const { body, stop } = page(h(TextField as never, { label: 'Email', description: 'Work address', error }));
	const input = byRole(body.firstChild, 'textbox');

	assert.equal(input.getAttribute('aria-invalid'), null);
	assert.equal(described(body.firstChild, input), 'Work address');

	error.set('That is not an address');
	assert.equal(input.getAttribute('aria-invalid'), 'true');
	assert.equal(described(body.firstChild, input), 'Work address That is not an address');

	error.set(null);
	assert.equal(input.getAttribute('aria-invalid'), null);
	assert.equal(described(body.firstChild, input), 'Work address', 'and the message is gone');
	stop();
});

test('two fields in one render get different ids', () => {
	const { body, stop } = page([
		h(TextField as never, { label: 'One' }),
		h(TextField as never, { label: 'Two' }),
	]);
	const [one, two] = elements(body.firstChild).filter((element) => element.localName === 'input');
	assert.notEqual(one!.getAttribute('id'), two!.getAttribute('id'));
	stop();
});

test('a ticked box says so in the markup, and the cell still drives it once it is alive', async () => {
	const cases = [
		['Checkbox', (value: unknown) => h(Checkbox as never, { label: 'Remember me', value }), true],
		['Toggle', (value: unknown) => h(Toggle as never, { label: 'Email me', value }), true],
		['Radio', (value: unknown) => h(Radio as never, { label: 'Small', option: 'small', value }), 'small'],
	] as const;

	for (const [name, make, on] of cases) {
		const server = context();
		const markup = await render(h(() => make(mutable<unknown>(on))), { context: server });
		assert.match(markup, /<input [^>]*checked/,
			`${name} writes the state a server page shows, not one only a browser learns`);

		const document = createDocument();
		for (const node of parseHtml(markup, document)) document.body.appendChild(node);
		for (const node of parseHtml(`<style data-aweft>${server.theme.markup()}</style>`, document)) {
			document.head.appendChild(node);
		}
		const cell = mutable<unknown>(on);
		const stop = hydrate(document.body, () => make(cell));
		const box = elements(document.body.firstChild).find((element) => element.localName === 'input')!;
		assert.equal(propOf(box, 'checked'), true, `${name} is ticked on the element itself`);

		cell.set(name === 'Radio' ? 'large' : false);
		assert.equal(propOf(box, 'checked'), false, `${name} follows the cell after the mount`);
		assert.equal(box.getAttribute('checked'), null);

		// And the other direction on the node the server sent, which is the half a hydrated page
		// used to lose (design 133).
		setProp(box, 'checked', true);
		fire(box, 'change');
		assert.equal(cell.get(), on, `${name} writes its cell from an event on the adopted element`);
		stop();
	}
});

/** Parse a server page into a document, with the stylesheet it came with. */
const served = (markup: string, css: string): ReturnType<typeof createDocument> => {
	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${css}</style>`, document)) document.head.appendChild(node);
	return document;
};

test('a text field carries its text into the markup, and the cell drives it once it is alive', async () => {
	const server = context();
	const markup = await render(
		h(TextField as never, { label: 'Email', value: mutable('hello') }), { context: server },
	);
	assert.match(markup, /<input [^>]*value="hello"/,
		'a server page shows what is in the field, not an empty box the browser fills in later');

	const document = served(markup, server.theme.markup());
	const cell = mutable('hello');
	const stop = hydrate(document.body, h(TextField as never, { label: 'Email', value: cell }));
	const input = byRoleName(document.body.firstChild, 'textbox', 'Email');

	assert.equal(propOf(input, 'value'), 'hello', 'the element holds it as a property too');
	cell.set('other');
	assert.equal(propOf(input, 'value'), 'other', 'and the cell still drives the element it adopted');

	setProp(input, 'value', 'typed');
	fire(input, 'input');
	assert.equal(cell.get(), 'typed', 'and the element still drives the cell (design 133)');
	stop();
});

test('a text area carries its text into the markup, and the cell drives it once it is alive', async () => {
	const server = context();
	const markup = await render(
		h(TextArea as never, { label: 'Notes', value: mutable('bio') }), { context: server },
	);
	assert.match(markup, /<textarea[^>]*>bio<\/textarea>/,
		'a textarea carries its text as its content, which is where a server page has to put it');

	const document = served(markup, server.theme.markup());
	const cell = mutable('bio');
	const stop = hydrate(document.body, h(TextArea as never, { label: 'Notes', value: cell }));
	const area = byRoleName(document.body.firstChild, 'textbox', 'Notes');

	assert.equal(propOf(area, 'value'), 'bio');
	cell.set('other');
	assert.equal(propOf(area, 'value'), 'other', 'the cell still drives the element it adopted');

	setProp(area, 'value', 'typed');
	fire(area, 'input');
	assert.equal(cell.get(), 'typed', 'and the element still drives the cell (design 133)');
	stop();
});

// --- markup, and taking it over -----------------------------------------------------------------

/**
 * Count the elements a hydration makes in this document, and hand back the list.
 *
 * A hydration builds the client's tree and pairs it against the server's, so the elements it
 * makes on the way are made and then dropped. That is `dom`'s bookkeeping, not this package's
 * (a known limit stated in `dom`'s README), and it is counted here so the number cannot move unnoticed.
 */
const countingMade = (document: ReturnType<typeof createDocument>): NodeLike[] => {
	const made: NodeLike[] = [];
	const doc = document as unknown as Record<string, (...args: unknown[]) => NodeLike>;
	for (const factory of ['createElement', 'createElementNS']) {
		const real = doc[factory]!.bind(document);
		doc[factory] = (...args: unknown[]): NodeLike => {
			const node = real(...args);
			made.push(node);
			return node;
		};
	}
	return made;
};

const everything = (): unknown => h('div', {},
	h(Button as never, { label: 'Save' }),
	h(Button as never, { label: 'Docs', href: '/docs' }),
	h(TextField as never, { label: 'Email', description: 'Work address' }),
	h(TextArea as never, { label: 'Notes' }),
	h(Checkbox as never, { label: 'Remember me' }),
	h(Radio as never, { label: 'Small', option: 'small' }),
	h(Toggle as never, { label: 'Email me' }),
	h(Slider as never, { label: 'Volume', min: 0, max: 10 }),
	h(Select as never, { label: 'Size', options: ['small', 'large'], placeholder: 'Pick one' }),
	h(Paper as never, {}, 'a card'),
	h(LoadingDots as never, {}));

test('every control renders to markup and hydrates onto the nodes the server wrote', async () => {
	const server = context();
	const markup = await render(h(everything), { context: server });
	const css = server.theme.markup();

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${css}</style>`, document)) document.head.appendChild(node);

	const before = elements(document.body.firstChild);
	assert.ok(before.length > 20, 'the server wrote the whole page');

	const made = countingMade(document);
	const stop = hydrate(document.body, everything);

	// One fresh element per element on the page, because the client builds the same tree and
	// then pairs it against the server's. Not zero: nothing in this package can make it zero.
	// Every one is made in this document, because `hydrate` takes what makes the item and runs
	// it inside the hydration (design 157); nothing is built at the call site any more.
	assert.equal(made.length, before.length,
		'a hydration makes the client\'s tree and keeps the server\'s: one made and dropped per element');

	const after = elements(document.body.firstChild);
	assert.equal(after.length, before.length);
	assert.ok(after.every((element, at) => element === before[at]),
		'every element is the same object it was: adopted, not remade');
	assert.equal(toHtml(document.body.childNodes), markup, 'and the page is the page the server sent');
	assert.equal(document.head.childNodes.length, 1, 'the server stylesheet was adopted, not doubled');
	stop();
});

test('hydration keeps every server element, by identity', async () => {
	const server = context();
	const markup = await render(h(everything), { context: server });
	const css = server.theme.markup();

	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${css}</style>`, document)) document.head.appendChild(node);

	const before = elements(document.body.firstChild);
	const made = countingMade(document);
	const stop = hydrate(document.body, everything);
	const after = elements(document.body.firstChild);

	// By identity, one for one. A deep comparison passes for a clone the client built and put
	// where the server's node was, which is the thing this test exists to catch.
	assert.equal(after.length, before.length, 'the page has the elements it had');
	const swapped = before.filter((element, at) => after[at] !== element);
	assert.deepEqual(swapped.map((element) => element.localName), [],
		'a hydration that swaps a node has replaced something it should have adopted');

	// And the other half of the same story: every element the client made on the way is gone.
	assert.ok(made.length > 0, 'the client did build a tree');
	assert.deepEqual(made.filter((node) => after.includes(node as unknown as LightElement)), [],
		'nothing the client made ended up in the page');
	stop();
});
