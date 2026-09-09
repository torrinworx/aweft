// `Select`: the drawn list, the hidden element under it, and the map between what a person reads
// and what the caller holds (designs 224 and 130).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable, mutableArray } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import { PopupContext, Select, h, mount } from '@aweftjs/ui';

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

/** Every element under `node` carrying this ARIA role, which is what the drawn list is made of. */
const roled = (node: NodeLike | null, role: string): LightElement[] =>
	elements(node).filter((element) => element.getAttribute('role') === role);

const fire = (element: LightElement, type: string): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element });
};

const setProp = (element: LightElement, name: string, value: unknown): void => {
	(element as unknown as Record<string, unknown>)[name] = value;
};

/** What autofill or a form reset does: pick the row at this position on the hidden element. */
const choose = (picker: LightElement, at: number): void => {
	setProp(picker, 'selectedIndex', at);
	fire(picker, 'change');
};

/** The row the hidden element says is chosen. */
const selected = (node: NodeLike | null): string | null =>
	of(node, 'option').find((option) => option.getAttribute('selected') !== null)?.textContent ?? null;

/** The list is a popup, so every page here has the sink a popup needs (design 224). */
const page = (item: unknown): {
	root: NodeLike | null;
	button: LightElement;
	press(key: string): void;
	click(): void;
	stop(): void;
} => {
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext as never, {}, item));
	const root = document.body.firstChild;
	const button = of(root, 'button')[0]!;
	return {
		root,
		button,
		press: (key) => {
			(button as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({
				type: 'keydown', key, target: button, preventDefault: () => undefined,
			});
		},
		click: () => { fire(button, 'click'); },
		stop: () => { stop(); },
	};
};

test('the closed control is a combobox, and the list it names is a listbox of options', () => {
	// Design 224 reverses 130: the open list is this package's on every host, so it is on the page
	// as markup rather than being the host's own picker.
	const one = page(h(Select as never, { label: 'Size', options: ['small', 'large'] }));

	assert.equal(one.button.getAttribute('role'), 'combobox');
	assert.equal(one.button.getAttribute('aria-haspopup'), 'listbox');
	assert.equal(one.button.getAttribute('aria-expanded'), 'false');

	const list = roled(one.root, 'listbox');
	assert.equal(list.length, 1, 'one list, and it is on the page');
	assert.equal(one.button.getAttribute('aria-controls'), list[0]!.getAttribute('id'),
		'and the control names it');
	assert.deepEqual(roled(one.root, 'option').map((row) => row.textContent), ['small', 'large']);
	one.stop();
});

test('opening follows the cell both ways, and a click is one of the ways', () => {
	const open = mutable(false);
	const one = page(h(Select as never, { options: ['a', 'b'], open }));

	one.click();
	assert.equal(open.get(), true, 'a click on the control opened it');
	assert.equal(one.button.getAttribute('aria-expanded'), 'true');
	const box = roled(one.root, 'listbox')[0]!.parentNode as unknown as LightElement;
	assert.notEqual(box.style.display, 'none', 'and the box the list is in is on the screen');

	one.click();
	assert.equal(open.get(), false, 'and a second click closed it again');
	assert.equal(one.button.getAttribute('aria-expanded'), 'false');

	open.set(true);
	assert.equal(one.button.getAttribute('aria-expanded'), 'true', 'the cell drives it too');
	one.stop();
});

test('an open takes a cell, not a value', () => {
	assert.throws(
		() => page(h(Select as never, { options: ['a'], open: true })),
		/Select open takes a cell/,
	);
});

test('a key moves the active option, and the control says which one it is on', () => {
	const open = mutable(false);
	const one = page(h(Select as never, { options: ['Apple', 'Banana', 'Cherry'], open }));

	one.press('ArrowDown');
	assert.equal(open.get(), true, 'a closed list opens under the key');
	const rows = roled(one.root, 'option');
	assert.equal(one.button.getAttribute('aria-activedescendant'), rows[0]!.getAttribute('id'));

	one.press('ArrowDown');
	assert.equal(one.button.getAttribute('aria-activedescendant'), rows[1]!.getAttribute('id'));
	assert.equal(rows[1]!.getAttribute('class')?.split(' ').length ?? 0,
		rows[0]!.getAttribute('class')?.split(' ').length ?? 0,
		'the active row is a segment on the same entry, not a different element');

	// Typing finds a row by what it reads, which is what a select's keyboard has always done.
	one.press('c');
	assert.equal(one.button.getAttribute('aria-activedescendant'), rows[2]!.getAttribute('id'));
	one.stop();
});

