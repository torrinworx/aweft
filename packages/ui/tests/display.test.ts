// The display and grouping pieces, in the light tree (designs 199, 200, 211, 212, 215): what each
// one renders, what a screen reader would call it, and which entry it lands on.
//
// What only a browser can answer, which is the ring on a real Tab and an image that really loads,
// is `browser.test.ts`. What the catalogue page answers is `recipes/ui/main.ts`. Every expected
// value here is written from the two records, not taken from a run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import { Alert, Avatar, Badge, Button, Card, Empty, Progress, Skeleton, context, h, mount } from '@aweftjs/ui';
import type { Render } from '@aweftjs/ui';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

/** The element children of one node, which is what says which parts a component rendered. */
const childrenOf = (element: LightElement): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = (element as unknown as NodeLike).firstChild; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
	}
	return found;
};

/** Mount into a render of this test's own, so the stylesheet holds only what this page asked for. */
const page = (item: unknown): { render: Render; root: LightElement; stop: () => void } => {
	const render = context();
	const document = createDocument();
	const stop = mount(document.body, item, undefined, render);
	return {
		render,
		root: document.body.firstChild as unknown as LightElement,
		stop: () => { stop(); },
	};
};

/** The rules this element's generated class was given, which is what says its entry landed. */
const rulesOn = (render: Render, element: LightElement): string => {
	const name = element.getAttribute('class') ?? '';
	assert.notEqual(name, '', 'the element was given a generated class');
	const wanted = new RegExp(`\\.${name}\\b`);
	return render.theme.markup().split('\n').filter((line) => wanted.test(line)).join('\n');
};

/** What a role holds in the theme this package ships, so an expectation names a role. */
const sheet = context().theme;
const roleOf = (name: string): string => {
	const held = sheet.variable(sheet.base(), [], name);
	assert.ok(held !== null, `the theme defines $${name}`);
	return held;
};

const byTag = (root: NodeLike | null, tag: string): LightElement => {
	const found = elements(root).find((element) => element.localName === tag);
	assert.ok(found !== undefined, `no <${tag}> on the page`);
	return found;
};

/** Deliver one event the way the host would, with the element as its target. */
const fire = (element: LightElement, type: string): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element });
};

// --- Badge ---------------------------------------------------------------------------------

test('a badge is a span on its own fill, and its icon comes before its label', () => {
	const { render, root, stop } = page(
		h(Badge as never, { label: 'New', icon: h('svg', {}) }));

	assert.equal(root.localName, 'span');
	assert.equal(root.getAttribute('role'), null, 'a badge is not a control and claims no role');
	const rules = rulesOn(render, root);
	assert.match(rules, /display: inline-flex/);
	assert.match(rules, /font-size: 0\.75rem/, '$textXs');
	assert.match(rules, /font-weight: 500/);
	// The icon is the first child and the label the text after it, which is the reading order.
	assert.equal(childrenOf(root)[0]?.localName, 'svg');
	assert.equal(root.textContent, 'New');
	stop();
});

test('each badge type resolves its own pair of roles, and outline has no fill', () => {
	const filled = page(h(Badge as never, { label: 'a' }));
	assert.match(rulesOn(filled.render, filled.root), new RegExp(`background: ${roleOf('accent')}`), 'the accent fill');
	filled.stop();

	const quiet = page(h(Badge as never, { label: 'a', type: 'quiet' }));
	const quietRules = rulesOn(quiet.render, quiet.root);
	assert.match(quietRules, new RegExp(`background: ${roleOf('muted')}`), '$muted');
	assert.match(quietRules, new RegExp(`color: ${roleOf('mutedForeground')}`), '$mutedForeground');
	quiet.stop();

	const danger = page(h(Badge as never, { label: 'a', type: 'danger' }));
	assert.match(rulesOn(danger.render, danger.root), new RegExp(`background: ${roleOf('danger')}`), '$danger');
	danger.stop();

	const good = page(h(Badge as never, { label: 'a', type: 'success' }));
	assert.match(rulesOn(good.render, good.root), new RegExp(`background: ${roleOf('success')}`), '$success');
	good.stop();

	const outline = page(h(Badge as never, { label: 'a', type: 'outline' }));
	const outlineRules = rulesOn(outline.render, outline.root);
	assert.match(outlineRules, /background: transparent/);
	assert.match(outlineRules, new RegExp(`border-color: ${roleOf('border')}`), '$border');
	outline.stop();
});

