// `Select` and the map between what the element carries and what the caller holds (design 130).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable, mutableArray } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import { Select, h, mount } from '@aweftjs/ui';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

const of = (node: NodeLike | null, tag: string): LightElement[] =>
	elements(node).filter((element) => element.localName === tag);

const fire = (element: LightElement, type: string): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element });
};

const setProp = (element: LightElement, name: string, value: unknown): void => {
	(element as unknown as Record<string, unknown>)[name] = value;
};

/** What the person does: pick the row at this position and let the element say so. */
const choose = (picker: LightElement, at: number): void => {
	setProp(picker, 'selectedIndex', at);
	fire(picker, 'change');
};

/** The row the element says is chosen. */
const selected = (node: NodeLike | null): string | null =>
	of(node, 'option').find((option) => option.getAttribute('selected') !== null)?.textContent ?? null;

const page = (item: unknown): { root: NodeLike | null; stop: () => void } => {
	const document = createDocument();
	const stop = mount(document.body, item);
	return { root: document.body.firstChild, stop: () => { stop(); } };
};

test('a list of strings is its own value', () => {
	const size = mutable<unknown>('small');
	const { root, stop } = page(h(Select as never, { value: size, options: ['small', 'large'] }));

	const options = of(root, 'option');
	assert.deepEqual(options.map((option) => option.getAttribute('value')), ['small', 'large'],
		'so a form the select is in posts something a reader recognises');
	assert.deepEqual(options.map((option) => option.textContent), ['small', 'large']);

	const picker = of(root, 'select')[0]!;
	choose(picker, 1);
	assert.equal(size.get(), 'large');
	stop();
});

test('an object list comes back as the object, never as the string the element carries', () => {
	const users = [{ id: 7, name: 'Ada' }, { id: 9, name: 'Grace' }];
	const chosen = mutable<unknown>(null);
	const { root, stop } = page(h(Select as never, {
		value: chosen, options: users, display: (user: { name: string }) => user.name,
	}));

	const options = of(root, 'option');
	assert.deepEqual(options.map((option) => option.textContent), ['Ada', 'Grace'],
		'display says what the person reads');
	assert.deepEqual(options.map((option) => option.getAttribute('value')), [null, null],
		'an object has no text of its own to carry, and the choice does not go through the value');

	const picker = of(root, 'select')[0]!;
	choose(picker, 1);
	assert.equal(chosen.get(), users[1], 'the cell holds the object the caller put in the list');
	stop();
});

test('two options that read the same are still two items', () => {
	const rows = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Ada' }];
	const chosen = mutable<unknown>(null);
	const { root, stop } = page(h(Select as never, {
		value: chosen, options: rows, display: (row: { name: string }) => row.name,
	}));

	const picker = of(root, 'select')[0]!;
	choose(picker, 1);
	assert.equal(chosen.get(), rows[1]);
	assert.notEqual(chosen.get(), rows[0], 'the second Ada is not the first one');
	stop();
});

test('display may be a parallel list, read by position', () => {
	const chosen = mutable<unknown>(null);
	const { root, stop } = page(h(Select as never, {
		value: chosen, options: ['sm', 'lg'], display: ['Small', 'Large'],
	}));
	assert.deepEqual(of(root, 'option').map((option) => option.textContent), ['Small', 'Large']);
	assert.deepEqual(of(root, 'option').map((option) => option.getAttribute('value')), ['sm', 'lg'],
		'what it reads as does not change what it is');
	stop();
});

test('with no display an item reads as itself', () => {
	const { root, stop } = page(h(Select as never, { options: [1, 2] }));
	assert.deepEqual(of(root, 'option').map((option) => option.textContent), ['1', '2']);
	stop();
});

test('a placeholder shows while the cell holds nothing and cannot be chosen back', () => {
	const chosen = mutable<unknown>(null);
	const { root, stop } = page(h(Select as never, {
		value: chosen, options: ['a', 'b'], placeholder: 'Pick one',
	}));

	const blank = of(root, 'option')[0]!;
	assert.equal(blank.textContent, 'Pick one');
	assert.equal(blank.getAttribute('value'), '');
	assert.equal(blank.getAttribute('disabled'), '', 'so it cannot be chosen back');
	assert.equal(blank.getAttribute('hidden'), '', 'and it is not in the open list');
	assert.equal(selected(root), 'Pick one', 'an unset cell selects the placeholder');

	chosen.set('b');
	assert.equal(selected(root), 'b', 'and a choice moves off it');
	stop();
});

