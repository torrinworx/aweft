// The composites, in the light tree: what they render, what a screen reader would call them, and
// that the cell and the element follow each other in both directions.
//
// `Validate` and `FileDrop` have suites of their own next door, because both are long enough to
// bury the rest. What only a browser can answer is `browser.test.ts`, and what the gallery page
// answers is `recipes/ui/main.ts`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { ElementLike, LightElement, NodeLike } from '@aweftjs/dom';
import { recordingDocument } from '@aweftjs/testing';
import {
	ColorPicker, Default, DropDown, FileDrop, Icons, Modal, PopupContext, Stage, StageContext,
	TextField, Tooltip, Validate, context, h, hydrate, mark, mount, render,
} from '@aweftjs/ui';

import { testIcons } from './fixtures/icons.ts';

// Every page here answers the names its composites ask for, because `Icons` starts empty and a
// name nothing answers asserts (design 144).
const answered = (item: unknown): unknown => h(Icons as never, { value: testIcons }, item);

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
	if (tag === 'summary') return 'button';
	if (tag === 'button') return 'button';
	if (tag === 'dialog') return 'dialog';
	if (tag !== 'input') return tag;
	const type = element.getAttribute('type') ?? 'text';
	if (type === 'range') return 'slider';
	if (type === 'file') return 'textbox';
	return 'textbox';
};

/**
 * The accessible name, worked out the way the platform works it out for these elements: an
 * `aria-label` if there is one, otherwise the `<label>` whose `for` names it, otherwise the element
 * `aria-labelledby` names, otherwise its own text. Written here rather than taken from the
 * components, so it is the specification's answer and not theirs.
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
	const labelledBy = element.getAttribute('aria-labelledby');
	if (labelledBy !== null) {
		const named = elements(root).find((node) => node.getAttribute('id') === labelledBy);
		if (named !== undefined) return named.textContent ?? '';
	}
	return element.textContent ?? '';
};

const byRole = (root: NodeLike | null, role: string): LightElement => {
	const found = elements(root).find((element) => roleOf(element) === role);
	assert.ok(found !== undefined, `no element with role ${role}`);
	return found;
};

const byRoleName = (root: NodeLike | null, role: string, name: string): LightElement => {
	const found = elements(root).find((element) =>
		roleOf(element) === role && nameOf(root, element) === name);
	assert.ok(found !== undefined, `no element with role ${role} named ${name}`);
	return found;
};

const byTag = (root: NodeLike | null, tag: string): LightElement => {
	const found = elements(root).find((element) => element.localName === tag);
	assert.ok(found !== undefined, `no <${tag}> on the page`);
	return found;
};

/** Deliver one event the way the host would, with the element as its target. */
const fire = (element: LightElement, type: string, extra: Record<string, unknown> = {}): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element, ...extra });
};

const setProp = (element: LightElement, name: string, value: unknown): void => {
	(element as unknown as Record<string, unknown>)[name] = value;
};

const page = (item: unknown): { body: ElementLike; stop: () => void } => {
	const document = createDocument();
	const stop = mount(document.body, answered(item));
	return { body: document.body, stop: () => { stop(); } };
};

/** A stage with a page act and one act to open, and the stage value in hand. */
const staged = (): { body: ElementLike; stage: () => StageHandle; stop: () => void } => {
	let held: StageHandle | null = null;
	const Home = (props: { stage?: unknown }): unknown => {
		held = props.stage as StageHandle;
		return h('p', {}, 'the page');
	};
	const found = page(h(StageContext as never, {
		acts: { '': Home, edit: () => h('p', {}, 'editing'), other: () => h('p', {}, 'the other act') },
		initial: '',
	}, h(Stage as never, {})));
	return { body: found.body, stage: () => held!, stop: found.stop };
};

interface StageHandle {
	open(options: Record<string, unknown>): void;
	close(): void;
	current: { get(): unknown };
}

// --- DropDown ----------------------------------------------------------------------------------

