// The table, the two navigation pieces, and the three built out of components that already exist
// (designs 201, 202), in the light tree: what each one renders, what a screen reader would call it,
// and which entry it lands on.
//
// What only a browser can answer, which is a box that really scrolls and a `<details>` group the
// platform really closes, is `browser.test.ts`. What the catalogue page answers is
// `recipes/ui/main.ts`. Every expected value here is written from the two records, not taken from a
// run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable, mutableArray } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import {
	Breadcrumb, Icons, Modal, Pagination, Stage, StageContext, Table,
	context, h, mount,
} from '@aweftjs/ui';
import type { Render } from '@aweftjs/ui';

import { testIcons } from './fixtures/icons.ts';

// A `DropDown` asks for a chevron by name and `Icons` starts empty (design 144), so a page holding
// an accordion answers for its icons the way `composites.test.ts` does.
const answered = (item: unknown): unknown => h(Icons as never, { value: testIcons }, item);

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

/** Every element of one tag under a node, in document order. */
const allOf = (root: LightElement, tag: string): LightElement[] =>
	elements(root as unknown as NodeLike).filter((element) => element.localName === tag);

/** Deliver one event the way the host would, with the element as its target. */
const fire = (element: LightElement, type: string): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element });
};

// --- Table ---------------------------------------------------------------------------------

const FILES = [
	{ name: 'shot.png', size: 12 },
	{ name: 'notes.md', size: 3 },
];

test('a table is one heading per column and one row per item', () => {
	const { render, root, stop } = page(h(Table as never, {
		columns: [{ key: 'name', label: 'Name' }, { key: 'size', label: 'Size', align: 'right' }],
		rows: FILES,
		caption: 'Everything in this folder',
	}));

	// The scroll box is what mounted, and it is focusable: a box that scrolls and cannot be focused
	// is unreachable from a keyboard.
	assert.equal(root.localName, 'div');
	assert.equal(root.getAttribute('tabindex'), '0');
	assert.match(rulesOn(render, root), /overflow-x: auto/);

	const table = childrenOf(root)[0]!;
	assert.equal(table.localName, 'table');
	assert.match(rulesOn(render, table), /border-collapse: collapse/);

	assert.deepEqual(childrenOf(table).map((node) => node.localName), ['caption', 'thead', 'tbody'],
		'the caption is first in the markup, where the platform requires it');
	assert.equal(childrenOf(table)[0]?.textContent, 'Everything in this folder');

	const headings = allOf(table, 'th');
	assert.deepEqual(headings.map((node) => node.textContent), ['Name', 'Size']);
	assert.deepEqual(headings.map((node) => node.getAttribute('scope')), ['col', 'col'],
		'a heading says which way it heads');
	assert.match(rulesOn(render, headings[1]!), /text-align: right/, 'align is a segment on the cell');

	const rows = allOf(table, 'tr');
	assert.equal(rows.length, 3, 'one head row and one per item');
	assert.deepEqual(allOf(table, 'td').map((node) => node.textContent),
		['shot.png', '12', 'notes.md', '3'], 'and each cell is String(row[key]) by default');
	stop();
});

test('a column with no label heads itself, and a cell function replaces the text', () => {
	const { root, stop } = page(h(Table as never, {
		columns: ['name', 'size'],
		rows: FILES,
		cell: (row: unknown, column: { key: string }) =>
			(column.key === 'size' ? `${String((row as { size: number }).size)} kB` : String((row as { name: string }).name)),
	}));

	const table = childrenOf(root)[0]!;
	assert.deepEqual(allOf(table, 'th').map((node) => node.textContent), ['name', 'size'],
		'a column written as a string heads itself');
	assert.deepEqual(allOf(table, 'td').map((node) => node.textContent),
		['shot.png', '12 kB', 'notes.md', '3 kB']);
	stop();
});

