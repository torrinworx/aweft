// `Menu`: a button, the actions it opens, and what picking one does (design 225).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import { Menu, PopupContext, h, mount } from '@aweftjs/ui';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
	}
	return found;
};

const roled = (node: NodeLike | null, role: string): LightElement[] =>
	elements(node).filter((element) => element.getAttribute('role') === role);

/** A page with the sink a popup needs, and the two ways a person reaches the anchor. */
const page = (item: unknown): {
	root: NodeLike | null;
	anchor: LightElement;
	menu: LightElement;
	focused: number;
	menuFocused: number;
	press(key: string): void;
	click(): void;
	stop(): void;
} => {
	const document = createDocument();
	const stop = mount(document.body, h(PopupContext as never, {}, item));
	const root = document.body.firstChild;
	const anchor = elements(root).find((element) => element.localName === 'button')!;
	const menu = elements(root).find((element) => element.getAttribute('role') === 'menu')!;
	const state = { focused: 0, menu: 0 };
	// The light tree has no focus, so the call is recorded: what matters is that it was asked for.
	(anchor as unknown as { focus(): void }).focus = () => { state.focused += 1; };
	(menu as unknown as { focus(): void }).focus = () => { state.menu += 1; };
	return {
		root,
		anchor,
		menu,
		get focused() { return state.focused; },
		get menuFocused() { return state.menu; },
		press: (key) => {
			// Where a browser would deliver it: the menu holds the focus while it is open, which is
			// what the ARIA menu-button pattern asks for (design 225).
			const on = anchor.getAttribute('aria-expanded') === 'true' ? menu : anchor;
			(on as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({
				type: 'keydown', key, target: on, preventDefault: () => undefined,
			});
		},
		click: () => {
			(anchor as unknown as { dispatchEvent(event: unknown): boolean })
				.dispatchEvent({ type: 'click', target: anchor });
		},
		stop: () => { stop(); },
	};
};

const QUICK = [{
	heading: 'Quick Actions',
	items: [
		{ label: 'Mute Conversation' },
		{ label: 'Mark as Read' },
		{ label: 'Block User' },
		{ label: 'Delete Conversation', type: 'danger' },
	],
}];

test('the anchor is a button that says what it opens, and the list is a menu of menuitems', () => {
	const one = page(h(Menu as never, {
		label: 'Actions',
		items: [{ label: 'Rename' }, { label: 'Delete', type: 'danger' }],
	}));

	assert.equal(one.anchor.getAttribute('aria-haspopup'), 'menu');
	assert.equal(one.anchor.getAttribute('aria-expanded'), 'false');

	const menu = roled(one.root, 'menu');
	assert.equal(menu.length, 1);
	assert.equal(one.anchor.getAttribute('aria-controls'), menu[0]!.getAttribute('id'));
	assert.equal(menu[0]!.getAttribute('aria-labelledby'), one.anchor.getAttribute('id'),
		'the button names the menu, so the menu has a name to be read out by');
	assert.deepEqual(roled(one.root, 'menuitem').map((row) => row.textContent),
		['Rename', 'Delete']);
	one.stop();
});

test('a group draws its heading and names itself with it', () => {
	const one = page(h(Menu as never, { label: 'Actions', items: QUICK }));

	const groups = roled(one.root, 'group');
	assert.equal(groups.length, 1);
	const heading = elements(one.root)
		.find((element) => element.getAttribute('id') === groups[0]!.getAttribute('aria-labelledby'));
	assert.equal(heading?.textContent, 'Quick Actions');
	assert.equal(heading?.getAttribute('role'), 'presentation',
		'a heading is the group\'s name, not a row anybody can choose');
	assert.deepEqual(roled(one.root, 'menuitem').map((row) => row.textContent),
		['Mute Conversation', 'Mark as Read', 'Block User', 'Delete Conversation']);
	one.stop();
});

test('the active row is named from the menu, because a button may not name one', () => {
	// `aria-activedescendant` is allowed on a `role="menu"` and refused on a `role="button"`: axe
	// calls it `aria-allowed-attr`, critical, and it was on the anchor until design 225 was amended.
	const one = page(h(Menu as never, {
		label: 'Actions',
		items: [{ label: 'Rename' }, { label: 'Delete' }],
	}));

	one.click();
	one.press('ArrowDown');

	const active = elements(one.root)
		.filter((element) => element.getAttribute('aria-activedescendant') !== null);
	assert.equal(active.length, 1, 'exactly one element names the active row');
	assert.equal(active[0], one.menu, 'and it is the menu, not the button that opened it');
	assert.equal(one.anchor.getAttribute('aria-activedescendant'), null);
	assert.equal(one.menu.getAttribute('aria-activedescendant'),
		roled(one.root, 'menuitem')[0]!.getAttribute('id'));
	assert.equal(one.menu.getAttribute('tabindex'), '-1',
		'the menu can take the focus, which is what the pattern moves onto it');
	assert.equal(one.menuFocused, 1, 'and opening it did move the focus there');
	one.stop();
});

test('a group with no items yet is a heading, not a blank row', () => {
	const one = page(h(Menu as never, {
		label: 'Actions',
		items: [{ heading: 'Empty' }, { label: 'only' }],
	}));

	const headings = roled(one.root, 'presentation');
	assert.equal(headings.length, 1);
	assert.equal(headings[0]!.textContent, 'Empty');
	assert.deepEqual(roled(one.root, 'menuitem').map((row) => row.textContent), ['only'],
		'the empty group drew no row of its own');
	one.stop();
});

test('a danger item wears the danger segment and nothing else does', () => {
	const one = page(h(Menu as never, { label: 'Actions', items: QUICK }));
	const rows = roled(one.root, 'menuitem');
	const classes = rows.map((row) => row.getAttribute('class') ?? '');
	assert.notEqual(classes[3], classes[0], 'the danger row is not the class the others are');
	assert.equal(new Set(classes.slice(0, 3)).size, 1, 'and the others are all one class');
	one.stop();
});

test('the arrows and Enter reach the item that was picked, and the menu closes', () => {
	const picked: string[] = [];
	const open = mutable(false);
	const one = page(h(Menu as never, {
		label: 'Actions',
		open,
		items: [
			{ label: 'Rename', onSelect: () => picked.push('rename') },
			{ label: 'Delete', type: 'danger', onSelect: () => picked.push('delete') },
		],
	}));

	one.press('ArrowDown');
	assert.equal(open.get(), true, 'a closed menu opens under the key');
	one.press('ArrowDown');
	one.press('Enter');
	assert.deepEqual(picked, ['delete']);
	assert.equal(open.get(), false, 'and choosing closed it');
	assert.equal(one.focused, 1, 'with the focus back on the anchor');
	one.stop();
});

test('onSelect runs after the menu has closed, not before', () => {
	// Design 225 states the order, so it is pinned here: a handler that opens something of its own
	// must not open it underneath a menu that is still on the screen.
	const open = mutable(false);
	const seen: unknown[] = [];
	const one = page(h(Menu as never, {
		label: 'Actions',
		open,
		items: [{ label: 'Rename', onSelect: () => { seen.push(open.get()); } }],
	}));

	one.press('ArrowDown');
	one.press('Enter');
	assert.deepEqual(seen, [false], 'the open cell was already false when the handler ran');
	one.stop();
});

test('a click on the anchor opens it and a second one closes it', () => {
	const open = mutable(false);
	const one = page(h(Menu as never, { label: 'Actions', open, items: [{ label: 'Rename' }] }));
	one.click();
	assert.equal(open.get(), true);
	assert.equal(one.anchor.getAttribute('aria-expanded'), 'true');
	one.click();
	assert.equal(open.get(), false);
	one.stop();
});

test('Escape closes it and puts the focus back on the anchor', () => {
	const open = mutable(false);
	const one = page(h(Menu as never, { label: 'Actions', open, items: [{ label: 'Rename' }] }));
	one.click();
	one.press('Escape');
	assert.equal(open.get(), false);
	assert.equal(one.focused, 1);
	one.stop();
});

test('an item nobody may choose is stepped over and cannot be picked', () => {
	const picked: string[] = [];
	const one = page(h(Menu as never, {
		label: 'Actions',
		items: [
			{ label: 'Rename', disabled: true, onSelect: () => picked.push('rename') },
			{ label: 'Delete', onSelect: () => picked.push('delete') },
		],
	}));

	assert.equal(roled(one.root, 'menuitem')[0]!.getAttribute('aria-disabled'), 'true');
	one.press('ArrowDown');
	one.press('Enter');
	assert.deepEqual(picked, ['delete'], 'the first row was passed over');
	one.stop();
});

test('an open takes a cell, not a value', () => {
	assert.throws(
		() => page(h(Menu as never, { label: 'Actions', open: true, items: [] })),
		/Menu open takes a cell/,
	);
});

test('an items cell replaces the actions', () => {
	const items = mutable<unknown>([{ label: 'Rename' }]);
	const one = page(h(Menu as never, { label: 'Actions', items }));
	assert.equal(roled(one.root, 'menuitem').length, 1);
	items.set([{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]);
	assert.deepEqual(roled(one.root, 'menuitem').map((row) => row.textContent),
		['One', 'Two', 'Three']);
	one.stop();
});

test('children are the anchor\'s contents, so a caller writes their own trigger', () => {
	const one = page(h(Menu as never, { items: [{ label: 'Rename' }] },
		h('span', { id: 'own' }, 'Open')));
	assert.equal(one.anchor.textContent, 'Open');
	assert.equal(elements(one.root).some((element) => element.getAttribute('id') === 'own'), true,
		'the caller\'s own markup is inside the button this component owns');
	one.stop();
});