test('a drop down is a details whose summary is a button with the label on it', () => {
	const { body, stop } = page(h(DropDown as never, { label: 'Filters' }, h('p', {}, 'inside')));

	const details = byTag(body.firstChild, 'details');
	const summary = byRoleName(body.firstChild, 'button', 'Filters');
	assert.equal(summary.localName, 'summary');
	assert.equal(summary.parentNode, details, 'the summary is the details\' own');

	// The element says it is a button and says whether it is expanded. Writing either would be
	// writing over what the platform already says (design 136).
	assert.equal(summary.getAttribute('role'), null);
	assert.equal(summary.getAttribute('aria-expanded'), null);
	assert.match(details.textContent ?? '', /inside/, 'the content is in the flow, not floating');
	stop();
});

test('the open cell writes the details, and the element\'s toggle writes the cell', () => {
	const open = mutable(false);
	const { body, stop } = page(h(DropDown as never, { label: 'Filters', open }, h('p', {}, 'inside')));
	const details = byTag(body.firstChild, 'details');

	assert.equal(details.getAttribute('open'), null);
	open.set(true);
	assert.equal(details.getAttribute('open'), '', 'the cell opened it');

	// And back the other way: the platform toggles the element and fires `toggle`.
	setProp(details, 'open', false);
	fire(details, 'toggle');
	assert.equal(open.get(), false, 'the toggle event wrote the cell');

	setProp(details, 'open', true);
	fire(details, 'toggle');
	assert.equal(open.get(), true);
	stop();
});

test('the chevron follows the open state, and arrow left puts it first', () => {
	const open = mutable(false);
	const { body, stop } = page(h(DropDown as never, { label: 'Filters', open }));
	const summary = byTag(body.firstChild, 'summary');

	const pathOf = (): string => elements(summary).filter((node) => node.localName === 'path')
		.map((node) => node.getAttribute('d') ?? '').join('|');
	const closed = pathOf();
	open.set(true);
	assert.notEqual(pathOf(), closed, 'the open chevron is a different drawing');
	stop();

	const left = page(h(DropDown as never, { label: 'Filters', arrow: 'left' }));
	const first = elements(byTag(left.body.firstChild, 'summary').firstChild)[0];
	assert.equal(first?.localName, 'svg', 'the chevron is the first thing in the summary');
	left.stop();
});

test('a disabled drop down is out of the focus order and says so', () => {
	const { body, stop } = page(h(DropDown as never, { label: 'Filters', disabled: true }));
	const summary = byTag(body.firstChild, 'summary');
	assert.equal(summary.getAttribute('aria-disabled'), 'true');
	assert.equal(summary.getAttribute('tabindex'), '-1');
	stop();
});

test('opening a drop down is one attribute write, on one node', () => {
	const open = mutable(false);
	const { document, ops } = recordingDocument();
	const stop = mount(document.body, answered(h(DropDown as never, { label: 'Filters', open })));
	const details = elements(document.body.firstChild).find((node) => node.localName === 'details')!;

	// One attribute on the details, and nothing else outside the icon: the chevron is one `Icon`
	// whose `name` moved, so what is left is that icon swapping the drawing inside its own `<svg>`.
	const drawing = /<(svg|g|path)>/;
	ops.length = 0;
	open.set(true);
	const written = ops.filter((line) => !line.includes('<style>'));
	assert.deepEqual(written.filter((line) => !drawing.test(line)), ['attr open="" on <details>']);
	assert.equal(details.getAttribute('open'), '');

	ops.length = 0;
	open.set(false);
	const back = ops.filter((line) => !line.includes('<style>') && !drawing.test(line));
	assert.deepEqual(back, ['unattr open on <details>']);
	stop();
});

// --- Tooltip ------------------------------------------------------------------------------------

test('a tooltip panel is role=tooltip and the anchor is described by it', () => {
	const { body, stop } = page(h(PopupContext as never, {},
		h(Tooltip as never, { label: 'Delete this for good' },
			h('button', {}, 'Delete'))));

	const panel = byRole(body.firstChild, 'tooltip');
	assert.match(panel.textContent ?? '', /Delete this for good/);

	const anchor = byRoleName(body.firstChild, 'button', 'Delete');
	assert.equal(anchor.getAttribute('aria-describedby'), panel.getAttribute('id'),
		'the anchor names the panel, so the tip is readable and not only hoverable');
	stop();
});

