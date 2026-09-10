// The keyboard and the focus map of a popup list of options (design 223).
//
// One map for a select's options and for a menu's actions: the arrows, Home and End, type-ahead,
// Enter and Space to pick, Escape and Tab to close. Which elements are the options is the `role`
// parameter, so a menu asks for `menuitem` and a select asks for `option` and there is one file
// under both.
//
// `role` also says where the focus and the active id go while the list is open (design 223). An
// `option` list keeps both on the trigger, which is a `role="combobox"` and may carry
// `aria-activedescendant`. A `menuitem` list takes the focus into the list itself, which is the
// ARIA menu-button pattern and the only shape ARIA allows, because the trigger there is a
// `role="button"` and a button may not carry the attribute.
//
// The keys are listened for on whichever of the two holds the focus, and the pointer is listened
// for at the document: the list is made when the popup opens, and a listener put on it at install
// time would be put on nothing.
//
// This is not exported. `Select` and `Menu` call it; its own suite drives it directly.

import { dismiss } from './dismiss.ts';
import { type Source } from './source.ts';
import { findAll, within } from './tree.ts';

/** The cell the behaviour writes: the id of the option the keys are on, or null. */
export interface ActiveCell {
	get(): unknown;
	set(value: unknown): void;
}

/** What a caller tells the listbox. */
export interface ListBoxOptions {
	/** The element holding the options, or nothing while there is none. Read on every event. */
	readonly list: () => unknown;
	/** Which elements inside it are the options. `option` when omitted. */
	readonly role?: string | undefined;
	/** Whether the list is showing, as a cell. Read on every event, and watched for the opening. */
	readonly open: Source;
	/** The id of the option the keys are on. Written here and read by the component. */
	readonly active: ActiveCell;
	/** Open it, for a key pressed while it is closed. */
	readonly onOpen?: (event: unknown) => void;
	/** Close it. The reason is `escape`, `tab`, `outside` or `pick`. */
	readonly onClose: (reason: string, event: unknown) => void;
	/** Called with the option element that was chosen. */
	readonly onPick: (item: unknown, event: unknown) => void;
	/**
	 * Whether a printable character runs the type-ahead. On when omitted. Off for a list a person
	 * types into: the type-ahead swallows the key it acts on, and a search box never sees a
	 * character whose keydown was defaulted away (design 250).
	 */
	readonly typeahead?: boolean | undefined;
	/**
	 * Nodes a mousedown inside does not dismiss, beside the trigger and the list. A list inside a
	 * dialog hands over the dialog, so a press on its heading is not a press outside the list.
	 */
	readonly inside?: (() => readonly unknown[]) | undefined;
}

