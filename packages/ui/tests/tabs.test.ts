// `Tabs`, `Tab` and `TabPanel` in the light tree (design 203): what they render, what a screen
// reader is told, and which entry each part lands on.
//
// What only a browser can answer, which is a real Tab press and a real arrow, is `browser.test.ts`.
// The strip's own key map is `internal.tablist.test.ts`. Every expected value here is written from
// design 203, not taken from a run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import { Tab, TabPanel, Tabs, context, h, mark, mount } from '@aweftjs/ui';
import type { Render } from '@aweftjs/ui';

const elements = (node: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let n = node; n !== null; n = n.nextSibling) {
		if (n.nodeType === 1) found.push(n as unknown as LightElement);
		found.push(...elements(n.firstChild));
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

/** Every element of one role under a node, in document order. */
const byRole = (root: LightElement, role: string): LightElement[] =>
	elements(root as unknown as NodeLike).filter((element) => element.getAttribute('role') === role);

/** The rules this element's generated class was given, which is what says its entry landed. */
const rulesOn = (render: Render, element: LightElement): string => {
	const name = element.getAttribute('class') ?? '';
	assert.notEqual(name, '', 'the element was given a generated class');
	const wanted = new RegExp(`\\.${name}\\b`);
	return render.theme.markup().split('\n').filter((line) => wanted.test(line)).join('\n');
};

/** Deliver a click the way a browser does after it has bubbled to the strip. */
const click = (list: LightElement, target: LightElement): void => {
	(list as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type: 'click', target });
};

const VIEWS = [
	{ value: 'all', label: 'All', content: 'everything' },
	{ value: 'mine', label: 'Mine', content: 'the ones I own' },
	{ value: 'gone', label: 'Deleted', disabled: true, content: 'the bin' },
];

test('each tab names its panel and each panel names its tab, off the render\'s own counter', () => {
	const { root, stop } = page(h(Tabs as never, { label: 'Views', tabs: VIEWS }));

	const list = byRole(root, 'tablist')[0]!;
	assert.equal(list.localName, 'div');
	assert.equal(list.getAttribute('aria-label'), 'Views');
	assert.equal(list.getAttribute('aria-orientation'), null, 'a horizontal strip says nothing');

	const tabs = byRole(root, 'tab');
	const panels = byRole(root, 'tabpanel');
	assert.equal(tabs.length, 3);
	assert.equal(panels.length, 3);
	assert.equal(tabs[0]!.localName, 'button');
	assert.equal(tabs[0]!.getAttribute('type'), 'button', 'never a submit inside a form');

	for (let at = 0; at < 3; at += 1) {
		const tab = tabs[at]!;
		const panel = panels[at]!;
		assert.notEqual(tab.getAttribute('id'), null);
		assert.equal(tab.getAttribute('aria-controls'), panel.getAttribute('id'),
			'the tab names the panel it shows');
		assert.equal(panel.getAttribute('aria-labelledby'), tab.getAttribute('id'),
			'and the panel is named by its tab');
		assert.equal(panel.getAttribute('tabindex'), '0',
			'a panel is focusable, because the Tab out of the strip has to land somewhere');
	}
	// Every id is its own, and every one of them came off the render's counter rather than a
	// counter at module scope, which is what a hydration needs to agree (design 109).
	const ids = tabs.map((tab) => tab.getAttribute('id') ?? '');
	assert.equal(new Set(ids).size, 3);
	for (const id of ids) assert.match(id, /^tab-\d+-tab$/);
	stop();
});

test('the first tab is the one showing when nobody said which, and the rest are hidden', () => {
	const { root, stop } = page(h(Tabs as never, { label: 'Views', tabs: VIEWS }));

	const tabs = byRole(root, 'tab');
	const panels = byRole(root, 'tabpanel');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['true', 'false', 'false']);
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('tabindex')), ['0', '-1', '-1'],
		'one tab stop, on the one showing');
	// Hidden, not gone: the panel is still in the tree, so coming back to it finds it as it was.
	assert.deepEqual(panels.map((panel) => panel.hasAttribute('hidden')), [false, true, true]);
	assert.equal(panels[1]!.textContent, 'the ones I own', 'the hidden panel still holds its own');

	// A disabled tab says so where a screen reader reads it, rather than dropping out of the
	// reading order the way a `disabled` attribute would.
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-disabled')), [null, null, 'true']);
	assert.equal(tabs[2]!.hasAttribute('disabled'), false);
	stop();
});