test('the enabled cell drives the tooltip, and unmounting takes the link off the anchor', () => {
	const shown = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext as never, {},
		h(Tooltip as never, { label: 'Delete this for good', enabled: shown },
			h('button', {}, 'Delete'))));

	const panel = byRole(document.body.firstChild, 'tooltip');
	const box = panel.parentNode as unknown as LightElement;
	assert.match(box.getAttribute('style') ?? '', /display: none/, 'closed, so it is not on the screen');

	shown.set(true);
	assert.doesNotMatch(box.getAttribute('style') ?? '', /display: none/,
		'the cell opened it, and the placement loop took over');

	const anchor = byRoleName(document.body.firstChild, 'button', 'Delete');
	assert.notEqual(anchor.getAttribute('aria-describedby'), null);
	stop();
	assert.equal(anchor.getAttribute('aria-describedby'), null,
		'an anchor a caller handed in goes back the way it came');
});

test('a stage whose act holds a tooltip renders the act opened over it', () => {
	// The tip's panel is at the popup sink, which mounts into the same element as the page, and the
	// act that replaces this one mounts there too. Before design 153 the act that was opened
	// rendered nothing at all.
	let held: StageHandle | null = null;
	const Home = (props: { stage?: unknown }): unknown => {
		held = props.stage as StageHandle;
		return h(Tooltip as never, { label: 'This cannot be undone.' }, h('button', {}, 'Delete'));
	};
	const { body, stop } = page(h(PopupContext as never, {}, h(StageContext as never, {
		acts: { '': Home, other: () => h('p', {}, 'the other act') },
		initial: '',
	}, h(Stage as never, {}))));

	assert.ok(elements(body.firstChild).some((element) => roleOf(element) === 'tooltip'),
		'the first act put a tip on the page');
	held!.open({ name: 'other' });
	assert.match(body.textContent ?? '', /the other act/, 'the act that was opened is on the page');
	assert.ok(!elements(body.firstChild).some((element) => roleOf(element) === 'tooltip'),
		'and the tip went with the act that held it');
	stop();
});

test('a mark.popup replaces the tooltip\'s label with markup', () => {
	const { body, stop } = page(h(PopupContext as never, {},
		h(Tooltip as never, { label: 'ignored' },
			h('button', {}, 'Delete'),
			mark('popup', null, h('em', { id: 'rich' }, 'read this')))));

	const panel = byRole(body.firstChild, 'tooltip');
	assert.match(panel.textContent ?? '', /read this/);
	assert.doesNotMatch(panel.textContent ?? '', /ignored/, 'the label gives way to the markup');
	assert.ok(elements(panel.firstChild).some((element) => element.getAttribute('id') === 'rich'),
		'and the markup is markup, not text');
	stop();
});

// --- ColorPicker --------------------------------------------------------------------------------

/** The sliders, by the labels the component gives them. Real range inputs, both of them. */
const knobs = (root: NodeLike | null): Record<string, LightElement | undefined> => {
	const found: Record<string, LightElement | undefined> = {};
	for (const name of ['Hue', 'Opacity']) {
		found[name] = elements(root).find((element) =>
			element.localName === 'input' && nameOf(root, element) === name);
	}
	return found;
};

/** The plane's thumb, which is the one element in this package with a role written on it. */
const thumbOf = (root: NodeLike | null): LightElement => {
	const found = elements(root).find((element) =>
		element.localName === 'span' && element.getAttribute('role') === 'slider');
	assert.ok(found !== undefined, 'the plane has a thumb');
	return found;
};

/** The plane is what the thumb sits in, given a box so a press has somewhere to land. */
const planeOf = (root: NodeLike | null, box: { width: number; height: number }): LightElement => {
	const plane = thumbOf(root).parentNode as unknown as LightElement;
	(plane as unknown as Record<string, unknown>)['getBoundingClientRect'] =
		(): unknown => ({ left: 0, top: 0, width: box.width, height: box.height });
	return plane;
};

