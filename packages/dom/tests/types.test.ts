// `h` with a component checks the component's own props, `each` as a list of its item (design 308).
//
// The refusals are pinned with `@ts-expect-error`, so the root typecheck goes red if one stops
// being refused. They sit in functions nothing calls, and the accepted calls run and are checked.

import test from 'node:test';
import assert from 'node:assert/strict';

import { type Cell, mutable, mutableArray } from '@aweftjs/core';

import { type CallProps, type Cleanup, createDocument, h, mount, toHtml } from '../src/index.ts';

interface Item {
	readonly id: number;
	readonly name: string;
}

const Row = (props: { each: Item; prefix: string }, cleanup: Cleanup): unknown => {
	cleanup(() => {});
	return h('li', { 'data-id': props.each.id }, props.prefix, props.each.name);
};

const items: Item[] = [{ id: 1, name: 'one' }, { id: 2, name: 'two' }];

test('a row typed by its item takes a list, a list cell, a cell of a list, and the old cast', () => {
	const live = mutableArray<Item>([items[0]!]);
	const whole: Cell<readonly Item[]> = mutable<readonly Item[]>([items[1]!]);
	const document = createDocument();
	const stop = mount(document.body, h('ul', null,
		h(Row, { each: items, prefix: 'a:' }),
		h(Row, { each: live, prefix: 'b:' }),
		h(Row, { each: whole, prefix: 'c:' }),
		// The cast a call needed under the old type still compiles.
		h(Row, { each: items as unknown as Item, prefix: 'd:' })));
	const text = (): string => toHtml(document.body.childNodes).replace(/<!--.?-->/g, '');
	assert.equal(text(), '<ul><li data-id="1">a:one</li><li data-id="2">a:two</li><li data-id="1">b:one</li><li data-id="2">c:two</li>'
		+ '<li data-id="1">d:one</li><li data-id="2">d:two</li></ul>');
	live.push(items[1]!);
	whole.set(items);
	assert.equal((text().match(/<li/g) ?? []).length, 8, 'both reactive lists followed their edits');
	stop();
});

test('a generic component is taken by h as before, its props left to what it declares by hand', () => {
	const Generic = <T,>(props: { each: T; show(item: T): string }): unknown => h('li', null, props.show(props.each));
	const document = createDocument();
	const stop = mount(document.body, h('ul', null, h(Generic, { each: items, show: (item: Item) => item.name.toUpperCase() })));
	assert.equal(toHtml(document.body.childNodes).replace(/<!--.?-->/g, ''), '<ul><li>ONE</li><li>TWO</li></ul>');
	stop();
});

// A row that may be mounted on its own as well as under a list declares its item optional.
const Maybe = (props: { each?: Item }): unknown => h('li', null, props.each?.name ?? 'none');

test('a row whose item is optional takes a list of it, or nothing', () => {
	const document = createDocument();
	const stop = mount(document.body, h('ul', null, h(Maybe, { each: items }), h(Maybe, {})));
	assert.equal(toHtml(document.body.childNodes).replace(/<!--.?-->/g, ''), '<ul><li>one</li><li>two</li><li>none</li></ul>');
	stop();
});

test('CallProps is what a call site writes: the list for each, children left to the rest', () => {
	const written: CallProps<{ each: Item; prefix: string }> = { each: new Set(items), prefix: '' };
	const loose: CallProps<unknown> = { anything: 1 };
	assert.equal([...(written.each as Iterable<Item>)].length, 2);
	assert.equal(loose['anything'], 1);
});

export const refused = {
	// @ts-expect-error a list of numbers where the row declares an Item
	numbers: () => h(Row, { each: [1, 2], prefix: '' }),
	// @ts-expect-error a required prop left out
	missing: () => h(Row, { each: items }),
	// @ts-expect-error a prop of the wrong type
	wrong: () => h(Row, { each: items, prefix: 1 }),
	// @ts-expect-error a prop the row does not declare
	extra: () => h(Row, { each: items, prefix: '', colour: 'red' }),
	// @ts-expect-error a list of numbers where the row declares an optional Item
	optional: () => h(Maybe, { each: [1, 2] }),
};

test('the refused calls are never made', () => {
	assert.deepEqual(Object.keys(refused), ['numbers', 'missing', 'wrong', 'extra', 'optional']);
});