test('a row pushed onto a list inserts one tr and moves nothing else', () => {
	const rows = mutableArray([{ name: 'shot.png', size: 12 }]);
	const { root, stop } = page(h(Table as never, { columns: ['name'], rows }));
	const table = childrenOf(root)[0]!;

	const first = allOf(table, 'tbody')[0]!;
	assert.equal(allOf(first, 'tr').length, 1);
	const before = allOf(first, 'tr')[0];

	rows.push({ name: 'notes.md', size: 3 });
	const after = allOf(first, 'tr');
	assert.equal(after.length, 2, 'the push inserted one row');
	assert.equal(after[0], before, 'and the row that was there is the same element');
	assert.equal(after[1]?.textContent, 'notes.md');
	stop();
});

test('striped is a rule about which rows, and tight is a segment on the cells', () => {
	const plain = page(h(Table as never, { columns: ['name'], rows: FILES }));
	const plainTable = childrenOf(plain.root)[0]!;
	assert.doesNotMatch(rulesOn(plain.render, plainTable), /nth-child\(even\)/);
	assert.doesNotMatch(rulesOn(plain.render, allOf(plainTable, 'td')[0]!), /padding: 4px 8px/);
	plain.stop();

	const marked = page(h(Table as never, {
		columns: ['name'], rows: FILES, striped: true, tight: true,
	}));
	const table = childrenOf(marked.root)[0]!;
	assert.match(rulesOn(marked.render, table), /> tbody > tr:nth-child\(even\)/,
		'the table cannot reach a cell, so which rows is a rule about children');
	// The cells can be reached, because this component wrote them, so `tight` goes on them.
	assert.match(rulesOn(marked.render, allOf(table, 'td')[0]!), /padding: 4px 8px/, '$space $space2');
	assert.match(rulesOn(marked.render, allOf(table, 'th')[0]!), /padding: 4px 8px/);
	marked.stop();
});

test('a table renders a foot only when it was given one, spanning every column', () => {
	const bare = page(h(Table as never, { columns: ['name', 'size'], rows: FILES, label: 'Files' }));
	const bareTable = childrenOf(bare.root)[0]!;
	assert.equal(bareTable.getAttribute('aria-label'), 'Files',
		'a table with no caption still has a name');
	assert.deepEqual(childrenOf(bareTable).map((node) => node.localName), ['thead', 'tbody']);
	bare.stop();

	const footed = page(h(Table as never, {
		columns: ['name', 'size'], rows: FILES, foot: '2 files',
	}));
	const table = childrenOf(footed.root)[0]!;
	const foot = childrenOf(table).find((node) => node.localName === 'tfoot');
	assert.ok(foot !== undefined, 'the foot is there');
	const cell = allOf(foot, 'td')[0]!;
	assert.equal(cell.getAttribute('colspan'), '2', 'and it spans every column');
	assert.equal(cell.textContent, '2 files');
	footed.stop();
});

test('a rows cell holding anything but a list is no rows, at mount and after', () => {
	// A cell holds whatever the application put in it: nothing yet, a failed fetch, a single object.
	// None of those is a list and none of them may take the page down.
	const rows = mutable<unknown>(null);
	const { root, stop } = page(h(Table as never, { columns: ['name'], rows }));
	const body = allOf(childrenOf(root)[0]!, 'tbody')[0]!;
	assert.equal(allOf(body, 'tr').length, 0, 'a cell of null at mount is no rows');

	rows.set(FILES);
	assert.equal(allOf(body, 'tr').length, 2, 'and the list that arrives is the rows');

	rows.set(null);
	assert.equal(allOf(body, 'tr').length, 0, 'and it goes back to none rather than throwing');
	stop();
});

test('the head row wears no entry, and only a body row is a table_line', () => {
	const { render, root, stop } = page(h(Table as never, { columns: ['name'], rows: FILES }));
	const table = childrenOf(root)[0]!;

	const head = allOf(allOf(table, 'thead')[0]!, 'tr')[0]!;
	assert.equal(head.getAttribute('class'), null,
		'the head row is laid out by the head, so it takes no class of its own');

	const first = allOf(allOf(table, 'tbody')[0]!, 'tr')[0]!;
	assert.equal(first.getAttribute('class'),
		render.theme.classes(render.theme.base(), ['table_line']),
		'a body row is the table_line entry and nothing else');
	stop();
});