test('a colour picker is a plane, a hue slider and a swatch nobody has to read', () => {
	const { body, stop } = page(h(ColorPicker as never, { value: mutable('#ff0000') }));
	const found = knobs(body.firstChild);
	for (const name of ['Hue', 'Opacity']) {
		assert.ok(found[name] !== undefined, `there is a slider called ${name}`);
		assert.equal(found[name]!.localName, 'input');
	}
	// Design 222 reverses design 139's other two: they are the plane now.
	assert.equal(elements(body.firstChild).filter((element) => element.localName === 'input').length, 2,
		'two range inputs, not four');

	const thumb = thumbOf(body.firstChild);
	assert.equal(thumb.getAttribute('tabindex'), '0', 'the thumb is where a keyboard lands');
	assert.equal(thumb.getAttribute('aria-label'), 'Saturation and brightness');
	assert.equal(thumb.getAttribute('aria-valuetext'), 'saturation 100%, brightness 100%',
		'and it says both axes, because there is no two-axis role');
	assert.equal(thumb.getAttribute('aria-valuenow'), '100', 'with the saturation as the number');

	const swatch = elements(body.firstChild).find((element) =>
		element.getAttribute('aria-hidden') === 'true' && element.localName === 'span');
	assert.ok(swatch !== undefined, 'the swatch is hidden from a screen reader');
	assert.match(swatch.getAttribute('style') ?? '', /rgb\(255, 0, 0\)/,
		'and it is painted the colour the cell holds');
	stop();
});

test('hasAlpha false takes the opacity slider off', () => {
	const { body, stop } = page(h(ColorPicker as never, { value: mutable('#ff0000'), hasAlpha: false }));
	const found = knobs(body.firstChild);
	assert.ok(found['Hue'] !== undefined);
	assert.equal(found['Opacity'], undefined, 'no opacity slider when there is no alpha to pick');
	stop();
});

test('the colour cell moves the thumb, and the hue slider moves the cell', () => {
	const picked = mutable('#ff0000');
	const { body, stop } = page(h(ColorPicker as never, { value: picked, hasAlpha: false }));
	const hue = knobs(body.firstChild)['Hue']!;
	const thumb = thumbOf(body.firstChild);

	// Red read into hue, saturation and brightness, worked out by hand: hue 0, both others full.
	assert.equal((hue as unknown as { value?: unknown }).value, '0');
	assert.match(thumb.getAttribute('style') ?? '', /left: 100%/);
	assert.match(thumb.getAttribute('style') ?? '', /top: 0%/, 'full brightness is the top edge');

	// #804040 is half saturated at half brightness, worked out by hand off `hsvOf`.
	picked.set('#804040');
	assert.equal((hue as unknown as { value?: unknown }).value, '0');
	assert.match(thumb.getAttribute('style') ?? '', /left: 50%/);
	assert.match(thumb.getAttribute('style') ?? '', /top: 50%/);
	assert.equal(thumb.getAttribute('aria-valuetext'), 'saturation 50%, brightness 50%');

	picked.set('rgb(0, 0, 255)');
	assert.equal((hue as unknown as { value?: unknown }).value, '240', 'blue is 240 degrees round');

	setProp(hue, 'value', '120');
	fire(hue, 'input');
	assert.equal(picked.get(), 'rgb(0, 255, 0)', 'and the slider wrote the cell back as rgb()');
	stop();
});

test('a press in the plane writes the saturation and the brightness', () => {
	const picked = mutable('#ff0000');
	const { body, stop } = page(h(ColorPicker as never, { value: picked, hasAlpha: false }));
	const plane = planeOf(body.firstChild, { width: 200, height: 100 });
	const thumb = thumbOf(body.firstChild);

	// A quarter across and a quarter down a 200 by 100 box: saturation 25, brightness 75. The
	// colour that names, worked out by hand through `fromHsv` at hue 0.
	fire(plane, 'pointerdown', { currentTarget: plane, pointerId: 1, clientX: 50, clientY: 25 });
	assert.equal(picked.get(), 'rgb(191, 143, 143)');
	assert.equal(thumb.getAttribute('aria-valuetext'), 'saturation 25%, brightness 75%');
	assert.match(thumb.getAttribute('style') ?? '', /left: 25%/);
	assert.match(thumb.getAttribute('style') ?? '', /top: 25%/);

	// And the drag keeps going while the pointer is down.
	fire(plane, 'pointermove', { currentTarget: plane, pointerId: 1, clientX: 200, clientY: 0 });
	assert.equal(picked.get(), 'rgb(255, 0, 0)', 'the far top corner is the hue at full strength');
	stop();
});