// --- Alert ---------------------------------------------------------------------------------

test('an alert is a status, and a danger alert interrupts', () => {
	const quiet = page(h(Alert as never, { title: 'Saved' }, 'It went through.'));
	assert.equal(quiet.root.localName, 'div');
	assert.equal(quiet.root.getAttribute('role'), 'status',
		'a message that does not matter waits its turn');
	quiet.stop();

	const bad = page(h(Alert as never, { type: 'danger', title: 'Nothing was saved' }));
	assert.equal(bad.root.getAttribute('role'), 'alert', 'and one that does interrupts');
	assert.match(rulesOn(bad.render, bad.root), new RegExp(`background: ${roleOf('dangerSubtle')}`), '$dangerSubtle');
	bad.stop();

	// A thing that went right waits its turn too, so `success` keeps the status role (design 216).
	const good = page(h(Alert as never, { type: 'success', title: 'Saved' }));
	assert.equal(good.root.getAttribute('role'), 'status');
	assert.match(rulesOn(good.render, good.root), new RegExp(`background: ${roleOf('successSubtle')}`), '$successSubtle');
	good.stop();
});

test('an alert grows its icon column only when it was given an icon', () => {
	const bare = page(h(Alert as never, { title: 'Saved' }, 'body'));
	assert.match(rulesOn(bare.render, bare.root), /grid-template-columns: 1fr/,
		'one column, so nothing is indented past a gap beside an empty track');
	assert.deepEqual(childrenOf(bare.root).map((node) => node.localName), ['span', 'div'],
		'the title and the body, and no icon cell');
	bare.stop();

	const led = page(h(Alert as never, { title: 'Saved', icon: h('svg', {}) }, 'body'));
	assert.match(rulesOn(led.render, led.root), /grid-template-columns: auto 1fr/);
	const parts = childrenOf(led.root);
	assert.deepEqual(parts.map((node) => node.localName), ['span', 'span', 'div'],
		'the icon cell, the title and the body');
	// The cell spans both rows, so the title and the body place themselves in the second column
	// rather than wrapping under it.
	assert.match(rulesOn(led.render, parts[0]!), /grid-row: 1 \/ span 2/);
	led.stop();
});

// --- Avatar --------------------------------------------------------------------------------

test('an avatar shows its letters until the picture loads, and again when it fails', () => {
	const { root, stop } = page(
		h(Avatar as never, { src: '/me.png', alt: 'Me', fallback: 'TL' }));

	const image = byTag(root.firstChild, 'img');
	assert.deepEqual(childrenOf(root).map((node) => node.localName), ['img', 'span']);
	const fallback = childrenOf(root)[1]!;
	assert.equal(image.getAttribute('hidden'), 'true', 'the picture is not there yet');
	assert.equal(fallback.getAttribute('hidden'), null, 'so the letters are');
	assert.equal(fallback.textContent, 'TL');

	fire(image, 'load');
	assert.equal(image.getAttribute('hidden'), null, 'the picture arrived');
	assert.equal(fallback.getAttribute('hidden'), 'true', 'and the letters went');

	fire(image, 'error');
	assert.equal(image.getAttribute('hidden'), 'true', 'a picture that fails after it loaded');
	assert.equal(fallback.getAttribute('hidden'), null, 'brings the letters back');
	stop();
});

test('an avatar with no src renders no image at all, and takes the size axis', () => {
	const bare = page(h(Avatar as never, { fallback: 'AB' }));
	assert.deepEqual(childrenOf(bare.root).map((node) => node.localName), ['span'],
		'no image element at all until there is somewhere to load one from');
	assert.equal(bare.root.textContent, 'AB');
	assert.match(rulesOn(bare.render, bare.root), /border-radius: 50%/, 'round unless it is set false');
	bare.stop();

	const square = page(h(Avatar as never, { fallback: 'AB', round: false, size: 'sm' }));
	const rules = rulesOn(square.render, square.root);
	assert.match(rules, /width: 32px; height: 32px/, '$controlSm');
	assert.doesNotMatch(rules, /border-radius: 50%/);
	assert.equal(square.root.getAttribute('style'), null, 'a step name is a segment and nothing else');
	square.stop();
});