// --- Breadcrumb ----------------------------------------------------------------------------

const TRAIL = [
	{ label: 'Home', href: '/' },
	{ label: 'Files', href: '/files' },
	{ label: 'shot.png' },
];

test('a breadcrumb links every level but the last, which is where you already are', () => {
	const { render, root, stop } = page(h(Breadcrumb as never, { items: TRAIL }));

	assert.equal(root.localName, 'nav');
	assert.equal(root.getAttribute('aria-label'), 'Breadcrumb', 'the default name');
	const list = childrenOf(root)[0]!;
	assert.equal(list.localName, 'ol', 'an ordered list, because the order is the point');

	const items = childrenOf(list);
	assert.equal(items.length, 3);
	assert.deepEqual(allOf(root, 'a').map((node) => node.getAttribute('href')), ['/', '/files'],
		'two links, and no target on either, which is what lets a router take the click');
	assert.deepEqual(allOf(root, 'a').map((node) => node.getAttribute('target')), [null, null]);

	const current = childrenOf(items[2]!).find((node) => node.localName === 'span'
		&& node.getAttribute('aria-current') !== null);
	assert.ok(current !== undefined, 'the last item says it is the current page');
	assert.equal(current.getAttribute('aria-current'), 'page');
	assert.equal(current.textContent, 'shot.png');
	assert.match(rulesOn(render, current), /font-weight: 500/);
	stop();
});

test('a separator sits between the levels and is hidden from a screen reader', () => {
	const { render, root, stop } = page(h(Breadcrumb as never, { items: TRAIL, label: 'Where you are' }));
	assert.equal(root.getAttribute('aria-label'), 'Where you are');

	const separators = elements(root as unknown as NodeLike)
		.filter((node) => node.getAttribute('aria-hidden') === 'true');
	assert.equal(separators.length, 2, 'one fewer than the levels: none before the first');
	assert.equal(separators[0]?.textContent, '', 'it is drawn, not written');
	const rules = rulesOn(render, separators[0]!);
	assert.match(rules, /width: 8px; height: 8px/, '$chevron');
	assert.match(rules, /transform: rotate\(-45deg\)/, 'the select\'s arrow, turned the other way');
	stop();
});

test('a breadcrumb follows a cell of items, and one level with no href is not a link', () => {
	const items = mutable(TRAIL);
	const { root, stop } = page(h(Breadcrumb as never, { items }));
	assert.equal(allOf(root, 'li').length, 3);

	items.set([{ label: 'Home', href: '/' }, { label: 'Nowhere' }, { label: 'shot.png' }]);
	assert.equal(allOf(root, 'li').length, 3, 'the new list replaced the old one');
	assert.deepEqual(allOf(root, 'a').map((node) => node.getAttribute('href')), ['/'],
		'a level with no href renders as a span rather than as a link that does nothing');
	stop();
});

test('the last level is not a link even when it was given an href', () => {
	// Where you already are is not somewhere to go, so the last level is a span whatever the items
	// say. An href on it is what a trail built from a route table hands over without thinking.
	const { root, stop } = page(h(Breadcrumb as never, {
		items: [{ label: 'Home', href: '/' }, { label: 'Files', href: '/files' },
			{ label: 'shot.png', href: '/files/shot.png' }],
	}));

	const items = allOf(root, 'li');
	assert.equal(items.length, 3);
	assert.equal(allOf(root, 'a').length, 2, 'two of the three levels are links');
	const parts = childrenOf(items[2]!);
	const last = parts[parts.length - 1]!;
	assert.equal(last.localName, 'span', 'and the last one is not');
	assert.equal(last.getAttribute('aria-current'), 'page');
	stop();
});

// --- Pagination ----------------------------------------------------------------------------