test('an arrow on the thumb writes the cell', () => {
	const picked = mutable('#ff0000');
	const { body, stop } = page(h(ColorPicker as never, { value: picked, hasAlpha: false }));
	const thumb = thumbOf(body.firstChild);

	// One step is a hundredth of the range, so saturation goes from 100 to 99. The colour that
	// names is `fromHsv(0, 0.99, 1, 1)`, worked out by hand.
	fire(thumb, 'keydown', { currentTarget: thumb, key: 'ArrowLeft', shiftKey: false });
	assert.equal(picked.get(), 'rgb(255, 3, 3)');
	assert.equal(thumb.getAttribute('aria-valuetext'), 'saturation 99%, brightness 100%');

	// Down the box is less brightness, and Shift is ten steps of it.
	fire(thumb, 'keydown', { currentTarget: thumb, key: 'ArrowDown', shiftKey: true });
	assert.equal(thumb.getAttribute('aria-valuetext'), 'saturation 99%, brightness 90%');
	stop();
});

test('a disabled picker moves for neither a press nor a key', () => {
	const picked = mutable('#ff0000');
	const { body, stop } = page(h(ColorPicker as never, { value: picked, hasAlpha: false, disabled: true }));
	const plane = planeOf(body.firstChild, { width: 200, height: 100 });
	const thumb = thumbOf(body.firstChild);

	fire(plane, 'pointerdown', { currentTarget: plane, pointerId: 1, clientX: 50, clientY: 25 });
	fire(thumb, 'keydown', { currentTarget: thumb, key: 'End', shiftKey: false });
	assert.equal(picked.get(), '#ff0000', 'the cell is what the caller put in it');
	assert.equal(thumb.getAttribute('tabindex'), '-1', 'and the thumb is out of the tab order');
	stop();
});

test('mounting a picker on a colour leaves that colour alone', () => {
	// Three notations the component would rewrite if it wrote at all: a hex, an hsl() and an
	// rgba(). Counting the writes rather than reading the value, because `#ff0000` and the rgb()
	// the component would write are the same colour and the value alone cannot tell them apart.
	for (const start of ['#1b6ef3', 'hsl(210, 50%, 40%)', 'rgba(255, 0, 0, 0.5)']) {
		const picked = mutable(start);
		const writes: unknown[] = [];
		// An effect calls back once with what the cell holds now, and that first call is not a write.
		let first = true;
		const off = picked.effect((held) => {
			if (first) {
				first = false;
				return;
			}
			writes.push(held);
		});

		const { stop } = page(h(ColorPicker as never, { value: picked, hasAlpha: false }));
		assert.deepEqual(writes, [], `mounting on ${start} wrote the cell`);
		assert.equal(picked.get(), start, 'and left the caller\'s own notation alone');
		off();
		stop();
	}
});

test('moving one knob writes the cell once', () => {
	const picked = mutable('#1b6ef3');
	const writes: unknown[] = [];
	let first = true;
	const off = picked.effect((held) => {
		if (first) {
			first = false;
			return;
		}
		writes.push(held);
	});

	const { body, stop } = page(h(ColorPicker as never, { value: picked }));
	const hue = knobs(body.firstChild)['Hue']!;
	setProp(hue, 'value', '120');
	fire(hue, 'input');
	assert.equal(writes.length, 1, 'one move is one write');
	off();
	stop();
});

test('with no opacity slider the alpha the cell arrived with is kept', () => {
	const picked = mutable('rgba(255, 0, 0, 0.5)');
	const { body, stop } = page(h(ColorPicker as never, { value: picked, hasAlpha: false }));

	const hue = knobs(body.firstChild)['Hue']!;
	setProp(hue, 'value', '120');
	fire(hue, 'input');
	// A half transparent red becomes a half transparent green. Nothing on the screen can change an
	// alpha the person cannot see, so nothing does.
	assert.equal(picked.get(), 'rgba(0, 255, 0, 0.5)');
	stop();
});