test('Enter writes the cell with the item and closes the list', () => {
	const users = [{ id: 7, name: 'Ada' }, { id: 9, name: 'Grace' }];
	const chosen = mutable<unknown>(null);
	const open = mutable(false);
	const one = page(h(Select as never, {
		value: chosen, options: users, display: (user: { name: string }) => user.name, open,
	}));

	one.press('ArrowDown');
	one.press('ArrowDown');
	one.press('Enter');
	assert.equal(chosen.get(), users[1], 'the item the caller put in the list, not its text');
	assert.equal(open.get(), false, 'and picking closed it');
	assert.equal(one.button.getAttribute('aria-activedescendant'), null);
	one.stop();
});

test('Escape closes the list and leaves it closed', () => {
	const open = mutable(false);
	const one = page(h(Select as never, { options: ['a', 'b'], open }));
	one.click();
	one.press('Escape');
	assert.equal(open.get(), false);
	one.stop();
});

test('the chosen row says it is chosen, and the control shows what it reads as', () => {
	const chosen = mutable<unknown>('large');
	const one = page(h(Select as never, {
		value: chosen, options: ['small', 'large'], display: ['Small', 'Large'],
	}));

	assert.equal(one.button.textContent, 'Large', 'the control shows the text, not the item');
	assert.deepEqual(roled(one.root, 'option').map((row) => row.getAttribute('aria-selected')),
		['false', 'true']);

	chosen.set('small');
	assert.equal(one.button.textContent, 'Small');
	assert.deepEqual(roled(one.root, 'option').map((row) => row.getAttribute('aria-selected')),
		['true', 'false']);
	one.stop();
});

test('a hidden select carries the options and the choice, so a form posts something', () => {
	const chosen = mutable<unknown>('b');
	const one = page(h(Select as never, {
		value: chosen, options: ['a', 'b'], name: 'size', autocomplete: 'off',
	}));

	const native = of(one.root, 'select');
	assert.equal(native.length, 1, 'one hidden element, and it is a real select');
	assert.equal(native[0]!.getAttribute('name'), 'size', 'named, which is what a form posts by');
	assert.equal(native[0]!.getAttribute('autocomplete'), 'off');
	assert.equal(native[0]!.getAttribute('aria-hidden'), 'true', 'the button is what is read out');
	assert.equal(native[0]!.getAttribute('tabindex'), '-1', 'and it is not a second tab stop');
	assert.deepEqual(of(one.root, 'option').map((option) => option.getAttribute('value')), ['a', 'b']);
	assert.equal(selected(one.root), 'b');
	one.stop();
});

test('a change on the hidden element writes the cell, which is the autofill path', () => {
	const chosen = mutable<unknown>(null);
	const one = page(h(Select as never, { value: chosen, options: ['a', 'b'] }));
	choose(of(one.root, 'select')[0]!, 1);
	assert.equal(chosen.get(), 'b', 'whatever filled the element in, the cell followed');
	one.stop();
});

test('an object list comes back as the object, never as the string the element carries', () => {
	const users = [{ id: 7, name: 'Ada' }, { id: 9, name: 'Grace' }];
	const chosen = mutable<unknown>(null);
	const one = page(h(Select as never, {
		value: chosen, options: users, display: (user: { name: string }) => user.name,
	}));

	const options = of(one.root, 'option');
	assert.deepEqual(options.map((option) => option.textContent), ['Ada', 'Grace'],
		'display says what the person reads');
	assert.deepEqual(options.map((option) => option.getAttribute('value')), [null, null],
		'an object has no text of its own to carry, and the choice does not go through the value');

	choose(of(one.root, 'select')[0]!, 1);
	assert.equal(chosen.get(), users[1], 'the cell holds the object the caller put in the list');
	one.stop();
});

