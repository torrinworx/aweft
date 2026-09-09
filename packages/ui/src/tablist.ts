// One strip of choices the arrow keys move through, with one tab stop (design 203).
//
// A strip of tabs is one stop in the Tab order, not one per tab, so the arrows are what moves
// inside it and Tab is what leaves it. That is the roving index: the one showing carries
// `tabindex="0"` and every other carries `-1`. Arriving on a tab chooses it, so a person holding
// Right sees each panel in turn rather than choosing nothing until they press Enter.
//
// The reusable half is the key map and the roving index; which elements are the items is the
// parameter, so a menu can take this in a later pass by asking for another role.
//
// This is not exported. `Tabs` calls it; its own suite drives it directly.

import { findAll, within } from './tree.ts';

/** What a caller tells the tablist. */
export interface TabListOptions {
	/** Which elements inside the strip are the items. `tab` when omitted. */
	readonly role?: string;
	/** Called with the element that is now chosen, and the event that chose it. */
	readonly onSelect: (item: unknown, event: unknown) => void;
}

interface Listening {
	addEventListener?(type: string, listener: (event: unknown) => void): void;
	removeEventListener?(type: string, listener: (event: unknown) => void): void;
	getAttribute?(name: string): string | null;
}

interface Item {
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	focus?(): void;
}

/**
 * The arrow keys and the one tab stop of a strip of tabs.
 *
 * Params:
 *   element: the strip itself, the element carrying `role="tablist"`. Its items are read again on
 *            every event, so a strip that grows a tab is followed with nothing else to call
 *   options: `role`, the items' own role, and `onSelect`, called with the element now chosen
 *
 * Returns: the teardown, as every registration in this stack does. With no element to listen on it
 * installs nothing and removes nothing, which is what a static render wants.
 *
 * The keys: Right and Left move one item, wrapping at each end; Down and Up do instead when the
 * strip says `aria-orientation="vertical"`; Home and End go to the ends. A disabled item is
 * stepped over rather than landed on, and a click on one does nothing. Every move focuses the item
 * it landed on and reports it, so the selection follows the focus.
 *
 * Which item is chosen now is read off `aria-selected`, so the cell a component holds stays the one
 * source of truth and this never has a second opinion about it.
 *
 * The zero is settled again at the start of every event as well as at install, so a strip that lost
 * the item holding it has a tab stop again from the next thing that happens in it.
 *
 * Example:
 *   const stop = tabList(strip, { onSelect: (tab) => chosen.set(valueOf(tab)) });
 */
export const tabList = (element: unknown, options: TabListOptions): (() => void) => {
	const strip = element as Listening | null | undefined;
	if (strip === null || strip === undefined || typeof strip.addEventListener !== 'function') {
		return () => undefined;
	}
	const role = options.role ?? 'tab';

	const items = (): Item[] =>
		findAll(strip, (node) => (node as Item).getAttribute('role') === role) as Item[];

	// `aria-disabled` rather than the element's own `disabled`: a tab that cannot be chosen is still
	// something a screen reader should read out, and a disabled `<button>` is not.
	const live = (item: Item): boolean => item.getAttribute('aria-disabled') !== 'true';

	/** Where the roving zero belongs: on the chosen item, or on the first one that can take it. */
	const home = (all: Item[]): number => {
		const chosen = all.findIndex((item) => item.getAttribute('aria-selected') === 'true');
		if (chosen >= 0) return chosen;
		const first = all.findIndex(live);
		return first < 0 ? 0 : first;
	};

	const rove = (all: Item[], at: number): void => {
		for (let index = 0; index < all.length; index += 1) {
			all[index]!.setAttribute('tabindex', index === at ? '0' : '-1');
		}
	};

	/**
	 * Put the zero back when the strip has stopped having exactly one.
	 *
	 * The tab that held it can be taken out of the strip between two events, and then nothing in
	 * the strip is in the Tab order at all. The tabs are read again on every event, so the zero is
	 * settled again on every event too, before the event is looked at.
	 */
	const settle = (all: Item[]): void => {
		if (all.length === 0) return;
		if (all.filter((item) => item.getAttribute('tabindex') === '0').length === 1) return;
		rove(all, home(all));
	};

	/** One step from `from`, wrapping, over the items that can be landed on. */
	const step = (all: Item[], from: number, by: number): number => {
		let at = from;
		for (let tried = 0; tried < all.length; tried += 1) {
			at = (at + by + all.length) % all.length;
			if (live(all[at]!)) return at;
		}
		return -1;
	};

	/** The first item from one end that can be landed on. */
	const end = (all: Item[], by: number): number => {
		const at = by > 0 ? 0 : all.length - 1;
		if (all.length > 0 && live(all[at]!)) return at;
		return step(all, at, by);
	};

	const go = (all: Item[], at: number, event: unknown): void => {
		if (at < 0) return;
		rove(all, at);
		all[at]!.focus?.();
		options.onSelect(all[at], event);
	};

	/** Which item the event came out of, or -1 for one that came from somewhere else. */
	const from = (all: Item[], event: unknown): number =>
		all.findIndex((item) => within((event as { target?: unknown }).target ?? null, [item]));

	const onKey = (event: unknown): void => {
		const all = items();
		settle(all);
		const at = from(all, event);
		if (at < 0) return;
		const upright = strip.getAttribute?.('aria-orientation') === 'vertical';
		const key = (event as { key?: string }).key;
		let next = -1;
		if (key === (upright ? 'ArrowDown' : 'ArrowRight')) next = step(all, at, 1);
		else if (key === (upright ? 'ArrowUp' : 'ArrowLeft')) next = step(all, at, -1);
		else if (key === 'Home') next = end(all, 1);
		else if (key === 'End') next = end(all, -1);
		else return;
		// The page scrolls on an arrow and jumps on Home otherwise, and the person meant the strip.
		(event as { preventDefault?: () => void }).preventDefault?.();
		go(all, next, event);
	};

	const onClick = (event: unknown): void => {
		const all = items();
		settle(all);
		const at = from(all, event);
		if (at < 0 || !live(all[at]!)) return;
		go(all, at, event);
	};

	strip.addEventListener('keydown', onKey);
	strip.addEventListener('click', onClick);
	// The zero has to be somewhere before the first Tab press arrives.
	const all = items();
	if (all.length > 0) rove(all, home(all));

	return () => {
		strip.removeEventListener?.('keydown', onKey);
		strip.removeEventListener?.('click', onClick);
	};
};