test('a colour picker refuses text that is not a colour, naming the text', () => {
	const document = createDocument();
	assert.throws(
		() => { mount(document.body, h(ColorPicker as never, { value: mutable('not a colour') })); },
		/cannot read "not a colour" as a colour/,
	);
});

// --- a state prop is a cell, in every component that takes one ----------------------------------

test('a state prop given a plain value is a loud assert naming the prop and the fix', () => {
	// The same mistake `Validate` already refused. A component that quietly kept a cell of its own
	// looked as though it had honoured what the caller asked for and had not.
	for (const [name, build, message] of [
		['DropDown open', () => h(DropDown as never, { label: 'Filters', open: true }),
			/DropDown open takes a cell, not a value; pass open=\{cell\}/],
		['Tooltip enabled', () => h(PopupContext as never, {},
			h(Tooltip as never, { label: 'tip', enabled: true }, h('span', {}, 'anchor'))),
		/Tooltip enabled takes a cell, not a value; pass enabled=\{cell\}/],
		['ColorPicker value', () => h(ColorPicker as never, { value: '#ff0000' }),
			/ColorPicker value takes a cell, not a value; pass value=\{cell\}/],
	] as [string, () => unknown, RegExp][]) {
		const document = createDocument();
		assert.throws(() => { mount(document.body, build()); }, message, name);
	}
});

// --- Modal and Default ---------------------------------------------------------------------------

test('a modal opens as it mounts, inside a stage', () => {
	const held = staged();
	held.stage().open({ name: 'edit', template: Modal });

	const dialog = byRole(held.body.firstChild, 'dialog');
	assert.equal(dialog.localName, 'dialog');
	assert.equal(dialog.getAttribute('open'), '', 'it is showing before anybody pressed anything');
	assert.match(dialog.textContent ?? '', /editing/, 'and the act is inside it');
	held.stop();
});

test('a modal labels itself, and every close goes through the stage', () => {
	const held = staged();
	const Labelled = (props: { children?: unknown[] }): unknown =>
		h(Modal as never, { label: 'Edit' }, ...(props.children ?? []));
	held.stage().open({ name: 'edit', template: Labelled });

	const dialog = byRoleName(held.body.firstChild, 'dialog', 'Edit');
	assert.equal(dialog.getAttribute('aria-labelledby'), byTag(held.body.firstChild, 'h2').getAttribute('id'));

	// Escape arrives as the element's own `cancel` event.
	fire(dialog, 'cancel');
	assert.equal(held.stage().current.get(), '', 'the stage went back to what the URL decides');
	assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 0);
	held.stop();
});

test('a modal reads the props it names and writes none of the act\'s own on the dialog', () => {
	// Design 213: an `open` hands its props to the template and the act both. A `Modal` that spread
	// what it did not name wrote the act's row on the element, `session="[object Object]"`.
	let held: StageHandle | null = null;
	const seen: Record<string, unknown>[] = [];
	const session = { id: 7 };
	const found = page(h(StageContext as never, {
		acts: {
			'': (props: { stage?: unknown }): unknown => {
				held = props.stage as StageHandle;
				return h('p', {}, 'the page');
			},
			edit: (props: Record<string, unknown>): unknown => {
				seen.push(props);
				return h('p', {}, 'editing');
			},
		},
		initial: '',
	}, h(Stage as never, {})));

	const stage = (): StageHandle => held!;
	stage().open({ name: 'edit', template: Modal, label: 'Sign out?', session, extra: 'x' });

	const dialog = byRole(found.body.firstChild, 'dialog');
	assert.equal(dialog.getAttribute('session'), null, 'the act\'s row is not an attribute');
	assert.equal(dialog.getAttribute('extra'), null);
	assert.equal(byTag(found.body.firstChild, 'h2').textContent, 'Sign out?',
		'and the one prop the Modal names is still read');

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!['session'], session, 'the act was handed both of them');
	assert.equal(seen[0]!['extra'], 'x');
	found.stop();
});

