// A choice from a list, drawn by this package on every host (design 224).
//
// Three pieces. The closed control is a `<button role="combobox">` wearing the `select` entry, with
// the chevron of design 195 beside it. The open list is a `<div role="listbox">` in a popup
// `Detached` places under the control, on the keyboard map of `listbox.ts` (design 223). Under both
// sits a real `<select>`, off the screen and out of the reading order, so a form still posts the
// value and autofill still has something to find.
//
// The map between what a person reads and what the caller holds is design 130's and is unchanged:
// the cell holds the item that was put in `options`, never a string standing for it.

import { type ElementLike, type Mounter, mount } from '@aweftjs/dom';
import { all, mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { controlStates, elementFor, sizeSegments } from './control.ts';
import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { listBox } from './listbox.ts';
import { mark } from './mark.ts';
import { type Rect, type Placement } from './placement.ts';
import { Detached, mountedElement } from './popup.tsx';
import { isSource, isWritable, through } from './source.ts';
import { find, rootOf } from './tree.ts';

/** Under the control, and above it when there is no room below. */
const BELOW: readonly Placement[] = ['below-start', 'above-start'];

/** What `Select` takes. Everything not named here goes to the button. */
export interface SelectProps {
	/** The chosen item, a cell holding one of `options`. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The items to choose from: a list, or a cell holding one. */
	readonly options?: unknown;
	/** What each item reads as: a function of the item, or a list of strings read by position. */
	readonly display?: unknown;
	/** Shown while nothing is chosen, and not choosable itself. */
	readonly placeholder?: unknown;
	/** Whether the list is open, a cell. Absent, the component keeps its own. */
	readonly open?: unknown;
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
	/** What the form calls this field. Goes on the hidden element, which is what a form posts. */
	readonly name?: unknown;
	/** The autofill token, on the hidden element for the same reason. */
	readonly autocomplete?: unknown;
	/** Called with the item now chosen. */
	readonly onChange?: (next: unknown, event: unknown) => void;
	/** Decorate this node instead of building one. It is the `<button>`. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/** An item that is text or a number carries itself in the markup, so a form posts something. */
const isPlain = (item: unknown): boolean => typeof item === 'string' || typeof item === 'number';

/** Where the hidden element says the choice is now. */
const indexOf = (event: unknown): number => {
	const at = (event as { target?: { selectedIndex?: unknown } }).target?.selectedIndex;
	return typeof at === 'number' ? at : -1;
};

/**
 * A choice from a list.
 *
 * Params:
 *   props: `value`, `options`, `display`, `placeholder`, `open`, `label`, `description`, `error`,
 *          `disabled`, `type`, `size`, `name`, `autocomplete`, `onChange`, `element`, and anything
 *          else, which goes to the button
 *
 * Returns: a `<button role="combobox">` and a drawn list, inside a `<div>` with its label when it
 * was given one. The cell holds the item, never the text the person reads, so an object list comes
 * back as objects.
 *
 * The list is a `<div role="listbox">` of `<div role="option">` rows in a popup placed under the
 * control at the control's width, and it is this package's on every host. It opens on a click, on
 * ArrowDown, ArrowUp, Enter and Space, and on a printable character, which opens it and runs the
 * type-ahead in the one press. The whole keyboard map is design 223's.
 *
 * A hidden `<select>` carries the same options and the same choice, takes `name` and
 * `autocomplete`, and writes the cell when anything writes it. So a form posts the value and
 * autofill reaches the control, and what it cannot do is draw its own highlight over a button.
 *
 * `placeholder` shows while the cell holds nothing and is not a row in the list. A cell holding an
 * item the list does not have shows the placeholder and selects nothing.
 *
 * Throws: the assert `elementFor` makes for an `element` that is not a `<button>`.
 *
 * Example:
 *   <Select label="Size" value={size} options={['small', 'large']} />
 *   <Select value={user} options={users} display={(u) => u.name} placeholder="Pick someone" />
 */
export const Select = (
	props: SelectProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// `mounted` is only taken while the component's own body runs, and the button is not in the
	// document until one step later, so the callback is registered here and filled in there.
	let install = (): void => undefined;
	mounted(() => { install(); });

	return (elem, _item, before, context) => {
		const {
			value, options, display, placeholder, open, label, description, error,
			disabled, type, size, name, autocomplete, onChange, element, theme, ...rest
		} = props;

		// A state prop is a cell or absent. A plain value looks as though it was honoured and is not,
		// so it is a loud assert rather than a silent fallback, as `DropDown`'s `open` already was.
		assert(open === undefined || isWritable(open),
			'Select open takes a cell, not a value; pass open={cell}, or leave it out and the '
			+ 'component keeps its own');

		const cell = isWritable(value) ? value : mutable<unknown>(null);
		const showing = isWritable(open) ? open : mutable(false);
		const active = mutable<unknown>(null);
		const width = mutable<string | null>(null);
		const states = controlStates(disabled, props);
		const field = wireField(context, { label, description, error, id: rest['id'] });
		const listId = `${field.id}-list`;

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

		let button: unknown = null;
		const focusBack = (): void => { (button as { focus?: () => void } | null)?.focus?.(); };

		const choose = (next: unknown, event: unknown): void => {
			cell.set(next);
			onChange?.(next, event);
		};

		const shut = (back: boolean): void => {
			showing.set(false);
			active.set(null);
			if (back) focusBack();
		};

		// --- the drawn list ---------------------------------------------------------------------

		// The rows are mapped rather than mounted through `each`: each one carries the id
		// `aria-activedescendant` names, and a row built by cloning the first would carry the first
		// row's id (design 224). The hidden element below still uses `each`, which is where design
		// 130's "one option in, one option out" lives.
		const items = new Map<string, unknown>();
		const rows = through(options, (held) => {
			items.clear();
			return (Array.isArray(held) ? held : []).map((item, at) => {
				const id = `${listId}-${String(at)}`;
				items.set(id, item);
				return h('div', {
					id,
					role: 'option',
					'aria-selected': through(cell, (chosen) => (chosen === item ? 'true' : 'false')),
					// `active` after `selected`, so the row the keyboard is on is the one that shows:
					// a segment later in the list wins where two entries set the same property.
					theme: ['listbox_item', sizeSegments(size),
						through(cell, (chosen) => (chosen === item ? 'selected' : null)),
						through(active, (now) => (now === id ? 'active' : null))],
				}, textOf(item));
			});
		});

		const panel = h('div', {
			id: listId,
			role: 'listbox',
			'aria-labelledby': field.labelId,
			theme: ['listbox', sizeSegments(size)],
			// The list is the width of the control, measured rather than guessed: a `max-width` would
			// let one long option open a wider control than the one that was clicked.
			style: { width },
		}, rows);

		// --- the hidden element ------------------------------------------------------------------

		const Option = (row: { each?: unknown }): unknown => {
			const on = through(cell, (held) => held === row.each);
			return h('option', {
				// For the form and for anyone reading the markup; the choice does not go through it.
				value: isPlain(row.each) ? String(row.each) : null,
				selected: on,
				$selected: on,
			}, textOf(row.each));
		};

		const nothing = through(cell, (held) => held === null || held === undefined);
		const blank = empty(placeholder)
			? null
			: h('option', { value: '', disabled: true, hidden: true, selected: nothing, $selected: nothing },
				placeholder);
		const offset = blank === null ? 0 : 1;

		// Off the screen rather than `display: none`, because a control nothing renders is a control
		// autofill cannot find at all (design 224). `aria-hidden` and `tabindex` together: the button
		// is what a screen reader reads, and an `aria-hidden` element that can take the focus is a
		// defect in its own right.
		const native = h('select', {
			name: name ?? null,
			autocomplete: autocomplete ?? null,
			theme: ['offscreen'],
			'aria-hidden': 'true',
			tabindex: '-1',
			disabled,
			onChange: (event: unknown) => {
				const at = indexOf(event) - offset;
				const held = list();
				choose(at < 0 || at >= held.length ? null : held[at], event);
			},
		}, blank, h(Option, { each: options ?? [] }));

		// --- the control --------------------------------------------------------------------------

		// A cell holding something the list does not have reads as the placeholder, because that is
		// what the rest of the control already says: no row is selected and the hidden element is on
		// its blank option. A button reading a value nothing in the list can unpick is a control
		// nobody can put right.
		const shown = all([cell, options]).map(([held]) => {
			const chosen = held !== null && held !== undefined && list().indexOf(held) >= 0;
			return chosen ? textOf(held) : (empty(placeholder) ? null : placeholder);
		});

		const control = h(elementFor(element, 'button'), {
			...rest,
			...field.aria,
			type: 'button',
			role: 'combobox',
			'aria-haspopup': 'listbox',
			'aria-expanded': through(showing, (on) => (on ? 'true' : 'false')),
			'aria-controls': listId,
			// Named only while the list is there, because the id it names is not on the page
			// otherwise, and an activedescendant pointing at nothing is a control saying nothing.
			'aria-activedescendant': all([showing, active])
				.map(([on, id]) => (on === true && typeof id === 'string' ? id : null)),
			disabled,
			isHovered: states.isHovered,
			isClicked: states.isClicked,
			theme: ['select', type, sizeSegments(size),
				through(error, (held) => (empty(held) ? null : 'invalid')), theme, ...states.segments],
			onClick: () => {
				if (states.isDisabled()) return;
				if (showing.get() === true) shut(false);
				else showing.set(true);
			},
		}, shown);

		const wrap = h('span', { theme: ['select_wrap'] },
			control,
			h('span', { theme: ['select_chevron'], 'aria-hidden': 'true' }),
			native);

		const floating = h(Detached, {
			enabled: showing,
			locations: BELOW,
			onResize: (rect: Rect) => { width.set(`${String(Math.round(rect.width))}px`); },
		}, wrap, mark('popup', null, panel));

		const item = field.wrapped
			? h('div', { theme: ['field'] }, field.label(), floating, field.notes())
			: floating;
		const remove = mount(elem, item, before, context);
		// Read back out of the mount rather than kept from what was built: under a hydration the
		// element on the page is the server's and the one this made was dropped (design 133).
		const root = mountedElement(remove, before);

		// The list is at the popup sink, which is the end of the page and not under this component's
		// own run, so it is found from the top of the tree by the id the control already names.
		let found: unknown = null;
		const panelAt = (): unknown => {
			if (found === null) {
				found = find(rootOf(button), (node) => (node as ElementLike).getAttribute('id') === listId);
			}
			return found;
		};

		const idFor = (held: unknown): string | null => {
			for (const [id, held2] of items) if (held2 === held) return id;
			return null;
		};

		// Opening measures the control, so the list is its width from the first frame, and puts the
		// keyboard on the chosen row rather than making the first arrow settle it.
		cleanup(showing.effect((on) => {
			if (on !== true) return;
			const box = (button as { getBoundingClientRect?: () => Rect } | null)?.getBoundingClientRect?.();
			if (box !== undefined) width.set(`${String(Math.round(box.width))}px`);
			active.set(idFor(cell.get()));
		}));

		let stop = (): void => undefined;
		cleanup(() => { stop(); });
		install = () => {
			button = find(root(), (node) => (node as ElementLike).getAttribute('role') === 'combobox');
			stop = listBox(button, {
				list: panelAt,
				open: showing,
				active,
				onOpen: () => { if (!states.isDisabled()) showing.set(true); },
				onClose: (reason) => { shut(reason === 'escape'); },
				onPick: (picked, event) => {
					const id = (picked as ElementLike).getAttribute('id') ?? '';
					if (!items.has(id)) return;
					choose(items.get(id), event);
					shut(true);
				},
			});
		};

		return remove;
	};
};