/** The labels of the page buttons, in order, with a gap written as it is drawn. */
const labelsOf = (root: LightElement): string[] =>
	childrenOf(root).map((node) => node.textContent ?? '');

test('the window is the first page, the last, and a sibling each side', () => {
	// Design 201's table, read off three renders: count 10, siblings 1.
	const first = page(h(Pagination as never, { page: mutable(1), count: 10 }));
	assert.deepEqual(labelsOf(first.root), ['Previous', '1', '2', '…', '10', 'Next']);
	first.stop();

	const middle = page(h(Pagination as never, { page: mutable(5), count: 10 }));
	assert.deepEqual(labelsOf(middle.root), ['Previous', '1', '…', '4', '5', '6', '…', '10', 'Next']);
	middle.stop();

	const last = page(h(Pagination as never, { page: mutable(10), count: 10 }));
	assert.deepEqual(labelsOf(last.root), ['Previous', '1', '…', '9', '10', 'Next']);
	last.stop();

	const one = page(h(Pagination as never, { page: mutable(1), count: 1 }));
	assert.deepEqual(labelsOf(one.root), ['Previous', '1', 'Next'], 'a single page is a single button');
	one.stop();
});

test('previous and next are disabled at the ends, and the current page says so', () => {
	const at = mutable(1);
	const { root, stop } = page(h(Pagination as never, { page: at, count: 3 }));

	assert.equal(root.localName, 'nav');
	assert.equal(root.getAttribute('aria-label'), 'Pagination');
	const buttons = (): LightElement[] => allOf(root, 'button');
	assert.equal(buttons()[0]?.getAttribute('disabled'), '', 'previous is off on page 1');
	assert.equal(buttons()[buttons().length - 1]?.getAttribute('disabled'), null);
	// Previous, 1, 2, 3, Next: only the page showing now says it is the current one.
	assert.deepEqual(buttons().map((node) => node.getAttribute('aria-current')),
		[null, 'page', null, null, null], 'only the page showing now is current');

	at.set(3);
	assert.equal(buttons()[0]?.getAttribute('disabled'), null, 'and on the last page it is next');
	assert.equal(buttons()[buttons().length - 1]?.getAttribute('disabled'), '');
	stop();
});

test('a page button writes the cell and calls onChange with the number', () => {
	const at = mutable(2);
	const seen: number[] = [];
	const { root, stop } = page(h(Pagination as never, {
		page: at, count: 5, onChange: (next: number) => { seen.push(next); },
	}));

	// The buttons are Previous, 1, 2, 3, ..., so the third element is page 3 at this window.
	const three = allOf(root, 'button').find((node) => node.textContent === '3');
	assert.ok(three !== undefined, 'page 3 has a button at page 2');
	fire(three, 'click');
	assert.equal(at.get(), 3, 'the cell moved');
	assert.deepEqual(seen, [3], 'and the handler was told the number');

	const previous = allOf(root, 'button')[0]!;
	fire(previous, 'click');
	assert.equal(at.get(), 2, 'previous went back one');
	assert.deepEqual(seen, [3, 2]);
	stop();
});

test('a page past the count is clamped to the last page, and the cell follows', () => {
	const at = mutable<unknown>(2);
	const seen: number[] = [];
	const { root, stop } = page(h(Pagination as never, {
		page: at, count: 3, onChange: (next: number) => { seen.push(next); },
	}));

	at.set(9);
	assert.equal(at.get(), 3, 'the cell holds the last page, not the one nobody can reach');
	assert.deepEqual(seen, [3], 'and the caller loading a page was told which one');
	assert.deepEqual(labelsOf(root), ['Previous', '1', '2', '3', 'Next']);
	const buttons = allOf(root, 'button');
	assert.deepEqual(buttons.map((node) => node.getAttribute('aria-current')),
		[null, null, null, 'page', null], 'the last page is where you are');
	assert.equal(buttons[buttons.length - 1]?.getAttribute('disabled'), '', 'and Next is off');
	stop();
});

