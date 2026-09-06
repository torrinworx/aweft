// Marks, categories, and the two components built on them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument, toHtml } from '@aweftjs/dom';
import { Shown, Switch, categories, h, mark, mount } from '@aweftjs/ui';

test('a mark is a value, not a node, and carries everything written on it', () => {
	const one = mark('popup', { align: 'end' }, 'inside');
	assert.equal(one.name, 'popup');
	assert.deepEqual(one.props, { align: 'end', children: ['inside'] });

	// The same thing written as a tag, which is what `<mark.popup>` compiles to.
	const two = h(mark.popup, { align: 'end' }, 'inside') as typeof one;
	assert.deepEqual(two.props, one.props);
	assert.equal(two.name, 'popup');
});

test('categories splits children into slots and merges each slot\'s props', () => {
	const [popup, anchor] = categories(
		[h(mark.popup, { align: 'end' }, 'menu'), 'the button', h(mark.popup, { width: 4 }, 'more')],
		['popup', 'anchor'],
		'anchor',
	);
	assert.deepEqual(popup!.items, ['menu', 'more']);
	assert.deepEqual(popup!.props, { align: 'end', width: 4 });
	assert.deepEqual(anchor!.items, ['the button']);
});

test('an unknown slot and a homeless child are both refused, naming the slots', () => {
	assert.throws(
		() => categories([h(mark.footer, {}, 'x')], ['popup', 'anchor'], 'anchor'),
		/knows the slots popup, anchor and was given footer/,
	);
	assert.throws(
		() => categories(['loose'], ['popup', 'anchor']),
		/takes only the slots popup, anchor/,
	);
});

test('Shown picks a branch, follows a cell, and inverts', () => {
	const open = mutable(true);
	const document = createDocument();
	const stop = mount(document.body, h(Shown as never, { value: open }, 'yes', h(mark.else, {}, 'no')));
	assert.equal(toHtml(document.body.childNodes), 'yes');
	open.set(false);
	assert.equal(toHtml(document.body.childNodes), 'no');
	stop();

	const inverted = createDocument();
	const stopTwo = mount(inverted.body, h(Shown as never, { value: false, invert: true }, 'yes', h(mark.else, {}, 'no')));
	assert.equal(toHtml(inverted.body.childNodes), 'yes');
	stopTwo();
});

test('Switch matches a case, falls back to the default, and follows a cell', () => {
	const status = mutable('loading');
	const document = createDocument();
	const stop = mount(document.body, h(Switch as never, { value: status },
		h(mark.case, { value: 'loading' }, 'wait'),
		h(mark.case, { value: 'ready' }, 'here'),
		h(mark.default, {}, 'nothing'),
	));
	assert.equal(toHtml(document.body.childNodes), 'wait');
	status.set('ready');
	assert.equal(toHtml(document.body.childNodes), 'here');
	status.set('elsewhere');
	assert.equal(toHtml(document.body.childNodes), 'nothing');
	stop();
});

test('Switch over cases picks the first truthy one, and follows every cell', () => {
	const a = mutable(false);
	const b = mutable(false);
	const document = createDocument();
	const stop = mount(document.body, h(Switch as never, { cases: { a, b } },
		h(mark.case, { value: 'a' }, 'A'),
		h(mark.case, { value: 'b' }, 'B'),
		h(mark.default, {}, '-'),
	));
	assert.equal(toHtml(document.body.childNodes), '-');
	// The second cell moving has to be seen, which is what fails when only the first is watched.
	b.set(true);
	assert.equal(toHtml(document.body.childNodes), 'B');
	a.set(true);
	assert.equal(toHtml(document.body.childNodes), 'A', 'the first truthy key wins');
	stop();
});

test('Switch refuses value and cases together, and a case with no value', () => {
	assert.throws(() => (Switch as never as (p: unknown) => unknown)({ value: 1, cases: {}, children: [] }),
		/takes value or cases, not both/);
	assert.throws(() => (Switch as never as (p: unknown) => unknown)({ value: 1, children: [h(mark.case, {}, 'x')] }),
		/needs a value to match/);
});

test('a slot named twice is refused', () => {
	// Two categories of one name are one category, and the caller would be handed it twice and
	// mount its children twice.
	assert.throws(
		() => categories([mark('body', null, 'x')], ['body', 'body']),
		/names the slot body twice/,
	);
});