test('the value cell goes both ways: written it moves the panels, clicked it is written', () => {
	const showing = mutable('mine');
	const changed: unknown[] = [];
	const { root, stop } = page(h(Tabs as never, {
		label: 'Views', tabs: VIEWS, value: showing, onChange: (next: unknown) => { changed.push(next); },
	}));

	const list = byRole(root, 'tablist')[0]!;
	const tabs = byRole(root, 'tab');
	const panels = byRole(root, 'tabpanel');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'true', 'false'],
		'the caller\'s cell said which, and no tab was chosen for them');

	// Written from outside: the tabs and the panels follow, with nothing clicked.
	showing.set('all');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['true', 'false', 'false']);
	assert.deepEqual(panels.map((panel) => panel.hasAttribute('hidden')), [false, true, true]);
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('tabindex')), ['0', '-1', '-1']);
	assert.deepEqual(changed, [], 'a write from outside is not a change this component reports');

	// Clicked: the cell is written and `onChange` hears about it.
	click(list, tabs[1]!);
	assert.equal(showing.get(), 'mine');
	assert.deepEqual(changed, ['mine']);
	assert.deepEqual(panels.map((panel) => panel.hasAttribute('hidden')), [true, false, true]);

	// And the tab nobody may choose is not chosen by a click either.
	click(list, tabs[2]!);
	assert.equal(showing.get(), 'mine');
	assert.deepEqual(changed, ['mine']);
	stop();
});

test('a strip standing on its side says so, and the type is a segment on both boxes', () => {
	const { render, root, stop } = page(h(Tabs as never, {
		label: 'Views', tabs: VIEWS, orientation: 'vertical', type: 'line', size: 'sm',
	}));

	const list = byRole(root, 'tablist')[0]!;
	assert.equal(list.getAttribute('aria-orientation'), 'vertical',
		'which is what turns the arrows to Up and Down');

	// The root turns as well, so the panel stands beside the strip rather than under it.
	assert.match(rulesOn(render, root), /flex-direction: column/);
	assert.match(rulesOn(render, root), /flex-direction: row/);
	assert.equal(rulesOn(render, root).lastIndexOf('flex-direction: row')
		> rulesOn(render, root).lastIndexOf('flex-direction: column'), true,
	'and the vertical rule is the last word on it');

	const strip = rulesOn(render, list);
	assert.match(strip, /flex-direction: column/, 'the tabs stack');
	assert.match(strip, /background: transparent/, 'and the line type has no filled strip');

	const tabs = byRole(root, 'tab');
	const chosen = rulesOn(render, tabs[0]!);
	assert.match(chosen, /border-bottom: 3px solid/, '$ringWidth, which is the underline');
	assert.match(chosen, /min-height: 32px/, '$controlSm, through the size the group handed down');
	// The disabled tab wears the theme's one disabled rule rather than a rule of its own.
	assert.match(rulesOn(render, tabs[2]!), /opacity: 0\.5/);
	stop();
});

test('a tab added to the list through a cell arrives with its own ids and panel', () => {
	const listed = mutable([{ value: 'all', label: 'All', content: 'everything' }]);
	const { root, stop } = page(h(Tabs as never, { label: 'Views', tabs: listed }));

	assert.equal(byRole(root, 'tab').length, 1);
	const first = byRole(root, 'tab')[0]!.getAttribute('id');

	listed.set([
		{ value: 'all', label: 'All', content: 'everything' },
		{ value: 'mine', label: 'Mine', content: 'the ones I own' },
	]);

	const tabs = byRole(root, 'tab');
	const panels = byRole(root, 'tabpanel');
	assert.equal(tabs.length, 2);
	assert.equal(panels.length, 2);
	assert.equal(tabs[0]!.getAttribute('id'), first,
		'a value that was already there keeps the ids it was given');
	assert.equal(tabs[1]!.getAttribute('aria-controls'), panels[1]!.getAttribute('id'));
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['true', 'false'],
		'and the one that was showing is still the one showing');
	stop();
});