test('the close button closes a modal, and a backdrop mousedown does too', () => {
	for (const [name, close] of [
		['the close button', (root: NodeLike | null) => {
			fire(byRoleName(root, 'button', 'Close'), 'click');
		}],
		['a mousedown on the backdrop', (root: NodeLike | null) => {
			const dialog = byRole(root, 'dialog');
			fire(dialog, 'mousedown');
		}],
	] as const) {
		const held = staged();
		held.stage().open({ name: 'edit', template: Modal });
		assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 1);
		close(held.body.firstChild);
		assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 0, name);
		held.stop();
	}
});

test('noEsc prevents the cancel event and keeps the modal up', () => {
	const held = staged();
	const Locked = (props: { children?: unknown[] }): unknown =>
		h(Modal as never, { noEsc: true }, ...(props.children ?? []));
	held.stage().open({ name: 'edit', template: Locked });

	const dialog = byRole(held.body.firstChild, 'dialog');
	let prevented = false;
	fire(dialog, 'cancel', { preventDefault: () => { prevented = true; } });
	assert.equal(prevented, true, 'the platform is told not to close it');
	assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 1,
		'and it is still up');
	held.stop();
});

test('noClickEsc keeps a modal up when the backdrop is pressed', () => {
	const held = staged();
	const Locked = (props: { children?: unknown[] }): unknown =>
		h(Modal as never, { noClickEsc: true }, ...(props.children ?? []));
	held.stage().open({ name: 'edit', template: Locked });
	fire(byRole(held.body.firstChild, 'dialog'), 'mousedown');
	assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 1);
	held.stop();
});

test('a mousedown inside a modal is not a mousedown on its backdrop', () => {
	const held = staged();
	held.stage().open({ name: 'edit', template: Modal });
	// On the dialog, as a bubbled event is, but with the content as its target, which is what tells
	// the two apart: only the backdrop targets the dialog itself.
	const dialog = byRole(held.body.firstChild, 'dialog');
	fire(dialog, 'mousedown', { target: byTag(held.body.firstChild, 'p') });
	assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 1,
		'a click on the content is not a click on the backdrop');
	held.stop();
});

test('opening another act over a modal shows that act', () => {
	const held = staged();
	held.stage().open({ name: 'edit', template: Modal });
	assert.match(held.body.textContent ?? '', /editing/);

	held.stage().open({ name: 'other' });
	// Taking the modal down is not a close the person asked for. Reaching the stage from the
	// teardown closed the act that had just been opened, and the page fell back to the base act.
	assert.match(held.body.textContent ?? '', /the other act/);
	assert.equal(elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length, 0,
		'and the dialog is gone with the act it held');
	held.stop();
});

test('opening the same act twice with Modal leaves one dialog up, as Default does', () => {
	for (const template of [Default, Modal] as const) {
		const held = staged();
		held.stage().open({ name: 'edit', template });
		held.stage().open({ name: 'edit', template });

		assert.match(held.body.textContent ?? '', /editing/, 'the act is still showing');
		const dialogs = elements(held.body.firstChild).filter((e) => e.localName === 'dialog').length;
		assert.equal(dialogs, template === Modal ? 1 : 0, 'and there is only ever one of it');
		held.stop();
	}
});

test('a Modal with no stage above it asserts, naming the call that shows one', () => {
	const document = createDocument();
	assert.throws(
		() => { mount(document.body, h(Modal as never, {}, 'x')); },
		/no stage above it[^]*stage\.open\(\{ name, template: Modal, history: true \}\)/,
	);
});

test('a composite on a page with no Icons above it asserts, naming the fix', () => {
	// The names below are what these components ask for, and `Icons` starts empty (design 144), so
	// a page that holds one answers for them. The assert is the only thing that says so.
	const cases: [string, unknown][] = [
		['chevron-down', h(DropDown as never, { label: 'Filters' })],
		['triangle-alert', h(Validate as never, { value: mutable('x'), validate: () => 'no' })],
		['upload', h(FileDrop as never, {})],
	];
	for (const [name, item] of cases) {
		const document = createDocument();
		assert.throws(
			() => { mount(document.body, item); },
			new RegExp(`no icon named ${name}[^]*<Icons value=\\{pack\\}>`),
			`${name} is asked for by name, and nothing answered it`,
		);
	}
});

