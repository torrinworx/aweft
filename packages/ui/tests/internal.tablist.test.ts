// The tablist behaviour on its own (design 203). White box, because it is not exported.
//
// The strip is built by hand in the light tree rather than through `Tabs`, so what these tests say
// is what the behaviour does and not what a component asked it to do. The light tree does not
// bubble, so an event is delivered to the strip with the tab as its target, which is what a browser
// delivers after the bubble.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument } from '@aweftjs/dom';
import type { LightElement } from '@aweftjs/dom';

import { tabList } from '../src/tablist.ts';

/** A strip of tabs: `A B C`, with the given one chosen and the given ones out of reach. */
const strip = (options: {
	chosen?: number;
	off?: readonly number[];
	vertical?: boolean;
	count?: number;
} = {}): { list: LightElement; tabs: LightElement[]; focused: string[] } => {
	const document = createDocument();
	const list = document.createElement('div');
	list.setAttribute('role', 'tablist');
	if (options.vertical === true) list.setAttribute('aria-orientation', 'vertical');
	document.body.appendChild(list);

	const focused: string[] = [];
	const tabs: LightElement[] = [];
	for (let at = 0; at < (options.count ?? 3); at += 1) {
		const tab = document.createElement('button');
		const name = String.fromCharCode(65 + at);
		tab.setAttribute('role', 'tab');
		tab.setAttribute('id', name);
		tab.setAttribute('aria-selected', at === (options.chosen ?? 0) ? 'true' : 'false');
		if (options.off?.includes(at) === true) tab.setAttribute('aria-disabled', 'true');
		// The light tree has no focus, so the call is recorded instead: what matters here is which
		// tab was asked for it and in what order.
		(tab as unknown as { focus(): void }).focus = () => { focused.push(name); };
		// A tab holds its words, and a real event's target may be one of them.
		list.appendChild(tab);
		tabs.push(tab);
	}
	return { list, tabs, focused };
};

/** The roving index across the strip, as one string: `0` is the tab stop and `-1` is not. */
const roving = (tabs: readonly LightElement[]): string =>
	tabs.map((tab) => tab.getAttribute('tabindex') ?? 'none').join(' ');

/** Deliver a key the way a browser does after it has bubbled to the strip. */
const press = (list: LightElement, target: unknown, key: string): { prevented: boolean } => {
	let prevented = false;
	(list as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent({
		type: 'keydown', key, target, preventDefault: () => { prevented = true; },
	});
	return { prevented };
};

test('the strip has one tab stop, and it is on the tab that is chosen', () => {
	const { list, tabs } = strip({ chosen: 1 });
	const stop = tabList(list, { onSelect: () => undefined });
	assert.equal(roving(tabs), '-1 0 -1', 'the chosen tab is the one Tab reaches');
	stop();
});

test('with nothing chosen the tab stop is the first tab that can take it', () => {
	const { list, tabs } = strip({ chosen: -1, off: [0] });
	const stop = tabList(list, { onSelect: () => undefined });
	assert.equal(roving(tabs), '-1 0 -1', 'the disabled first tab is not a place to land');
	stop();
});

test('an arrow moves the stop, the focus and the selection, one tab at a time', () => {
	const { list, tabs, focused } = strip();
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});

	const first = press(list, tabs[0], 'ArrowRight');
	assert.equal(roving(tabs), '-1 0 -1');
	assert.deepEqual(chosen, ['B'], 'the callback is given the element it landed on');
	assert.deepEqual(focused, ['B'], 'and that element is asked for the focus');
	assert.equal(first.prevented, true, 'the page does not scroll under an arrow the strip used');

	press(list, tabs[1], 'ArrowRight');
	assert.deepEqual(chosen, ['B', 'C']);
	// Wrap-around: past the last tab is the first one again, and back past the first is the last.
	press(list, tabs[2], 'ArrowRight');
	assert.deepEqual(chosen, ['B', 'C', 'A']);
	assert.equal(roving(tabs), '0 -1 -1');
	press(list, tabs[0], 'ArrowLeft');
	assert.deepEqual(chosen, ['B', 'C', 'A', 'C']);
	assert.equal(roving(tabs), '-1 -1 0');
	stop();
});

test('Home and End go to the ends, whichever tab the key came from', () => {
	const { list, tabs } = strip({ chosen: 1 });
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});

	press(list, tabs[1], 'End');
	assert.deepEqual(chosen, ['C']);
	assert.equal(roving(tabs), '-1 -1 0');
	press(list, tabs[2], 'Home');
	assert.deepEqual(chosen, ['C', 'A']);
	assert.equal(roving(tabs), '0 -1 -1');
	stop();
});