test('tabs and panels written by hand go in their two slots and reach the same group', () => {
	const showing = mutable('two');
	const { root, stop } = page(h(Tabs as never, { label: 'Written out', value: showing },
		h(mark.tabs as never, {},
			h(Tab as never, { value: 'one', label: 'One' }),
			h(Tab as never, { value: 'two', label: 'Two' })),
		h(mark.panels as never, {},
			h(TabPanel as never, { value: 'one' }, 'the first'),
			h(TabPanel as never, { value: 'two' }, 'the second'))));

	const list = byRole(root, 'tablist')[0]!;
	const tabs = byRole(root, 'tab');
	const panels = byRole(root, 'tabpanel');
	assert.equal(tabs.length, 2);
	// The tabs are inside the strip and the panels are outside it, which is what the two slots buy.
	for (const tab of tabs) assert.equal(tab.parentNode, list as unknown as NodeLike);
	for (const panel of panels) assert.notEqual(panel.parentNode, list as unknown as NodeLike);

	assert.equal(tabs[1]!.getAttribute('aria-controls'), panels[1]!.getAttribute('id'),
		'a tab and a panel written apart still find each other by value');
	assert.deepEqual(panels.map((panel) => panel.hasAttribute('hidden')), [true, false]);
	click(list, tabs[0]!);
	assert.equal(showing.get(), 'one');
	stop();
});

test('the selected tab leaving the list moves the strip onto the first tab anyone can choose', () => {
	// A tab that goes away takes the tab stop and the panel with it: every tab reads -1 and every
	// panel is hidden, so the strip is not in the Tab order at all and there is nothing on screen.
	const listed = mutable([
		{ value: 'all', label: 'All', content: 'everything' },
		{ value: 'mine', label: 'Mine', content: 'the ones I own' },
	]);
	const owned = page(h(Tabs as never, { label: 'Views', tabs: listed }));
	assert.deepEqual(byRole(owned.root, 'tab').map((tab) => tab.getAttribute('tabindex')), ['0', '-1']);

	listed.set([{ value: 'mine', label: 'Mine', content: 'the ones I own' }]);
	const left = byRole(owned.root, 'tab');
	assert.equal(left.length, 1);
	assert.equal(left[0]!.getAttribute('aria-selected'), 'true', 'the tab left over is showing');
	assert.equal(left[0]!.getAttribute('tabindex'), '0', 'and the strip is still a tab stop');
	assert.deepEqual(byRole(owned.root, 'tabpanel').map((panel) => panel.hasAttribute('hidden')),
		[false], 'and its panel is on the page');
	owned.stop();

	// The same on a cell the caller passed: the cell follows, because it is the one source of truth
	// and a caller reading it back has to see what is showing.
	const showing = mutable<unknown>('mine');
	const seen: unknown[] = [];
	const theirs = mutable([
		{ value: 'all', label: 'All', content: 'everything' },
		{ value: 'mine', label: 'Mine', content: 'the ones I own' },
	]);
	const held = page(h(Tabs as never, {
		label: 'Views', value: showing, tabs: theirs, onChange: (next: unknown) => { seen.push(next); },
	}));
	assert.deepEqual(seen, [], 'nothing was written while the cell named a tab');

	theirs.set([{ value: 'all', label: 'All', content: 'everything' }]);
	assert.equal(showing.get(), 'all', 'the cell moved onto the tab that took its place');
	assert.deepEqual(seen, ['all'], 'and the caller was told');
	const now = byRole(held.root, 'tab');
	assert.equal(now[0]!.getAttribute('aria-selected'), 'true');
	assert.equal(now[0]!.getAttribute('tabindex'), '0');
	held.stop();
});