test('an avatar sized by a cell src has its image from the first paint', () => {
	// Design 215, correcting design 199's sentence: a cell that has not resolved yet is not the
	// same as no picture, so the image is built and its `src` follows the cell.
	const photo = mutable<unknown>(null);
	const { root, stop } = page(h(Avatar as never, { src: photo, fallback: 'AB' }));
	assert.deepEqual(childrenOf(root).map((node) => node.localName), ['img', 'span']);
	photo.set('/me.png');
	assert.equal(byTag(root.firstChild, 'img').getAttribute('src'), '/me.png');
	stop();
});

test('an avatar size that is a length goes into the style, not into a segment', () => {
	const length = page(h(Avatar as never, { fallback: 'AB', size: '120px' }));
	const style = length.root.getAttribute('style') ?? '';
	assert.match(style, /width: 120px/);
	assert.match(style, /height: 120px/);
	assert.match(rulesOn(length.render, length.root), /width: 36px; height: 36px/,
		'the entry still says $control, and the inline style is what beats it');
	length.stop();

	// A cell may hold either kind, and both halves follow it.
	const size = mutable<unknown>('sm');
	const moving = page(h(Avatar as never, { fallback: 'AB', size }));
	assert.equal(moving.root.getAttribute('style'), null, 'a step writes no style');
	assert.match(rulesOn(moving.render, moving.root), /width: 32px/, '$controlSm');
	size.set('96px');
	assert.match(moving.root.getAttribute('style') ?? '', /width: 96px/, 'and a length writes one');
	moving.stop();
});

// --- Skeleton ------------------------------------------------------------------------------

test('a skeleton says nothing to a screen reader, and takes its size from style', () => {
	const { render, root, stop } = page(h(Skeleton as never, { width: 120, height: '2rem' }));
	assert.equal(root.localName, 'div');
	assert.equal(root.getAttribute('aria-hidden'), 'true');
	assert.equal(root.getAttribute('role'), null, 'and claims no role either');
	const style = root.getAttribute('style') ?? '';
	assert.match(style, /width: 120px/, 'a bare number in a size property is pixels');
	assert.match(style, /height: 2rem/);
	assert.match(rulesOn(render, root), new RegExp(`background: ${roleOf('muted')}`), '$muted');
	stop();
});

// --- Progress ------------------------------------------------------------------------------

test('a progress is a fraction of one, and a value cell moves it', () => {
	const done = mutable(0.25);
	const { root, stop } = page(h(Progress as never, { value: done, label: 'Uploading' }));

	assert.equal(root.localName, 'progress');
	assert.equal(root.getAttribute('max'), '1', 'so the cell is a fraction and nothing divides');
	assert.equal(root.getAttribute('aria-label'), 'Uploading');
	assert.equal(root.getAttribute('value'), '0.25');

	done.set(0.5);
	assert.equal(root.getAttribute('value'), '0.5', 'the cell wrote the element');
	stop();
});

test('a progress with no value is indeterminate, which is the attribute being absent', () => {
	const done = mutable<number | null>(null);
	const { render, root, stop } = page(h(Progress as never, { value: done, size: 'lg' }));
	assert.equal(root.getAttribute('value'), null,
		'the platform reads a progress with no value attribute as indeterminate');

	done.set(1);
	assert.equal(root.getAttribute('value'), '1');
	done.set(null);
	assert.equal(root.getAttribute('value'), null, 'and it goes back when the cell clears');

	assert.match(rulesOn(render, root), /height: 12px/, '$space3 at the large size');
	stop();
});

test('a value outside 0 to 1 is clamped, and anything that is not a number is indeterminate', () => {
	// The attribute is what the element reads, so what goes in it has to be a fraction of one. A
	// host draws a bar past its own track for 1.5 and draws nothing at all for `lots`.
	const done = mutable<unknown>(1.5);
	const { root, stop } = page(h(Progress as never, { value: done, label: 'Uploading' }));
	assert.equal(root.getAttribute('value'), '1', 'past the end is the end');

	done.set(-0.2);
	assert.equal(root.getAttribute('value'), '0', 'and before the start is the start');

	for (const held of [Number.NaN, 'lots', true, {}]) {
		done.set(held);
		assert.equal(root.getAttribute('value'), null,
			`${String(held)} is not a finite number, so it is indeterminate`);
	}

	done.set(0.4);
	assert.equal(root.getAttribute('value'), '0.4', 'and a real fraction comes back');
	stop();
});

test('a progress given an element that is not a progress is refused', () => {
	const document = createDocument();
	const span = document.createElement('span');
	assert.throws(
		() => { mount(document.body, h(Progress as never, { element: span, value: 0.5 })); },
		/element must be <progress> and this one is <span>/,
		'decorating a span with the progress entry draws a bar the platform never fills');
});

