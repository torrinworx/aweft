// A choice from a list, on the platform's own select (design 130).
//
// The element carries text and the caller carries whatever it likes, so the map between the two
// lives here, and it is the element's own selection rather than a string written into a row: the
// chosen option says it is chosen, and a change is read back as the position it happened at. A row
// built for one item stays that item's row wherever the list moves it.
//
// The one thing this draws is the arrow (design 195). Every host draws a different one and the
// theme cannot reach any of them, so the host is told to draw none and the component puts an empty
// box beside the element for the `select_chevron` entry to draw the chevron in.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { controlStates, elementFor, sizeSegments } from './control.ts';
import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { isSource, isWritable, through } from './source.ts';

/** What `Select` takes. Everything not named here goes to the element. */
export interface SelectProps {
	/** The chosen item, a cell holding one of `options`. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The items to choose from: a list, or a cell holding one. */
	readonly options?: unknown;
	/** What each item reads as: a function of the item, or a list of strings read by position. */
	readonly display?: unknown;
	/** Shown while nothing is chosen, and not choosable itself. */
	readonly placeholder?: unknown;
	/** The label above it. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with the choice. */
	readonly error?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** How tall it is: `sm`, `lg`, or nothing for the default. A value or a cell. */
	readonly size?: unknown;
	/** Called with the item now chosen. */
	readonly onChange?: (next: unknown, event: unknown) => void;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/** An item that is text or a number carries itself in the markup, so a form posts something. */
const isPlain = (item: unknown): boolean => typeof item === 'string' || typeof item === 'number';

/** Where the element says the choice is now. */
const indexOf = (event: unknown): number => {
	const at = (event as { target?: { selectedIndex?: unknown } }).target?.selectedIndex;
	return typeof at === 'number' ? at : -1;
};

/**
 * A choice from a list.
 *
 * Params:
 *   props: `value`, `options`, `display`, `placeholder`, `label`, `description`, `error`,
 *          `disabled`, `type`, `size`, `onChange`, `element`, and anything else, which goes to
 *          the `<select>`
 *
 * Returns: a `<select>` with one `<option>` per item, inside a `<div>` with its label when it was
 * given one. The cell holds the item, never the string the element carries, so an object list
 * comes back as objects.
 *
 * The choice is the element's own selection: the chosen option carries `selected`, and a change is
 * read back as the position it happened at. So inserting, removing or reordering `options` leaves
 * the choice on the item it was on.
 *
 * `placeholder` is a disabled option that shows while the cell holds nothing and cannot be chosen
 * back. A cell holding an item the list does not have selects nothing at all.
 *
 * Two limits, from the element rather than from this component: outside Chromium the open list is
 * drawn by the host and is not themed, and there is no way to know whether it is open. Design 130
 * has both, and what to reach for instead.
 *
 * Example:
 *   <Select label="Size" value={size} options={['small', 'large']} />
 *   <Select value={user} options={users} display={(u) => u.name} placeholder="Pick someone" />
 */
export const Select = (props: SelectProps): Mounter => (elem, _item, before, context) => {
	const {
		value, options, display, placeholder, label, description, error,
		disabled, type, size, onChange, element, theme, ...rest
	} = props;

	const cell = isWritable(value) ? value : mutable<unknown>(null);
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	const list = (): unknown[] => {
		const held = isSource(options) ? options.get() : options;
		return Array.isArray(held) ? held : [];
	};

	const textOf = (item: unknown): string => {
		if (typeof display === 'function') return String((display as (item: unknown) => unknown)(item));
		if (Array.isArray(display)) {
			const at = list().indexOf(item);
			return String(at < 0 ? item : display[at] ?? item);
		}
		return String(item);
	};

	// A row says whether it is the chosen one, as the attribute a static render writes and as the
	// property a live element answers to. Nothing here compares strings, so two items that read the
	// same, and an item that is the empty string, each keep their own row.
	const chosen = (item: unknown): unknown => through(cell, (held) => held === item);

	const Option = (row: { each?: unknown }): unknown => {
		const on = chosen(row.each);
		return h('option', {
			// The value is for the form the select is in and for anyone reading the markup; the
			// choice does not go through it.
			value: isPlain(row.each) ? String(row.each) : null,
			selected: on,
			$selected: on,
			theme: ['option'],
		}, textOf(row.each));
	};

	const nothing = through(cell, (held) => held === null || held === undefined);
	const blank = empty(placeholder)
		? null
		// Disabled so it cannot be chosen back, hidden so it is not in the open list, and selected
		// while the cell holds nothing.
		: h('option', {
			value: '', disabled: true, hidden: true, selected: nothing, $selected: nothing,
		}, placeholder);
	const offset = blank === null ? 0 : 1;

	const picker = h(elementFor(element, 'select'), {
		...rest,
		...field.aria,
		theme: ['select', type, sizeSegments(size), through(error, (held) => (empty(held) ? null : 'invalid')), theme, ...states.segments],
		disabled,
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onChange: (event: unknown) => {
			const at = indexOf(event) - offset;
			const held = list();
			const next = at < 0 || at >= held.length ? null : held[at];
			cell.set(next);
			onChange?.(next, event);
		},
	}, blank, h(Option, { each: options ?? [] }));

	// The element and the arrow, in a box the arrow can be placed against. The arrow is an empty
	// span the theme draws two borders on, and it is `aria-hidden` and out of the reading order:
	// the control beside it is what a screen reader announces, and it already says it is a combobox.
	const wrap = h('span', { theme: ['select_wrap'] },
		picker,
		h('span', { theme: ['select_chevron'], 'aria-hidden': 'true' }));

	const item = field.wrapped
		? h('div', { theme: ['field'] }, field.label(), wrap, field.notes())
		: wrap;
	return mount(elem, item, before, context);
};