test('the tab that takes over is one anyone may choose, never a disabled one', () => {
	const listed = mutable([
		{ value: 'all', label: 'All', content: 'everything' },
		{ value: 'gone', label: 'Deleted', disabled: true, content: 'the bin' },
		{ value: 'mine', label: 'Mine', content: 'the ones I own' },
	]);
	const { root, stop } = page(h(Tabs as never, { label: 'Views', tabs: listed }));

	listed.set([
		{ value: 'gone', label: 'Deleted', disabled: true, content: 'the bin' },
		{ value: 'mine', label: 'Mine', content: 'the ones I own' },
	]);
	const tabs = byRole(root, 'tab');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'true'],
		'the disabled tab is stepped over the way an arrow steps over it');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('tabindex')), ['-1', '0']);
	stop();
});

test('with every tab disabled nothing is chosen, and the first tab still holds the stop', () => {
	// Choosing a tab nobody may choose would say a panel is showing that nobody asked for. The
	// strip stays reachable so a keyboard can get to it if a tab is enabled later.
	const { root, stop } = page(h(Tabs as never, { label: 'Views', tabs: [
		{ value: 'all', label: 'All', disabled: true, content: 'everything' },
		{ value: 'mine', label: 'Mine', disabled: true, content: 'the ones I own' },
	] }));

	const tabs = byRole(root, 'tab');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['false', 'false'],
		'no tab says it is the one showing');
	assert.deepEqual(tabs.map((tab) => tab.getAttribute('tabindex')), ['0', '-1'],
		'and the strip is still one stop in the Tab order');
	assert.deepEqual(byRole(root, 'tabpanel').map((panel) => panel.hasAttribute('hidden')),
		[true, true], 'and no panel is showing');
	stop();
});

test('a cell the caller passed holding nothing is left holding nothing', () => {
	// Design 203: choosing for them would be a write they did not ask for. It is the tab going away
	// that the component steps in for, not a cell that was never on a tab.
	const showing = mutable<unknown>(null);
	const seen: unknown[] = [];
	const { root, stop } = page(h(Tabs as never, {
		label: 'Views', value: showing, tabs: VIEWS, onChange: (next: unknown) => { seen.push(next); },
	}));

	assert.equal(showing.get(), null, 'the cell is untouched');
	assert.deepEqual(seen, []);
	assert.deepEqual(byRole(root, 'tab').map((tab) => tab.getAttribute('aria-selected')),
		['false', 'false', 'false'], 'so no tab is showing');
	assert.deepEqual(byRole(root, 'tab').map((tab) => tab.getAttribute('tabindex')),
		['0', '-1', '-1'], 'and the first tab still holds the stop');
	stop();
});

test('a Tab outside a Tabs refuses, and names what to write instead', () => {
	const document = createDocument();
	assert.throws(
		() => { mount(document.body, h(Tab as never, { value: 'one', label: 'One' })); },
		/a Tab and a TabPanel go inside a Tabs; write <Tabs><mark\.tabs>/,
	);
	assert.throws(
		() => { mount(createDocument().body, h(TabPanel as never, { value: 'one' }, 'x')); },
		/a Tab and a TabPanel go inside a Tabs/,
	);
	// And a bare child is refused by name, because a tab and a panel go in two different places.
	assert.throws(
		() => {
			mount(createDocument().body,
				h(Tabs as never, { label: 'Views' }, h(Tab as never, { value: 'one', label: 'One' })));
		},
		/this component takes only the slots tabs, panels/,
	);
});

test('a TabPanel whose value has no tab is refused, because it names an id nobody can reach', () => {
	assert.throws(
		() => {
			mount(createDocument().body, h(Tabs as never, { label: 'Views' },
				h(mark.tabs as never, {}, h(Tab as never, { value: 'one', label: 'One' })),
				h(mark.panels as never, {}, h(TabPanel as never, { value: 'two' }, 'x'))));
		},
		/a TabPanel needs a Tab with the same value and no tab has "two"/,
	);
});