// --- Empty ---------------------------------------------------------------------------------

test('an empty state renders only the parts it was given', () => {
	const full = page(h(Empty as never, {
		icon: h('svg', {}), title: 'No messages', description: 'They will show up here.',
	}, h(Button as never, { label: 'Refresh' })));

	const parts = childrenOf(full.root);
	assert.deepEqual(parts.map((node) => node.localName), ['span', 'p', 'p', 'div'],
		'the symbol, the title, the description and the actions');
	assert.match(rulesOn(full.render, parts[2]!), new RegExp(`color: ${roleOf('mutedForeground')}`), 'the description is $mutedForeground');
	full.stop();

	const bare = page(h(Empty as never, { title: 'No messages' }));
	assert.deepEqual(childrenOf(bare.root).map((node) => node.localName), ['p'],
		'and nothing it was not given');
	bare.stop();
});

// --- Card ------------------------------------------------------------------------------------

test('a card with parts is a stack, and one with none is the bare block', () => {
	const card = page(h(Card as never, {
		title: 'Today', description: 'What is due', foot: h(Button as never, { label: 'Add' }),
	}, h('p', {}, 'nothing yet')));

	const rules = rulesOn(card.render, card.root);
	assert.match(rules, /border-radius: 10px/, '$radiusLg, the card entry');
	assert.match(rules, /flex-direction: column/, 'and the stack modifier');
	assert.match(rules, /gap: 16px/, '$space4 between the head, the body and the foot');

	assert.deepEqual(childrenOf(card.root).map((node) => node.localName), ['div', 'div', 'div'],
		'the head, the body and the foot');
	assert.deepEqual(childrenOf(childrenOf(card.root)[0]!).map((node) => node.localName), ['p', 'p'],
		'and the head holds the title and the description');
	assert.equal(card.root.textContent, 'TodayWhat is duenothing yetAdd');
	card.stop();

	// Design 211: no title, no description and no foot is the bare block it always was. The
	// children are the card's own children, with no body wrapper and no column between them.
	const bare = page(h(Card as never, {}, h('p', {}, 'x'), h('p', {}, 'y')));
	const plain = rulesOn(bare.render, bare.root);
	assert.match(plain, /border-radius: 10px/, 'the same entry');
	assert.doesNotMatch(plain, /flex-direction: column/, 'and none of the stack modifier');
	assert.deepEqual(childrenOf(bare.root).map((node) => node.localName), ['p', 'p'],
		'the children are the card\'s own children');
	bare.stop();
});

test('a foot on its own is enough to make the parts', () => {
	const { root, stop } = page(h(Card as never, {
		foot: h(Button as never, { label: 'Add' }),
	}, h('p', {}, 'x')));
	assert.deepEqual(childrenOf(root).map((node) => node.getAttribute('theme') ?? node.localName),
		['div', 'div'], 'the body and the foot, with no head');
	assert.equal(root.textContent, 'xAdd');
	stop();
});

test('tight is read as a cell, on a card with parts and on one without', () => {
	// Every other look prop here follows a cell. A cell handed straight to `?:` is an object, and
	// an object is truthy, so a card told `tight={cell}` was tight whatever the cell held.
	const dense = mutable<unknown>(false);
	const card = page(h(Card as never, { title: 'Today', tight: dense }));
	const bare = page(h(Card as never, { tight: dense }, h('p', {}, 'x')));

	// The tight modifier is a second rule on the same class, so what says it landed is its own
	// declaration and not the absence of the entry's.
	const dropped = /padding: 0px/;
	assert.match(rulesOn(card.render, card.root), /padding: 16px/, '$space4, the card entry');
	assert.doesNotMatch(rulesOn(card.render, card.root), dropped, 'a false cell is not tight');
	assert.doesNotMatch(rulesOn(bare.render, bare.root), dropped);

	dense.set(true);
	assert.match(rulesOn(card.render, card.root), dropped, 'and the cell takes the padding away');
	assert.match(rulesOn(bare.render, bare.root), dropped);
	card.stop();
	bare.stop();
});

test('a card head holds only the parts it was given', () => {
	const { root, stop } = page(h(Card as never, { title: 'Today' }));
	const head = childrenOf(root)[0]!;
	assert.deepEqual(childrenOf(head).map((node) => node.localName), ['p'],
		'a card with no description renders no line for one');
	assert.equal(head.textContent, 'Today');
	stop();
});
