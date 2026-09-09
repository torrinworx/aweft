// A button and the list of actions it opens (design 225).
//
// The same two pieces `Select` is built from: `Detached` places the list and `listbox.ts` holds the
// keys, asked for `menuitem` rather than `option`. What is left here is the markup, the ids, and
// what picking a row means, which is calling the row's own `onSelect`.

import { type ElementLike, type Mounter, mount } from '@aweftjs/dom';
import { all, mutable } from '@aweftjs/core';

import { Button } from './button.tsx';
import { assert } from './assert.ts';
import { listBox } from './listbox.ts';
import { mark } from './mark.ts';
import { type Placement } from './placement.ts';
import { Detached, mountedElement } from './popup.tsx';
import { h } from './h.ts';
import { sizeSegments } from './control.ts';
import { isSource, isWritable, through } from './source.ts';
import { use } from './render.ts';
import { find, rootOf } from './tree.ts';

/** Under the anchor, and above it when there is no room below. */
const BELOW: readonly Placement[] = ['below-start', 'above-start'];

/** One action in a menu. */
export interface MenuItem {
	/** The words on the row. */
	readonly label?: unknown;
	/** Something beside them. Anything mountable. */
	readonly icon?: unknown;
	/** The row's variant. `danger` draws it in `$danger`. */
	readonly type?: unknown;
	/** Nobody can choose it, and the arrows step over it. */
	readonly disabled?: unknown;
	/** Called with the event that chose it, after the menu has closed. */
	readonly onSelect?: (event: unknown) => void;
}

/** A run of actions under a heading. */
export interface MenuGroup {
	/** The words over the group. */
	readonly heading?: unknown;
	/** What is under it. */
	readonly items?: readonly MenuItem[];
}