test('with no placeholder there is no blank option', () => {
	const { root, stop } = page(h(Select as never, { options: ['a'] }));
	assert.equal(of(root, 'option').length, 1);
	stop();
});

test('the cell writes the element', () => {
	const chosen = mutable<unknown>('a');
	const { root, stop } = page(h(Select as never, { value: chosen, options: ['a', 'b'] }));
	assert.equal(selected(root), 'a');
	chosen.set('b');
	assert.equal(selected(root), 'b');
	stop();
});

test('an option added in front of the choice leaves the choice where it was', () => {
	const ada = { name: 'Ada' };
	const grace = { name: 'Grace' };
	const zoe = { name: 'Zoe' };
	const options = mutableArray<unknown>([ada, grace]);
	const chosen = mutable<unknown>(null);
	const { root, stop } = page(h(Select as never, {
		value: chosen, options, display: (row: { name: string }) => row.name,
	}));

	options.unshift(zoe);
	const rows = of(root, 'option');
	assert.deepEqual(rows.map((option) => option.textContent), ['Zoe', 'Ada', 'Grace']);

	choose(of(root, 'select')[0]!, rows.findIndex((option) => option.textContent === 'Ada'));
	assert.equal(chosen.get(), ada, 'the row that reads Ada is Ada, however the list moved');
	assert.equal(selected(root), 'Ada');
	stop();
});

test('an item that is the empty string is not the placeholder', () => {
	const chosen = mutable<unknown>(null);
	const { root, stop } = page(h(Select as never, {
		value: chosen, options: ['', 'b'], placeholder: 'Pick one',
	}));
	assert.equal(selected(root), 'Pick one');

	choose(of(root, 'select')[0]!, 1);
	assert.equal(chosen.get(), '', 'the item, not the placeholder the caller cannot choose');
	assert.deepEqual(of(root, 'option').map((option) => option.getAttribute('selected')), [null, '', null]);
	stop();
});

test('a cell holding something the list does not have selects nothing', () => {
	const chosen = mutable<unknown>('gone');
	const { root, stop } = page(h(Select as never, { value: chosen, options: ['a', 'b'] }));
	assert.equal(selected(root), null, 'no row claims to be a choice nobody can see');
	chosen.set('b');
	assert.equal(selected(root), 'b');
	stop();
});

test('adding an option adds one option and moves nothing else', () => {
	const options = mutableArray<string>(['a', 'b']);
	const { root, stop } = page(h(Select as never, { options }));
	const before = of(root, 'option');
	assert.equal(before.length, 2);

	options.push('c');
	const after = of(root, 'option');
	assert.equal(after.length, 3);
	assert.equal(after[0], before[0], 'the rows that were there are the rows that were there');
	assert.equal(after[1], before[1]);
	assert.equal(after[2]!.textContent, 'c');
	stop();
});

test('an options cell replaces the list', () => {
	const options = mutable<unknown>(['a', 'b']);
	const { root, stop } = page(h(Select as never, { options }));
	assert.equal(of(root, 'option').length, 2);
	options.set(['x', 'y', 'z']);
	assert.deepEqual(of(root, 'option').map((option) => option.textContent), ['x', 'y', 'z']);
	stop();
});

test('a select is a select, its arrow, and nothing else', () => {
	// Design 130 said a select was the element alone. Design 195 puts one box around it, holding
	// the element and an empty span the theme draws the arrow on. There is still no button and no
	// drawn list: the element is the combobox and the whole keyboard map is the platform's.
	const document = createDocument();
	const stop = mount(document.body, h(Select as never, { options: ['a'] }));
	assert.match(
		toHtml(document.body.childNodes),
		/^<span [^>]*><select [^>]*><option value="a"[^>]*>a<\/option><\/select><span aria-hidden="true"[^>]*><\/span><\/span>$/,
		'the wrapper holds the element and the arrow, and nothing else',
	);
	stop();
});

test('a select renders with no Icons above it, and the arrow is a part of the theme', () => {
	// The arrow is drawn out of two borders rather than asked for by name (design 195, amended), so
	// `Select` is not a control that needs a pack: this page has none and mounts anyway.
	const document = createDocument();
	const stop = mount(document.body, h(Select as never, { options: ['a'] }));
	const arrow = of(document.body.firstChild, 'span')
		.find((element) => element.getAttribute('aria-hidden') === 'true');
	assert.ok(arrow !== undefined, 'the arrow is on the page');
	assert.equal(arrow.firstChild, null, 'and it is an empty box, not a drawing');
	assert.equal(of(document.body.firstChild, 'svg').length, 0, 'no icon was asked for');
	stop();
});