interface Listening {
	addEventListener?(type: string, listener: (event: unknown) => void): void;
	removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

interface Item {
	getAttribute(name: string): string | null;
	readonly textContent?: unknown;
}

interface Focusable {
	focus?(): void;
}

/** How long a type-ahead buffer lives after the last key, in milliseconds. */
const TYPEAHEAD = 700;

/** A key that is one character a person typed, rather than a name like `ArrowDown`. */
const printable = (key: string): boolean => key.length === 1 && key !== ' ';

/**
 * The keys, the pointer and the dismissal of a popup list of options.
 *
 * Params:
 *   element: the trigger, which is the button that opens the list and holds the focus while it is
 *            closed
 *   options: the list, the role its options carry, the open cell, the active cell, and the three
 *            callbacks
 *
 * Returns: the teardown, as every registration in this stack does. With no element to listen on it
 * installs nothing and removes nothing, which is what a static render wants.
 *
 * With `role: 'menuitem'` the list takes the focus as it opens and the keys arrive there, so the
 * component writes `aria-activedescendant` on the list; with `option` the focus and the attribute
 * both stay on the trigger. Putting the focus back when it closes is the component's either way.
 *
 * The keys, open: Down and Up move one option and wrap at each end, Home and End go to the ends, a
 * printable character runs the type-ahead, Enter and Space pick the active option, Escape closes
 * and Tab closes and is left alone so the focus moves on. Closed: Down, Up, Enter and Space open
 * it, and a printable character opens it and runs the type-ahead in the one press.
 *
 * The type-ahead searches the options' text for the buffer, from after the active option and
 * wrapping. A pause longer than 700ms starts a new search, and a buffer of one character repeated
 * steps through the options beginning with it. With `typeahead: false` a printable character is
 * left alone in both states, which is what a list with a search box over it wants: the character
 * has to reach the box, and a key this swallows never gets there.
 *
 * `inside` widens the dismissal, which otherwise reads the trigger and the list. A list inside a
 * dialog hands the dialog over, so a press on the dialog's own heading is inside.
 *
 * An option carrying `aria-disabled="true"` is stepped over and cannot be picked. The active cell
 * is settled at the start of every event: an id naming no option is replaced by the one carrying
 * `aria-selected="true"`, or by the first option that can be landed on.
 *
 * Example:
 *   const stop = listBox(button, {
 *     list: () => panel, open, active,
 *     onOpen: () => open.set(true),
 *     onClose: () => open.set(false),
 *     onPick: (item) => choose(item),
 *   });
 */
export const listBox = (element: unknown, options: ListBoxOptions): (() => void) => {
	const trigger = element as Listening | null | undefined;
	if (trigger === null || trigger === undefined || typeof trigger.addEventListener !== 'function') {
		return () => undefined;
	}
	const role = options.role ?? 'option';
	const typeahead = options.typeahead ?? true;
	// Where the focus lives while the list is open. See the head of this file: ARIA allows
	// `aria-activedescendant` on the combobox a select opens from and not on the button a menu does.
	const intoList = role === 'menuitem';
	const isOpen = (): boolean => options.open.get() === true;

	const items = (): Item[] =>
		findAll(options.list(), (node) => (node as Item).getAttribute('role') === role) as Item[];

	// `aria-disabled` rather than the element's own `disabled`, for design 203's reason: an option
	// nobody may choose is still something a screen reader should read out.
	const live = (item: Item): boolean => item.getAttribute('aria-disabled') !== 'true';
	const idOf = (item: Item): string => item.getAttribute('id') ?? '';
	const textOf = (item: Item): string => String(item.textContent ?? '').trim().toLowerCase();

	/** Where the active cell points now, or -1 when it names no option in this list. */
	const at = (all: Item[]): number => {
		const held = options.active.get();
		if (held === null || held === undefined) return -1;
		return all.findIndex((item) => idOf(item) === held);
	};

	/** Where it belongs when it names none: on the chosen option, or on the first that can take it. */
	const home = (all: Item[]): number => {
		const chosen = all.findIndex((item) => item.getAttribute('aria-selected') === 'true');
		if (chosen >= 0 && live(all[chosen]!)) return chosen;
		return all.findIndex(live);
	};

	const go = (all: Item[], to: number): void => {
		if (to < 0) return;
		options.active.set(idOf(all[to]!));
	};

	/** One step from `from`, wrapping, over the options that can be landed on. */
	const step = (all: Item[], from: number, by: number): number => {
		if (all.length === 0) return -1;
		// Nothing active yet, so a step is an arrival: down lands on the first, up on the last.
		if (from < 0) return end(all, by);
		let index = from;
		for (let tried = 0; tried < all.length; tried += 1) {
			index = (index + by + all.length) % all.length;
			if (live(all[index]!)) return index;
		}
		return -1;
	};

	/** The first option from one end that can be landed on. */
	const end = (all: Item[], by: number): number => {
		const from = by > 0 ? 0 : all.length - 1;
		if (all.length > 0 && live(all[from]!)) return from;
		return step(all, from, by);
	};

	let buffer = '';
	let typed = 0;

	/** Where the type-ahead lands after this character, or -1 for nothing matching. */
	const search = (all: Item[], character: string, now: number): number => {
		if (now - typed > TYPEAHEAD) buffer = '';
		typed = now;
		buffer += character.toLowerCase();

		// One character held down is a request for the next option beginning with it, not for a
		// run of that character, which nothing is ever called.
		const repeated = buffer.length > 1 && [...buffer].every((one) => one === buffer[0]);
		const query = repeated ? buffer[0]! : buffer;
		const here = at(all);
		// A buffer that is growing keeps searching from the option it already found; a fresh one
		// starts after it, so pressing the same letter twice moves on.
		const from = buffer.length > 1 && !repeated ? here : here + 1;

		for (let tried = 0; tried < all.length; tried += 1) {
			const index = ((from + tried) % all.length + all.length) % all.length;
			const item = all[index]!;
			if (live(item) && textOf(item).startsWith(query)) return index;
		}
		return -1;
	};

	const onKey = (event: unknown): void => {
		const key = String((event as { key?: unknown }).key ?? '');
		const swallow = (): void => { (event as { preventDefault?: () => void }).preventDefault?.(); };

		if (!isOpen()) {
			if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
				swallow();
				options.onOpen?.(event);
				const all = items();
				if (key === 'ArrowDown') go(all, end(all, 1));
				else if (key === 'ArrowUp') go(all, end(all, -1));
				else if (at(all) < 0) go(all, home(all));
				return;
			}
			if (!printable(key) || !typeahead) return;
			swallow();
			options.onOpen?.(event);
			const all = items();
			go(all, search(all, key, Date.now()));
			return;
		}

		const all = items();
		// Settled, but only where the cell names an option this list does not have: a cell holding
		// nothing is a list nobody has arrived in yet, and an arrow into one is an arrival at its
		// end rather than a step from its start.
		const held = options.active.get();
		if (held !== null && held !== undefined && at(all) < 0) go(all, home(all));

		// Tab is the one key here whose own default is the point: closing and letting the focus move
		// on is what the person asked for.
		if (key === 'Tab') {
			options.onClose('tab', event);
			return;
		}
		if (key === 'Escape') {
			swallow();
			options.onClose('escape', event);
			return;
		}
		if (key === 'Enter' || key === ' ') {
			swallow();
			const on = at(all);
			if (on >= 0) options.onPick(all[on], event);
			return;
		}
		if (key === 'ArrowDown') go(all, step(all, at(all), 1));
		else if (key === 'ArrowUp') go(all, step(all, at(all), -1));
		else if (key === 'Home') go(all, end(all, 1));
		else if (key === 'End') go(all, end(all, -1));
		else if (printable(key) && typeahead) go(all, search(all, key, Date.now()));
		else return;
		// The page scrolls under an arrow and jumps under Home, and the person meant the list.
		swallow();
	};