test('two options that read the same are still two items', () => {
	const rows = [{ id: 1, name: 'Ada' }, { id: 2, name: 'Ada' }];
	const chosen = mutable<unknown>(null);
	const open = mutable(false);
	const one = page(h(Select as never, {
		value: chosen, options: rows, display: (row: { name: string }) => row.name, open,
	}));

	one.press('ArrowDown');
	one.press('ArrowDown');
	one.press('Enter');
	assert.equal(chosen.get(), rows[1]);
	assert.notEqual(chosen.get(), rows[0], 'the second Ada is not the first one');
	one.stop();
});

test('display may be a parallel list, read by position', () => {
	const chosen = mutable<unknown>(null);
	const one = page(h(Select as never, {
		value: chosen, options: ['sm', 'lg'], display: ['Small', 'Large'],
	}));
	assert.deepEqual(roled(one.root, 'option').map((row) => row.textContent), ['Small', 'Large']);
	assert.deepEqual(of(one.root, 'option').map((option) => option.getAttribute('value')), ['sm', 'lg'],
		'what it reads as does not change what it is');
	one.stop();
});

test('with no display an item reads as itself', () => {
	const one = page(h(Select as never, { options: [1, 2] }));
	assert.deepEqual(roled(one.root, 'option').map((row) => row.textContent), ['1', '2']);
	one.stop();
});

test('a placeholder shows while the cell holds nothing and is not a row in the list', () => {
	const chosen = mutable<unknown>(null);
	const one = page(h(Select as never, {
		value: chosen, options: ['a', 'b'], placeholder: 'Pick one',
	}));

	assert.equal(one.button.textContent, 'Pick one', 'the control shows it');
	assert.deepEqual(roled(one.root, 'option').map((row) => row.textContent), ['a', 'b'],
		'and it is not a row anybody can land on');

	const blank = of(one.root, 'option')[0]!;
	assert.equal(blank.getAttribute('value'), '');
	assert.equal(blank.getAttribute('disabled'), '', 'so a form cannot post it back');
	assert.equal(selected(one.root), 'Pick one', 'the hidden element sits on the blank row');

	chosen.set('b');
	assert.equal(one.button.textContent, 'b', 'and a choice moves off it');
	assert.equal(selected(one.root), 'b');
	one.stop();
});

test('with no placeholder there is no blank option', () => {
	const one = page(h(Select as never, { options: ['a'] }));
	assert.equal(of(one.root, 'option').length, 1);
	one.stop();
});

test('the cell writes the element', () => {
	const chosen = mutable<unknown>('a');
	const one = page(h(Select as never, { value: chosen, options: ['a', 'b'] }));
	assert.equal(selected(one.root), 'a');
	chosen.set('b');
	assert.equal(selected(one.root), 'b');
	one.stop();
});

test('an option added in front of the choice leaves the choice where it was', () => {
	const ada = { name: 'Ada' };
	const grace = { name: 'Grace' };
	const zoe = { name: 'Zoe' };
	const options = mutableArray<unknown>([ada, grace]);
	const chosen = mutable<unknown>(null);
	const one = page(h(Select as never, {
		value: chosen, options, display: (row: { name: string }) => row.name,
	}));

	options.unshift(zoe);
	const rows = of(one.root, 'option');
	assert.deepEqual(rows.map((option) => option.textContent), ['Zoe', 'Ada', 'Grace']);

	choose(of(one.root, 'select')[0]!, rows.findIndex((option) => option.textContent === 'Ada'));
	assert.equal(chosen.get(), ada, 'the row that reads Ada is Ada, however the list moved');
	assert.equal(selected(one.root), 'Ada');
	one.stop();
});

test('an item that is the empty string is not the placeholder', () => {
	const chosen = mutable<unknown>(null);
	const one = page(h(Select as never, {
		value: chosen, options: ['', 'b'], placeholder: 'Pick one',
	}));
	assert.equal(selected(one.root), 'Pick one');

	choose(of(one.root, 'select')[0]!, 1);
	assert.equal(chosen.get(), '', 'the item, not the placeholder the caller cannot choose');
	assert.deepEqual(of(one.root, 'option').map((option) => option.getAttribute('selected')),
		[null, '', null]);
	one.stop();
});