test('Default is the template that adds nothing', () => {
	const Home = (): unknown => h('p', { id: 'act' }, 'the page');
	const { body, stop } = page(h(StageContext as never, {
		acts: { '': Home }, initial: '', template: Default,
	}, h(Stage as never, {})));

	const found = elements(body.firstChild).filter((element) => element.localName !== 'div');
	assert.deepEqual(found.map((element) => element.localName), ['p'],
		'the act, and no element of the template\'s own');
	stop();
});

// --- markup, and taking it over --------------------------------------------------------------------

/**
 * Count the elements a hydration makes in this document, and hand back the list.
 *
 * A hydration builds the client's tree and pairs it against the server's, so the elements it makes
 * on the way are made and then dropped. That is `dom`'s bookkeeping and not this package's (a known
 * limit stated in `dom`'s README), and it is counted here so the number cannot move unnoticed.
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

// `Modal` is not here and cannot be: it drives the `<dialog>` it made, and a hydration keeps the
// server's element and drops that one, which is still open.
// `Tooltip` is here, because `Detached` mounts its anchor in place now (design 153).
const everything = (): unknown => answered(h(PopupContext as never, {}, h('div', {},
	h(DropDown as never, { label: 'Filters' }, h('p', {}, 'inside')),
	h(FileDrop as never, { extensions: ['.png'] }),
	h(Validate as never, { value: mutable(''), validate: 'email' },
		h(TextField as never, { label: 'Email' })),
	h(Tooltip as never, { label: 'This cannot be undone.' }, h('button', {}, 'Delete')),
	h(ColorPicker as never, { value: mutable('#1b6ef3') }))));

test('every composite a page can hold renders to markup and hydrates onto the server\'s nodes', async () => {
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

	// One fresh element per element on the page, this test's own `h` calls included: `hydrate`
	// takes what makes the item and runs it inside the hydration, so nothing is built at the call
	// site in a fallback document any more (design 157). Not zero: nothing in this package can
	// make it zero, which `dom`'s README states under its known limits.
	assert.equal(made.length, before.length,
		'a hydration makes the client\'s tree and keeps the server\'s: one made and dropped per element');

	const after = elements(document.body.firstChild);
	assert.equal(after.length, before.length);
	// The one thing a live page has that the markup does not is the tooltip's link to its panel,
	// which design 135 says appears on the first live mount and no static render writes. The id is
	// the one the server put on the panel, read off the markup this test is comparing against.
	const tip = byRole(document.body.firstChild, 'tooltip').getAttribute('id') ?? '';
	assert.notEqual(tip, '', 'the server gave the panel an id');
	assert.equal(toHtml(document.body.childNodes).replaceAll(` aria-describedby="${tip}"`, ''), markup,
		'and the page is the page the server sent');
	assert.equal(byRoleName(document.body.firstChild, 'button', 'Delete').getAttribute('aria-describedby'), tip,
		'the tip\'s anchor names its panel once the page is alive');
	assert.equal(document.head.childNodes.length, 1, 'the server stylesheet was adopted, not doubled');
	stop();
});

test('hydration keeps every server element of a composite page, by identity', async () => {
	const server = context();
	const markup = await render(h(everything), { context: server });
	const document = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	for (const node of parseHtml(`<style data-aweft>${server.theme.markup()}</style>`, document)) {
		document.head.appendChild(node);
	}

	const before = elements(document.body.firstChild);
	const stop = hydrate(document.body, everything);
	const after = elements(document.body.firstChild);

	// By identity, one for one. A deep comparison passes for a clone the client built and put where
	// the server's node was, which is the thing this test exists to catch. An icon's drawing is the
	// client's by design and is named as such in design 131.
	const swapped = before.filter((element, at) => after[at] !== element)
		.map((element) => element.localName)
		.filter((name) => name !== 'g' && name !== 'path');
	assert.deepEqual(swapped, [],
		'a hydration that swaps a node has replaced something it should have adopted');
	stop();
});