test('a count that shrinks under the page moves the page down with it', () => {
	const at = mutable<unknown>(7);
	const total = mutable<unknown>(10);
	const seen: number[] = [];
	const { root, stop } = page(h(Pagination as never, {
		page: at, count: total, onChange: (next: number) => { seen.push(next); },
	}));
	assert.equal(at.get(), 7, 'a page inside the count is left alone');
	assert.deepEqual(seen, []);

	total.set(3);
	assert.equal(at.get(), 3, 'a filter that cut the list down took the page with it');
	assert.deepEqual(seen, [3]);
	const buttons = allOf(root, 'button');
	assert.equal(buttons[0]?.getAttribute('disabled'), null, 'Previous still goes back one page');
	stop();
});

test('a count of nothing is no page buttons and both arrows off', () => {
	const at = mutable<unknown>(1);
	const { root, stop } = page(h(Pagination as never, { page: at, count: 0 }));

	assert.deepEqual(labelsOf(root), ['Previous', 'Next'], 'no page has a button');
	const buttons = allOf(root, 'button');
	assert.equal(buttons[0]?.getAttribute('disabled'), '');
	assert.equal(buttons[1]?.getAttribute('disabled'), '');
	assert.equal(at.get(), 1, 'and nothing is written: there is no page to be on');
	stop();
});

// --- Sheet ---------------------------------------------------------------------------------

test('a modal is a sheet only when it was asked to be, and the side is a second segment', () => {
	// A Modal needs a stage above it, so what is asserted here is the class list it writes, read off
	// the theme rather than off a mounted dialog: `stage.test.ts` mounts the whole thing.
	const ui = context();
	const plain = ui.theme.classes(ui.theme.base(), ['dialog']);
	const sheet = ui.theme.classes(ui.theme.base(), ['dialog', 'sheet', 'right']);
	assert.notEqual(plain, sheet, 'the two class lists are two chains');

	const rules = ui.theme.markup().split('\n').filter((line) => new RegExp(`\\.${sheet}\\b`).test(line)).join('\n');
	assert.match(rules, /width: 24rem/, '$sheetWidth');
	assert.match(rules, /margin-left: auto/, 'against the right edge, by margin rather than transform');
	assert.match(rules, /translateX\(100%\)/, 'and sliding in from it');

	const plainRules = ui.theme.markup().split('\n').filter((line) => new RegExp(`\\.${plain}\\b`).test(line)).join('\n');
	assert.match(plainRules, /max-width: 32rem/, '$dialogWidth: a plain dialog is unchanged');
	assert.doesNotMatch(plainRules, /translateX/);
});

test('a sheet opened through the stage wears the side it was given', () => {
	// The test above reads the class list off the theme; this one reads it off a dialog that is
	// really on the page, so a `side` the component drops is caught rather than assumed.
	let held: { open(options: Record<string, unknown>): void } | null = null;
	const Home = (props: { stage?: unknown }): unknown => {
		held = props.stage as { open(options: Record<string, unknown>): void };
		return h('p', {}, 'the page');
	};
	const render = context();
	const document = createDocument();
	const stop = mount(document.body, answered(h(StageContext as never, {
		acts: { '': Home, edit: () => h('p', {}, 'editing') },
		initial: '',
	}, h(Stage as never, {}))), undefined, render);

	assert.ok(held !== null, 'the page act was handed the stage');
	(held as { open(options: Record<string, unknown>): void }).open({
		name: 'edit',
		template: (props: { children?: unknown[] }) =>
			h(Modal as never, { type: 'sheet', side: 'left' }, ...(props.children ?? [])),
	});

	const dialog = elements(document.body as unknown as NodeLike)
		.find((element) => element.localName === 'dialog');
	assert.ok(dialog !== undefined, 'the sheet is on the page');
	assert.equal(dialog.getAttribute('class'),
		render.theme.classes(render.theme.base(), ['dialog', 'sheet', 'left']),
		'the edge asked for is the one written, not the default');
	stop();
});
