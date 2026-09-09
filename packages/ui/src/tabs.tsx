// One set of panels, one showing at a time, with a strip of buttons to pick between them
// (design 203).
//
// The strip is `tablist.ts`, the fifth of this package's internal behaviours: the arrow keys, the
// one tab stop and the roving index are there, and what is left here is the markup, the ids and
// the cell. Every panel stays mounted and the ones not showing carry `hidden`, so switching back
// to a panel finds it as it was left; a caller who wants one built again wraps its content in a
// `Shown`.

import { type ElementLike, type Mounter, mount } from '@aweftjs/dom';
import { all, mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { categories } from './mark.ts';
import { controlStates, elementFor, sizeSegments } from './control.ts';
import { empty } from './field.ts';
import { h } from './h.ts';
import { mountedElement } from './popup.tsx';
import { slotOf, use, withSlot } from './render.ts';
import { isSource, isWritable, through } from './source.ts';
import { tabList } from './tablist.ts';
import { find } from './tree.ts';

/** One tab and the panel under it, for the common case where both are one line to write. */
export interface TabItem {
	/** What the value cell holds while this one is showing. */
	readonly value?: unknown;
	/** The words on the tab. */
	readonly label?: unknown;
	/** Nobody can choose it, and the arrows step over it. */
	readonly disabled?: unknown;
	/** What the panel shows. Anything mountable. */
	readonly content?: unknown;
}

/** The ids one tab and its panel share, so each names the other. */
interface TabIds {
	readonly tab: string;
	readonly panel: string;
}

/** What a `Tabs` gives the `Tab`s and `TabPanel`s under it. */
interface TabsGroup {
	/** This value's two ids, minted once off the render's counter and then kept. */
	ids(value: unknown): TabIds;
	/** Say a tab for this value exists, which is how an unasked-for cell starts on the first one. */
	claim(value: unknown, disabled: unknown): void;
	/** Whether a tab for this value has ever been built, which is what a panel needs to know. */
	held(value: unknown): boolean;
	/** Whether this value is the one showing: a value or a cell. */
	selected(value: unknown): unknown;
	/** Whether this value is the tab carrying the strip's one tab stop: a value or a cell. */
	stop(value: unknown): unknown;
	/** The variant every tab in this group wears. */
	readonly type: unknown;
	/** The height every tab in this group is. */
	readonly size: unknown;
}

/** No tab is showing: every tab in the list says nobody may choose it, or the cell was never on one. */
const NONE: unique symbol = Symbol('aweft.ui.tabs.none');

/** Whether a tab says nobody may choose it, reading a cell where it is one. */
const shut = (disabled: unknown): boolean =>
	Boolean(isSource(disabled) ? disabled.get() : disabled);

const GROUP: unique symbol = Symbol('aweft.ui.tabs');

const groupAt = (context: unknown): TabsGroup | null =>
	(slotOf(context, GROUP) as TabsGroup | undefined) ?? null;

/** What `Tabs` takes. Everything not named here goes to the element. */
export interface TabsProps {
	/** Which one is showing: a cell holding one tab's `value`. Absent, it keeps its own and
	 * starts on the first tab. */
	readonly value?: unknown;
	/** The tabs and their panels, for the common case. A list, or a cell holding one. */
	readonly tabs?: unknown;
	/** `horizontal` (the default) or `vertical`: the strip stacks and the arrows turn with it. */
	readonly orientation?: unknown;
	/** The theme variant: nothing for the filled strip, or `line` for an underline. */
	readonly type?: unknown;
	/** How tall the tabs are: `sm`, `lg`, or nothing. A value or a cell. */
	readonly size?: unknown;
	/** What the strip is, read out by a screen reader. */
	readonly label?: unknown;
	/** Called with the value now showing, after the cell has been written. */
	readonly onChange?: (next: unknown, event: unknown) => void;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/** What `Tab` takes. Everything not named here goes to the `<button>`. */
export interface TabProps {
	/** What the group's value cell holds while this one is showing. */
	readonly value?: unknown;
	/** The words on it. Children work too. */
	readonly label?: unknown;
	/** Nobody can choose it, and the arrows step over it. A value or a cell. */
	readonly disabled?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/** What `TabPanel` takes. Everything not named here goes to the element. */
export interface TabPanelProps {
	/** The tab's value this panel belongs to. */
	readonly value?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

const ORPHAN = 'a Tab and a TabPanel go inside a Tabs; write '
	+ '<Tabs><mark.tabs><Tab value="one" label="One" /></mark.tabs>'
	+ '<mark.panels><TabPanel value="one">...</TabPanel></mark.panels></Tabs>';

const STRAY = (value: unknown): string =>
	`a TabPanel needs a Tab with the same value and no tab has ${JSON.stringify(value) ?? String(value)}; `
	+ 'give the panel the value of a tab, or add <Tab value={...} label="..." /> inside <mark.tabs>';

/**
 * One of the tabs in a strip.
 *
 * Params:
 *   props: `value`, `label`, `disabled`, `element`, and anything else, which goes to the element
 *   children: the label as markup, for anything `label` cannot say
 *
 * Returns: a `<button type="button" role="tab">` on the `tab` entry, naming its panel with
 * `aria-controls` and saying whether it is the one showing with `aria-selected`.
 *
 * Only meaningful inside a `Tabs`: the variant, the height, the ids and the value cell all come
 * from the group.
 *
 * Throws: an assert, loud in development and stripped in a release build, when there is no `Tabs`
 * above it.
 *
 * Example:
 *   <Tab value="drafts" label="Drafts" />
 */
export const Tab = (props: TabProps): Mounter => (elem, _item, before, context) => {
	const { value, label, disabled, element, theme, children, ...rest } = props;

	const group = groupAt(context);
	assert(group !== null, ORPHAN);
	if (group === null) return () => undefined;

	group.claim(value, disabled);
	const ids = group.ids(value);
	const showing = group.selected(value);
	const stop = group.stop(value);
	const states = controlStates(disabled, props);

	const node = h(elementFor(element, 'button'), {
		...rest,
		type: 'button',
		role: 'tab',
		id: ids.tab,
		'aria-controls': ids.panel,
		'aria-selected': through(showing, (on) => (on ? 'true' : 'false')),
		// A disabled tab is still read out and still stepped over by the arrows, which a
		// `disabled` attribute would take away along with the reading (design 203).
		'aria-disabled': through(disabled, (off) => (off ? 'true' : null)),
		// The strip is one stop in the Tab order. The behaviour keeps this moving; this is what
		// puts it in the markup, so a page rendered on a server arrives with the zero in place.
		tabindex: through(stop, (on) => (on ? '0' : '-1')),
		theme: ['tab', group.type, sizeSegments(group.size),
			through(showing, (on) => (on ? 'selected' : null)), theme, ...states.segments],
		isHovered: states.isHovered,
		isClicked: states.isClicked,
	}, label ?? null, ...(children ?? []));

	return mount(elem, node, before, context);
};

/**
 * What one tab shows.
 *
 * Params:
 *   props: `value`, `element`, and anything else, which goes to the element
 *   children: the panel's contents
 *
 * Returns: a `<div role="tabpanel" tabindex="0">` on the `tabs_panel` entry, named by its tab
 * through `aria-labelledby`. It is focusable because the second Tab press out of the strip has to
 * land somewhere, and a panel holding nothing focusable would swallow it.
 *
 * A panel that is not showing carries `hidden` and stays mounted, so coming back to it finds it as
 * it was left. Wrap the contents in a `Shown` to have them built again instead.
 *
 * Throws: an assert, loud in development and stripped in a release build, when there is no `Tabs`
 * above it.
 *
 * Example:
 *   <TabPanel value="drafts"><DraftList /></TabPanel>
 */
export const TabPanel = (props: TabPanelProps): Mounter => (elem, _item, before, context) => {
	const { value, element, theme, children, ...rest } = props;

	const group = groupAt(context);
	assert(group !== null, ORPHAN);
	if (group === null) return () => undefined;

	// The tabs are built before the panels, so by now every tab this group has said so. A panel
	// with no tab is markup nothing can reach and an `aria-controls` naming an id that is not on
	// the page, which no browser reports.
	assert(group.held(value), STRAY(value));

	const ids = group.ids(value);
	const showing = group.selected(value);

	const node = h(elementFor(element, 'div'), {
		...rest,
		role: 'tabpanel',
		id: ids.panel,
		'aria-labelledby': ids.tab,
		tabindex: '0',
		hidden: through(showing, (on) => !on),
		theme: ['tabs_panel', theme],
	}, ...(children ?? []));

	return mount(elem, node, before, context);
};

/**
 * A set of panels with one showing, and the strip that picks between them.
 *
 * Params:
 *   props: `value`, `tabs`, `orientation`, `type`, `size`, `label`, `onChange`, `element`, and
 *          anything else, which goes to the element
 *   children: `<mark.tabs>` holding `Tab`s and `<mark.panels>` holding `TabPanel`s, for anything
 *             `tabs` cannot say
 *
 * Returns: a `<div>` on the `tabs` entry holding a `<div role="tablist">` on `tabs_list` and one
 * panel per tab. Each tab and its panel name each other with `aria-controls` and
 * `aria-labelledby`, off ids minted from the render's counter, so a page rendered on a server and
 * the hydration that adopts it agree (design 109).
 *
 * The arrows move the selection as well as the focus, so Right steps to the next panel and shows
 * it. Home and End go to the ends, a disabled tab is stepped over, and Tab leaves the strip for
 * the panel rather than for the next tab.
 *
 * `type="line"` drops the filled strip for an underline under the tab showing. `orientation`
 * `vertical` stands the strip beside the panels and turns the arrows to Up and Down.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a bare child: the
 * tabs and the panels go in two different places, so each says which it is.
 *
 * Example:
 *   <Tabs label="Views" value={view} tabs={[
 *     { value: 'all', label: 'All', content: <All /> },
 *     { value: 'mine', label: 'Mine', content: <Mine /> },
 *   ]} />
 */
export const Tabs = (
	props: TabsProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// `mounted` is only taken while the component's own body runs, and the strip is not in the
	// document until one step later, so the callback is registered here and filled in there.
	let install = (): void => undefined;
	mounted(() => { install(); });

	return (elem, _item, before, context) => {
		const {
			value, tabs, orientation, type, size, label, onChange, element, theme, children, ...rest
		} = props;

		const owned = !isWritable(value);
		const cell = isWritable(value) ? value : mutable<unknown>(null);
		const render = use(context);

		// One pair of ids per value, minted on first ask and kept, so the tab and the panel of one
		// value name each other however far apart they were written and a list that grows a tab
		// leaves the ids of the tabs already there alone.
		const minted = new Map<unknown, TabIds>();
		const values = new Map<string, unknown>();
		// Every value a tab has ever been built for. It is what tells a value the cell was moved off
		// a tab that has since gone away apart from a value that was never a tab at all, and what a
		// panel checks before it names a tab that is not there.
		const seen = new Set<unknown>();

		// What is showing, and which tab carries the strip's one stop. Both are read off the value
		// cell and the `tabs` list together, so they cannot disagree with each other.
		const state = all([cell, tabs ?? null]).map(([held, list]) => {
			const items = Array.isArray(list) ? list as TabItem[] : [];
			// Tabs written out by hand are the caller's own markup: what the cell holds is what
			// shows, and taking one out is a change they made to their own tree.
			if (items.length === 0) return { value: held, stop: held };
			if (items.some((item) => item.value === held)) return { value: held, stop: held };
			const first = items.find((item) => !shut(item.disabled));
			// The tab the cell was on has gone out of the list. The first tab anyone may choose
			// takes its place, so the strip keeps a stop and a panel is on the page. A cell that was
			// never on a tab is left alone: nothing shows, and the first tab still takes the stop.
			if (seen.has(held) && first !== undefined) return { value: first.value, stop: first.value };
			return { value: NONE, stop: (first ?? items[0]!).value };
		});

		const group: TabsGroup = {
			ids: (held) => {
				let ids = minted.get(held);
				if (ids === undefined) {
					const at = render.ids.next('tab');
					ids = { tab: `${at}-tab`, panel: `${at}-panel` };
					minted.set(held, ids);
					values.set(ids.tab, held);
				}
				return ids;
			},
			// Only for a cell this component made, and never onto a tab nobody may choose: a
			// caller's own cell holding nothing means nothing is showing, and choosing for them
			// would be a write they did not ask for.
			claim: (held, off) => {
				seen.add(held);
				if (owned && cell.get() === null && !shut(off)) cell.set(held);
			},
			held: (held) => seen.has(held),
			selected: (held) => state.map((now) => now.value === held),
			stop: (held) => state.map((now) => now.stop === held),
			type,
			size,
		};
		const inner = withSlot(context, GROUP, group);

		// The cell follows the tab the strip stood in for, so the one source of truth stays the cell
		// and a caller watching `onChange` hears that the selection moved. There is no event behind
		// it, so the second argument is null. With no tab anyone may choose, nothing is written.
		cleanup(state.effect((now) => {
			if (now.value === NONE || cell.get() === now.value) return;
			cell.set(now.value);
			onChange?.(now.value, null);
		}));

		const choose = (held: unknown, event: unknown): void => {
			cell.set(held);
			onChange?.(held, event);
		};

		// The two slots, because a tab goes in the strip and its panel goes under it, and a
		// component may not read another component's props to tell them apart (design 202).
		const [strip, panes] = categories(children ?? [], ['tabs', 'panels']);

		const listed = (pick: (item: TabItem) => unknown): unknown =>
			through(tabs, (held) => (Array.isArray(held) ? (held as TabItem[]) : []).map(pick));

		const upright = through(orientation, (held) => held === 'vertical');
		const node = h(elementFor(element, 'div'), {
			...rest,
			theme: ['tabs', type, through(upright, (on) => (on ? 'vertical' : null)), theme],
		},
		h('div', {
			role: 'tablist',
			'aria-label': empty(label) ? null : label,
			'aria-orientation': through(upright, (on) => (on ? 'vertical' : null)),
			theme: ['tabs_list', through(upright, (on) => (on ? 'vertical' : null)), type],
		},
		listed((item) => h(Tab, { value: item.value, label: item.label, disabled: item.disabled })),
		...strip!.items),
		listed((item) => h(TabPanel, { value: item.value }, item.content ?? null)),
		...panes!.items);

		const remove = mount(elem, node, before, inner);
		// Read back out of the mount rather than kept from what was built: under a hydration the
		// element on the page is the server's and the one this made was dropped (design 133).
		const root = mountedElement(remove, before);

		// The teardown is registered now and filled in when the strip is in the document, because a
		// cleanup handed over from inside a `mounted` callback arrives after the list was taken.
		let stop = (): void => undefined;
		cleanup(() => { stop(); });
		install = () => {
			const list = find(root(), (found) =>
				(found as ElementLike).getAttribute('role') === 'tablist');
			stop = tabList(list, {
				onSelect: (item, event) => {
					const id = (item as ElementLike).getAttribute('id') ?? '';
					if (!values.has(id)) return;
					choose(values.get(id), event);
				},
			});
		};

		return remove;
	};
};