test('a cell holding something the list does not have selects nothing', () => {
	const chosen = mutable<unknown>('gone');
	const one = page(h(Select as never, { value: chosen, options: ['a', 'b'] }));
	assert.equal(selected(one.root), null, 'no row claims to be a choice nobody can see');
	chosen.set('b');
	assert.equal(selected(one.root), 'b');
	one.stop();
});

test('a cell holding something the list does not have reads as the placeholder', () => {
	// The rest of the control already says nothing is chosen: no row is selected and the hidden
	// element sits on its blank option. A button reading a value no row can unpick disagrees with
	// both of them, and it is a control nobody can put right by using it.
	const chosen = mutable<unknown>('zzz');
	const one = page(h(Select as never, {
		value: chosen, options: ['a', 'b'], placeholder: 'Pick',
	}));
	assert.equal(one.button.textContent, 'Pick');

	chosen.set('a');
	assert.equal(one.button.textContent, 'a', 'and an item the list does have still reads as itself');
	one.stop();
});

test('an item the list gains later is read once it is there', () => {
	// The text follows the options as well as the cell, which is the other half of the rule above: a
	// cell set before its list arrived reads as the placeholder until the row exists.
	const chosen = mutable<unknown>('b');
	const options = mutable<unknown>(['a']);
	const one = page(h(Select as never, { value: chosen, options, placeholder: 'Pick' }));
	assert.equal(one.button.textContent, 'Pick');

	options.set(['a', 'b']);
	assert.equal(one.button.textContent, 'b');
	one.stop();
});

test('adding an option adds one option and moves nothing else', () => {
	// Design 130's rule, on the hidden element, which is where the `each` mount still is. The drawn
	// rows are mapped instead, because each of them carries an id (design 224).
	const options = mutableArray<string>(['a', 'b']);
	const one = page(h(Select as never, { options }));
	const before = of(one.root, 'option');
	assert.equal(before.length, 2);

	options.push('c');
	const after = of(one.root, 'option');
	assert.equal(after.length, 3);
	assert.equal(after[0], before[0], 'the rows that were there are the rows that were there');
	assert.equal(after[1], before[1]);
	assert.equal(after[2]!.textContent, 'c');
	one.stop();
});

test('an options cell replaces the list, in the markup and in the drawing', () => {
	const options = mutable<unknown>(['a', 'b']);
	const one = page(h(Select as never, { options }));
	assert.equal(of(one.root, 'option').length, 2);
	options.set(['x', 'y', 'z']);
	assert.deepEqual(of(one.root, 'option').map((option) => option.textContent), ['x', 'y', 'z']);
	assert.deepEqual(roled(one.root, 'option').map((row) => row.textContent), ['x', 'y', 'z']);
	one.stop();
});

test('the closed control is a button, its arrow, and the element a form reads', () => {
	// Design 224. The wrapper and the drawn arrow of design 195 are unchanged; what was the
	// `<select>` a person clicks is now a `<button role="combobox">` with the element behind it.
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext as never, {}, h(Select as never, { options: ['a'] })));
	const wrap = of(document.body.firstChild, 'span')[0]!;
	assert.equal(wrap.localName, 'span', 'one wrapper, and it is not a block that breaks a row');
	assert.match(
		toHtml([wrap as unknown as NodeLike]),
		/^<span [^>]*><button [^>]*type="button"[^>]*><\/button><span aria-hidden="true"[^>]*><\/span><select [^>]*><option value="a">a<\/option><\/select><\/span>$/,
		'the control, the arrow, and the hidden element, in that order',
	);
	stop();
});

test('a select renders with no Icons above it, and the arrow is a part of the theme', () => {
	// The arrow is drawn out of two borders rather than asked for by name (design 195, amended), so
	// `Select` is not a control that needs a pack: this page has none and mounts anyway.
	const one = page(h(Select as never, { options: ['a'] }));
	const arrow = of(one.root, 'span').find((element) => element.getAttribute('aria-hidden') === 'true');
	assert.ok(arrow !== undefined, 'the arrow is on the page');
	assert.equal(arrow.firstChild, null, 'and it is an empty box, not a drawing');
	assert.equal(of(one.root, 'svg').length, 0, 'no icon was asked for');
	one.stop();
});