	/** The option the event landed in, or null for an event from somewhere else. */
	const optionFrom = (event: unknown): Item | null => {
		const target = (event as { target?: unknown }).target ?? null;
		return items().find((item) => within(target, [item])) ?? null;
	};

	const onOver = (event: unknown): void => {
		if (!isOpen()) return;
		const item = optionFrom(event);
		if (item === null || !live(item)) return;
		options.active.set(idOf(item));
	};

	const onClick = (event: unknown): void => {
		if (!isOpen()) return;
		const item = optionFrom(event);
		if (item === null || !live(item)) return;
		options.onPick(item, event);
	};

	trigger.addEventListener('keydown', onKey);

	// The keys on the list itself, for a `menuitem` list, whose focus is in it while it is open. The
	// list element only exists once the popup has mounted, so it is picked up as the list opens
	// rather than at install time, and the trigger keeps its own listener so the frame before the
	// focus has actually moved is not a frame of dead keys.
	let listening: Listening | null = null;
	const listen = (on: boolean): void => {
		const list = (on ? options.list() : null) as Listening | null;
		if (list === listening) return;
		listening?.removeEventListener?.('keydown', onKey);
		listening = list;
		listening?.addEventListener?.('keydown', onKey);
	};

	// `Detached` lays a popup out hidden for the one frame between opening it and knowing where it
	// goes, and a hidden element cannot take the focus, so the frame after is tried as well.
	const focusList = (): void => {
		const list = options.list() as Focusable | null;
		list?.focus?.();
		const seat = (globalThis as { document?: { activeElement?: unknown } }).document;
		if (seat === undefined || seat.activeElement === list) return;
		const request = (globalThis as { requestAnimationFrame?: (fn: () => void) => number })
			.requestAnimationFrame;
		request?.(() => {
			if (!isOpen()) return;
			(options.list() as Focusable | null)?.focus?.();
		});
	};

	const stopOpen = !intoList ? () => undefined : options.open.effect((on) => {
		listen(on === true);
		if (on === true) focusList();
	});

	// At the document, because the list is made when the popup opens. With no page there is nothing
	// to listen to, which is what a static render and the light tree want.
	const page = (globalThis as { document?: Listening }).document;
	const watching = page !== undefined && typeof page.addEventListener === 'function' ? page : null;
	watching?.addEventListener?.('mouseover', onOver);
	watching?.addEventListener?.('click', onClick);

	// The outside click is the dismiss behaviour (design 129), asked for its mousedown half only:
	// Escape is in the key map above, which is listened for on whichever of the trigger and the list
	// holds the focus, so it always arrives.
	const stopDismiss = dismiss({
		inside: () => {
			const list = options.list();
			const own = options.inside?.() ?? [];
			return list === null || list === undefined ? [element, ...own] : [element, list, ...own];
		},
		active: isOpen,
		onDismiss: (event) => { options.onClose('outside', event); },
	});

	return () => {
		stopOpen();
		listen(false);
		trigger.removeEventListener?.('keydown', onKey);
		watching?.removeEventListener?.('mouseover', onOver);
		watching?.removeEventListener?.('click', onClick);
		stopDismiss();
	};
};