test('a disabled tab is stepped over, by an arrow and by an end key alike', () => {
	// B is out of reach, so Right from A is C and Left from A is C as well; Home from C is A and
	// End from A is C, because neither end is the disabled one here.
	const { list, tabs } = strip({ off: [1] });
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});

	press(list, tabs[0], 'ArrowRight');
	assert.deepEqual(chosen, ['C'], 'B was passed over rather than landed on');
	assert.equal(roving(tabs), '-1 -1 0');
	press(list, tabs[2], 'ArrowLeft');
	assert.deepEqual(chosen, ['C', 'A']);
	stop();

	// And when the end itself is out of reach, the end key stops at the last one that is not.
	const edge = strip({ off: [2] });
	const ends: string[] = [];
	const second = tabList(edge.list, {
		onSelect: (tab) => { ends.push((tab as LightElement).getAttribute('id') ?? ''); },
	});
	press(edge.list, edge.tabs[0], 'End');
	assert.deepEqual(ends, ['B'], 'End is the last tab that can be chosen, not the last tab');
	second();
});

test('a strip that says it is vertical answers Up and Down instead', () => {
	const { list, tabs } = strip({ vertical: true });
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});

	assert.equal(press(list, tabs[0], 'ArrowRight').prevented, false,
		'a sideways arrow is the page\'s business in a strip that stands on its side');
	assert.deepEqual(chosen, []);

	press(list, tabs[0], 'ArrowDown');
	assert.deepEqual(chosen, ['B']);
	press(list, tabs[1], 'ArrowUp');
	assert.deepEqual(chosen, ['B', 'A']);
	stop();
});

test('a click chooses the tab it landed on, and a disabled one refuses it', () => {
	const { list, tabs, focused } = strip({ off: [2] });
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});

	const click = (target: unknown): void => {
		(list as unknown as { dispatchEvent(event: unknown): boolean })
			.dispatchEvent({ type: 'click', target });
	};

	click(tabs[1]);
	assert.deepEqual(chosen, ['B']);
	assert.deepEqual(focused, ['B']);
	assert.equal(roving(tabs), '-1 0 -1');

	click(tabs[2]);
	assert.deepEqual(chosen, ['B'], 'a disabled tab is not chosen by a click either');
	assert.equal(roving(tabs), '-1 0 -1');

	// A key from somewhere else in the strip is nothing to do with the tabs.
	press(list, list, 'ArrowRight');
	assert.deepEqual(chosen, ['B']);
	stop();
});

test('a tab added after it was installed is followed, and the teardown removes both listeners', () => {
	const { list, tabs } = strip({ count: 2 });
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});

	const grown = list.ownerDocument.createElement('button');
	grown.setAttribute('role', 'tab');
	grown.setAttribute('id', 'C');
	grown.setAttribute('aria-selected', 'false');
	list.appendChild(grown);

	press(list, tabs[1], 'ArrowRight');
	assert.deepEqual(chosen, ['C'], 'the tabs are read again on every key, so a new one is there');

	stop();
	assert.equal(list.listeners.get('keydown')?.size ?? 0, 0);
	assert.equal(list.listeners.get('click')?.size ?? 0, 0);
	press(list, tabs[0], 'ArrowRight');
	assert.deepEqual(chosen, ['C'], 'and nothing answers after the teardown');
});

test('the tab holding the stop leaving the strip leaves a stop behind it', () => {
	// The zero is written once at install, and the element carrying it can be taken out of the
	// strip between two events. Then nothing in the strip is in the Tab order, so a keyboard cannot
	// get back into it at all. The tabs are read again on every event, so the zero is settled again
	// on every event too.
	const { list, tabs } = strip({ chosen: 0 });
	const chosen: string[] = [];
	const stop = tabList(list, {
		onSelect: (tab) => { chosen.push((tab as LightElement).getAttribute('id') ?? ''); },
	});
	assert.equal(roving(tabs), '0 -1 -1');

	(list as unknown as { removeChild(child: unknown): void }).removeChild(tabs[0]);
	const left = [tabs[1]!, tabs[2]!];
	assert.equal(roving(left), '-1 -1', 'with the tab gone the strip is nobody\'s tab stop');

	// A key the map does not know: it does nothing else, and the strip still has a stop after it.
	press(list, tabs[1], 'x');
	assert.equal(roving(left), '0 -1', 'the first tab that can take it holds the stop again');
	assert.deepEqual(chosen, [], 'and a key the map does not know chose nothing');

	press(list, tabs[1], 'ArrowRight');
	assert.equal(roving(left), '-1 0');
	assert.deepEqual(chosen, ['C'], 'and the arrows still move from where the stop is');
	stop();
});

test('with no element to listen on it installs nothing and removes nothing', () => {
	// A static render has no page and no listeners, and the behaviour is called all the same.
	const stop = tabList(null, { onSelect: () => { throw new Error('nothing to select'); } });
	assert.doesNotThrow(stop);
});