/** What `Menu` takes. Everything not named here goes to the anchor button. */
export interface MenuProps {
	/** The actions: items, groups, or a mix of the two. A list, or a cell holding one. */
	readonly items?: unknown;
	/** Whether the menu is open, a cell. Absent, the component keeps its own. */
	readonly open?: unknown;
	/** The words on the anchor. */
	readonly label?: unknown;
	/** An icon on the anchor. */
	readonly icon?: unknown;
	/** The anchor's variant. */
	readonly type?: unknown;
	/** How tall the anchor and the rows are: `sm`, `lg`, or nothing. A value or a cell. */
	readonly size?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The placements to try, in order. Below the anchor and then above it when omitted. */
	readonly locations?: readonly Placement[];
	/** Decorate this node instead of building one. It is the anchor `<button>`. */
	readonly element?: unknown;
	/** Extra theme segments, appended to the anchor's own. */
	readonly theme?: unknown;
	/** The anchor's contents, for anything `label` and `icon` cannot say. */
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * Whether an entry in `items` is a group rather than one action. A heading makes it one on its own:
 * a group with nothing under it yet is a heading and no rows, not a row with no words on it.
 */
const isGroup = (entry: unknown): entry is MenuGroup =>
	typeof entry === 'object' && entry !== null && ('items' in entry || 'heading' in entry);

/**
 * A button and the actions it opens.
 *
 * Params:
 *   props: `items`, `open`, `label`, `icon`, `type`, `size`, `disabled`, `locations`, `element`,
 *          and anything else, which goes to the anchor button
 *   children: the anchor's contents, beside or instead of `label`
 *
 * Returns: a `Button` where it was written, and a `<div role="menu">` of `<div role="menuitem">`
 * rows in a popup placed under it, flipping above when there is no room below.
 *
 * An item is `{ label, icon?, type?, disabled?, onSelect }`, and `type: 'danger'` draws the row in
 * the danger colour. A group is `{ heading, items }` and draws a small heading over its own rows.
 *
 * The keys are design 223's, the same map a `Select` uses: the arrows move and wrap, Home and End
 * go to the ends, typing moves by what a row reads, Enter and Space choose, Escape and Tab close.
 * Escape and an outside click close it, and Escape and choosing put the focus back on the anchor.
 *
 * Opening moves the focus onto the `role="menu"` element, which is the ARIA menu-button pattern and
 * where `aria-activedescendant` names the row the keys are on. The anchor carries none of that: a
 * `role="button"` may not (design 225).
 *
 * The anchor is the button this component builds, so the ARIA is in the markup rather than written
 * onto somebody else's node. Give it your own contents as children, or hand the element in.
 *
 * The list goes in the nearest `<dialog>` above it, then a `PopupContext`, then the page, so a menu
 * inside a modal opens inside that modal and can be clicked.
 *
 * Example:
 *   <Menu label="Actions" items={[
 *     { label: 'Rename', onSelect: rename },
 *     { label: 'Delete', type: 'danger', onSelect: remove },
 *   ]} />
 */
export const Menu = (
	props: MenuProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// The anchor is not in the document until one step after the body runs, so the callback is
	// registered here and filled in there.
	let install = (): void => undefined;
	mounted(() => { install(); });

	return (elem, _item, before, context) => {
		const {
			items, open, label, icon, type, size, disabled, locations, element, theme, children, ...rest
		} = props;

		assert(open === undefined || isWritable(open),
			'Menu open takes a cell, not a value; pass open={cell}, or leave it out and the '
			+ 'component keeps its own');

		const showing = isWritable(open) ? open : mutable(false);
		const active = mutable<unknown>(null);
		const render = use(context);
		// A caller's own id wins, as it does on every control, so a page that names its buttons keeps
		// its names and the menu still has something to point `aria-labelledby` at.
		const id = rest['id'] === undefined || rest['id'] === null
			? render.ids.next('menu')
			: String(rest['id']);
		const listId = `${id}-list`;

		let anchor: unknown = null;
		const focusBack = (): void => { (anchor as { focus?: () => void } | null)?.focus?.(); };

		const shut = (back: boolean): void => {
			showing.set(false);
			active.set(null);
			if (back) focusBack();
		};

		// The rows, and what each id means. Mapped rather than mounted through `each` for the reason
		// design 224 gives: a row carries the id `aria-activedescendant` names, and a cloned row
		// would carry the first row's.
		const actions = new Map<string, MenuItem>();

		const row = (item: MenuItem, at: number): unknown => {
			const rowId = `${listId}-${String(at)}`;
			actions.set(rowId, item);
			return h('div', {
				id: rowId,
				role: 'menuitem',
				'aria-disabled': item.disabled === true ? 'true' : null,
				theme: ['menu_item', item.type, sizeSegments(size),
					through(active, (now) => (now === rowId ? 'active' : null))],
			}, item.icon ?? null, item.label ?? null);
		};

		const rows = through(items, (held) => {
			actions.clear();
			let at = 0;
			return (Array.isArray(held) ? held : []).map((entry: unknown, group: number) => {
				if (!isGroup(entry)) return row(entry as MenuItem, at++);
				const headingId = `${listId}-heading-${String(group)}`;
				return h('div', { role: 'group', 'aria-labelledby': headingId, theme: ['menu_group'] },
					// Marked presentational, so the rows are the only things the menu owns and a
					// heading is read as the group's name rather than as an item nobody can choose.
					h('div', { id: headingId, role: 'presentation', theme: ['menu_heading'] }, entry.heading ?? null),
					...(entry.items ?? []).map((one) => row(one, at++)));
			});
		});

		const panel = h('div', {
			id: listId,
			role: 'menu',
			'aria-labelledby': id,
			// The focus moves in here when the menu opens, so the element has to be able to take it,
			// and the active row is named from here. ARIA allows `aria-activedescendant` on a
			// `role="menu"` and not on the `role="button"` that opens one (designs 223, 225).
			tabindex: '-1',
			'aria-activedescendant': all([showing, active])
				.map(([on, held]) => (on === true && typeof held === 'string' ? held : null)),
			theme: ['menu', sizeSegments(size)],
		}, rows);

		const anchorNode = h(Button, {
			...rest,
			id,
			label,
			icon,
			type,
			size,
			disabled,
			element,
			theme,
			'aria-haspopup': 'menu',
			'aria-expanded': through(showing, (on) => (on ? 'true' : 'false')),
			'aria-controls': listId,
			onClick: () => {
				if (showing.get() === true) shut(false);
				else showing.set(true);
			},
		}, ...(children ?? []));

		const remove = mount(elem, h(Detached, {
			enabled: showing,
			locations: locations ?? BELOW,
		}, anchorNode, mark('popup', null, panel)), before, context);
		const root = mountedElement(remove, before);

		// The list is at the popup sink, which is the end of the page and not under this component's
		// own run, so it is found from the top of the tree by the id the anchor already names.
		let found: unknown = null;
		const panelAt = (): unknown => {
			if (found === null) {
				found = find(rootOf(anchor), (node) => (node as ElementLike).getAttribute('id') === listId);
			}
			return found;
		};

		let stop = (): void => undefined;
		cleanup(() => { stop(); });
		install = () => {
			anchor = find(root(), (node) => (node as ElementLike).getAttribute('id') === id);
			stop = listBox(anchor, {
				list: panelAt,
				role: 'menuitem',
				open: showing,
				active,
				onOpen: () => {
					if (Boolean(isSource(disabled) ? disabled.get() : disabled)) return;
					showing.set(true);
				},
				onClose: (reason) => { shut(reason === 'escape'); },
				onPick: (picked, event) => {
					const rowId = (picked as ElementLike).getAttribute('id') ?? '';
					const item = actions.get(rowId);
					if (item === undefined) return;
					// Closed first, so a handler that opens something of its own is not opening it
					// underneath a menu that is still on the screen.
					shut(true);
					item.onSelect?.(event);
				},
			});
		};

		return remove;
	};
};
