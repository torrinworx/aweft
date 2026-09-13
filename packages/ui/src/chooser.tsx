// A button, a modal dialog, a search box and a grid of options (design 250).
//
// This is not exported. `Country` and `Region` are what it is given, and a public chooser over any
// list is a different component with a different question to answer.
//
// Three pieces, and each of them is already this package's. The closed control is a
// `<button aria-haspopup="dialog">` on the `chooser` entry. The dialog is a `<dialog>` driven by
// `dialogControl`, which is what `Modal` drives its own with (design 129). Inside it, the search box
// is the `<input role="combobox">` the keys arrive at and the grid is a `<div role="listbox">` of
// `<div role="option">` rows, on the keyboard map of `listbox.ts` (design 223) with the type-ahead
// off, because a printable character is the search box's.
//
// Under all of it sits a real `<select>`, off the screen and out of the reading order, so a form
// posts the code and autofill has something to find, the way `Select` does it (design 224).
//
// `open` is the one truth about whether the dialog is showing. Every way out of it writes that cell
// and one effect drives the element, so the close button, Escape, the backdrop and a page setting
// the cell all take the same path.

import { type ElementLike, type Mounter, mount } from '@aweftjs/dom';
import { all, mutable } from '@aweftjs/core';

import { Button } from './button.tsx';
import { Icon } from './icon.tsx';
import { TextField } from './text-field.tsx';
import { assert } from './assert.ts';
import { controlStates, elementFor, sizeSegments } from './control.ts';
import { dialogControl } from './dialog.ts';
import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { text } from './text.ts';
import { listBox } from './listbox.ts';
import { mountedElement } from './popup.tsx';
import { isSource, isWritable, through } from './source.ts';
import { find } from './tree.ts';

/** One row of the grid. */
export interface ChooserItem {
	/** What the cell holds when this row is chosen, and what a form posts. */
	readonly value: string;
	/** What a person reads. */
	readonly label: string;
	/** The line under the label, smaller: the code, or nothing. */
	readonly note?: string;
	/** Drawn before the label: a flag, an icon, nothing. */
	readonly leading?: unknown;
	/** What the search matches. Lowercase and without accents, which `plain` is for. */
	readonly terms: readonly string[];
	/** Whether this is the row the host was guessed to be in. */
	readonly suggested?: boolean;
}

/** What `Chooser` takes. Everything not named here goes to the button. */
export interface ChooserProps {
	/** The chosen row's `value`, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The rows, in the order they are listed: a list, or a cell holding one. */
	readonly items?: unknown;
	/** Whether the dialog is open, a cell. Absent, the component keeps its own. */
	readonly open?: unknown;
	/** The label above the button. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with the choice. */
	readonly error?: unknown;
	/** Shown on the button while nothing is chosen. */
	readonly placeholder?: unknown;
	/** The dialog's heading, which is also what labels the dialog and the grid. */
	readonly title?: unknown;
	/** What the search box says while it is empty. */
	readonly search?: unknown;
	/** What the grid says when the search matches nothing. */
	readonly none?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** How tall the button is: `sm`, `lg`, or nothing for the default. A value or a cell. */
	readonly size?: unknown;
	/** What the form calls this field. Goes on the hidden element, which is what a form posts. */
	readonly name?: unknown;
	/** The autofill token, on the hidden element for the same reason. */
	readonly autocomplete?: unknown;
	/** Called with the value now chosen. */
	readonly onChange?: (next: unknown, event: unknown) => void;
	/** Decorate this node instead of building one. It is the `<button>`. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/** The rows now, whether they arrived as a list or a cell holding one. */
const rowsOf = (items: unknown): readonly ChooserItem[] => {
	const held = isSource(items) ? items.get() : items;
	return Array.isArray(held) ? (held as ChooserItem[]) : [];
};

/**
 * Lowercase and without the accents, so `Côte d'Ivoire` is found by `cote`.
 *
 * Params:
 *   value: any text
 *
 * Returns: the text lowercased, with each accented letter decomposed and its mark dropped.
 *
 * Example:
 *   plain('São Tomé');  // 'sao tome'
 */
export const plain = (value: string): string =>
	value.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/**
 * A choice from a long list, in a dialog with a search box over it.
 *
 * Params:
 *   props: `value`, `items`, `open`, `label`, `description`, `error`, `placeholder`, `title`,
 *          `search`, `none`, `disabled`, `type`, `size`, `name`, `autocomplete`, `onChange`,
 *          `element`, `theme`, and anything else, which goes to the button
 *
 * Returns: a `<button>`, a `<dialog>` holding the search box and the grid, and a hidden `<select>`,
 * inside a `<div>` carrying the label and the notes when it was given a label.
 *
 * The dialog is in the markup from the first render, closed. So a static render emits it and a
 * hydration adopts it, and the search box and the grid are part of this component's own tree rather
 * than something mounted at the popup sink when it opens.
 *
 * Throws: the assert for an `open` that is not a cell, and the one `elementFor` makes for an
 * `element` that is not a `<button>`.
 */
export const Chooser = (
	props: ChooserProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// `mounted` is only taken while the component's body runs, and the elements are not in the
	// document until one step later, so the callback is registered here and filled in there.
	let install = (): void => undefined;
	mounted(() => { install(); });

	return (elem, _item, before, context) => {
		const {
			value, items, open, label, description, error, placeholder, title, search, none,
			disabled, type, size, name, autocomplete, onChange, element, theme, ...rest
		} = props;

		assert(open === undefined || isWritable(open),
			'Chooser open takes a cell, not a value; pass open={cell}, or leave it out and the '
			+ 'component keeps its own');

		const cell = isWritable(value) ? value : mutable<unknown>(null);
		const showing = isWritable(open) ? open : mutable(false);
		// The grid is drawn the first time the dialog opens and never taken down again. Nobody can
		// read 249 rows inside a closed dialog, and a static render that emitted them would put them
		// in the markup of every page holding one of these, where the only thing they can do is
		// disagree with what the browser would have written (design 251).
		const drawn = mutable(false);
		const active = mutable<unknown>(null);
		const query = mutable('');
		const states = controlStates(disabled, props);
		const field = wireField(context, { label, description, error, id: rest['id'] });
		const listId = `${field.id}-list`;
		const dialogId = `${field.id}-dialog`;
		const searchId = `${field.id}-search`;
		const titleId = `${field.id}-title`;

		const rowFor = (held: unknown): ChooserItem | null =>
			rowsOf(items).find((row) => row.value === held) ?? null;

		const shut = (): void => { showing.set(false); };

		// Closed before the handler runs, the way a `Menu` closes before calling one: a handler that
		// throws would otherwise leave a modal open over a page that is out of the reading order, and
		// a handler that opens something of its own would have it shut again by the close after it.
		const choose = (next: unknown, event: unknown): void => {
			cell.set(next);
			shut();
			onChange?.(next, event);
		};

		// --- the grid -----------------------------------------------------------------------------

		// One derived value behind both the rows and the line that says nothing matched, so the
		// search runs once per keystroke rather than once per thing that reads it. `items` is in it
		// because a `Region`'s list changes when the country does.
		const source = isSource(items) ? items : mutable(items ?? []);
		const found = all([source, query, drawn]).map(([held, typed, on]) => {
			const asked = plain(String(typed)).trim();
			if (on !== true) return { asked, rows: [] as ChooserItem[] };
			const rows = (Array.isArray(held) ? (held as ChooserItem[]) : [])
				.filter((row) => asked === '' || row.terms.some((term) => term.includes(asked)));
			return { asked, rows };
		});

		// A row's id is its value and not its place in the list, so the row the keyboard is on is the
		// same row after a search has narrowed the list around it. Anything a value holds that an id
		// may not is turned into a dash; the map below is what a pick reads, so two values that clean
		// up to the same id still pick the first of them rather than nothing.
		const idFor = (value: string): string => `${listId}-${value.replace(/[^A-Za-z0-9_-]/gu, '-')}`;

		// The rows are mapped rather than mounted through `each`, because each one carries the id
		// `aria-activedescendant` names and a row built by cloning the first would carry the first
		// row's id (design 224). A filter rebuilds the whole grid, because it is not an edit to a row.
		const ids = new Map<string, string>();
		const rows = found.map((now) => {
			ids.clear();
			return now.rows.map((row) => {
				const id = idFor(row.value);
				ids.set(id, row.value);
				return h('div', {
					id,
					role: 'option',
					'aria-selected': through(cell, (held) => (held === row.value ? 'true' : 'false')),
					// `active` after `selected`, so the row the keyboard is on is the one that shows: a
					// segment later in the list wins where two entries set the same property.
					theme: ['chooser_option',
						row.suggested === true ? 'suggested' : null,
						through(cell, (held) => (held === row.value ? 'selected' : null)),
						through(active, (now2) => (now2 === id ? 'active' : null))],
				},
				row.leading === undefined ? null
					: h('span', { theme: ['chooser_flag'], 'aria-hidden': 'true' }, row.leading),
				h('span', { theme: ['chooser_lines'] },
					h('span', {}, row.label),
					empty(row.note) ? null : h('span', { theme: ['chooser_note'] }, row.note)));
			});
		});

		// Said where the rows would be, not beside them: a listbox holding nothing reads as a control
		// with no options at all, and what the person needs to know is that their own search found
		// none of them.
		const nothing = found.map((now) =>
			(now.asked !== '' && now.rows.length === 0 ? h('p', { theme: ['chooser_none'] }, none ?? text('Nothing matches that.')) : null));

		const grid = h('div', {
			id: listId,
			role: 'listbox',
			'aria-labelledby': titleId,
			theme: ['chooser_grid'],
		}, rows);

		// --- the dialog ---------------------------------------------------------------------------

		let node: unknown = null;

		const box = h('dialog', {
			id: dialogId,
			theme: ['chooser_panel'],
			'aria-labelledby': titleId,
			// Closed through the cell rather than left to the element's own default, so the light tree
			// and a browser take the same path out and the cell is never the odd one out.
			onCancel: (event: unknown) => {
				(event as { preventDefault?: () => void }).preventDefault?.();
				shut();
			},
			onMouseDown: (event: unknown) => {
				// The backdrop is the element itself: anything inside it targets a child.
				if ((event as { target?: unknown }).target !== node) return;
				shut();
			},
		},
		h('div', { theme: ['chooser_head'] },
			h('h2', { id: titleId, theme: ['text', 'lg'] }, title ?? label ?? text('Choose')),
			h(Button, {
				type: 'quiet',
				round: true,
				'aria-label': text('Close', { context: 'dialog' }),
				icon: h(Icon, { name: 'x' }),
				onClick: () => { shut(); },
			})),
		h(TextField, {
			id: searchId,
			theme: 'chooser_search',
			value: query,
			placeholder: search ?? text('Search'),
			leading: h(Icon, { name: 'search' }),
			'aria-label': search ?? text('Search'),
			role: 'combobox',
			'aria-controls': listId,
			'aria-expanded': 'true',
			'aria-autocomplete': 'list',
			// Named only while the row it names is in the list. A search that narrows the list around
			// the active row keeps it; one that takes that row away leaves this empty rather than
			// pointing a screen reader at a row that is no longer on the page. The cell itself is the
			// listbox behaviour's, and it settles the id on the next key.
			'aria-activedescendant': all([active, found]).map(([on, now]) =>
				(typeof on === 'string'
					&& (now as { rows: readonly ChooserItem[] }).rows.some((row) => idFor(row.value) === on)
					? on
					: null)),
			autocomplete: 'off',
		}),
		nothing,
		grid);

		// --- the hidden element -------------------------------------------------------------------

		// Off the screen rather than `display: none`, because a control nothing renders is a control
		// autofill cannot find at all (design 224). One `<option>` per row, so what a form posts is
		// the code and not the text a person read.
		const Option = (row: { each?: unknown }): unknown => {
			const held = row.each as ChooserItem;
			const on = through(cell, (chosen) => chosen === held.value);
			return h('option', { value: held.value, selected: on, $selected: on }, held.label);
		};

		// Over the rows as well as the cell: a `Region` whose country changed holds a code the new
		// list does not have, and the blank option is what says so.
		const unset = all([cell, source]).map(([held]) => rowFor(held) === null);
		const blank = h('option', { value: '', disabled: true, hidden: true, selected: unset, $selected: unset },
			placeholder ?? '');

		const native = h('select', {
			name: name ?? null,
			autocomplete: autocomplete ?? null,
			theme: ['offscreen'],
			'aria-hidden': 'true',
			tabindex: '-1',
			disabled,
			onChange: (event: unknown) => {
				const held = (event as { target?: { value?: unknown } }).target?.value;
				choose(typeof held === 'string' && held !== '' ? held : null, event);
			},
		}, blank, h(Option, { each: items ?? [] }));

		// --- the control --------------------------------------------------------------------------

		// A cell holding a value no row has reads as the placeholder, which is what the rest of the
		// control already says: no row is selected and the hidden element is on its blank option.
		const shown = all([cell, source]).map(([held]) => {
			const row = rowFor(held);
			if (row === null) return empty(placeholder) ? null : placeholder;
			return h('span', { theme: ['chooser_chosen'] },
				row.leading === undefined ? null
					: h('span', { theme: ['chooser_flag'], 'aria-hidden': 'true' }, row.leading),
				h('span', {}, row.label));
		});

		const control = h(elementFor(element, 'button'), {
			...rest,
			...field.aria,
			type: 'button',
			'aria-haspopup': 'dialog',
			'aria-expanded': through(showing, (on) => (on === true ? 'true' : 'false')),
			disabled,
			isHovered: states.isHovered,
			isClicked: states.isClicked,
			theme: ['chooser', type, sizeSegments(size),
				through(error, (held) => (empty(held) ? null : 'invalid')), theme, ...states.segments],
			onClick: () => {
				if (states.isDisabled()) return;
				showing.set(true);
			},
		}, shown);

		const item = h('div', { theme: [field.wrapped ? 'field' : 'chooser_wrap'] },
			field.wrapped ? field.label() : null,
			control,
			field.wrapped ? field.notes() : null,
			native,
			box);

		const remove = mount(elem, item, before, context);
		// Read back out of the mount rather than kept from what was built: under a hydration the
		// element on the page is the server's and the one this made was dropped (design 133).
		const root = mountedElement(remove, before);

		const at = (id: string): unknown =>
			find(root(), (element2) => (element2 as ElementLike).getAttribute('id') === id);

		let stop = (): void => undefined;
		cleanup(() => { stop(); });

		install = () => {
			// Found once. The three of them are made with the control and last as long as it does, and
			// a walk per event would be a walk past 249 rows and 250 options to reach the grid.
			node = at(dialogId);
			if (node === null) return;
			const dialog = node;
			const box2 = at(searchId);
			const panel = at(listId);

			const modal = dialogControl(dialog, { onClose: () => { shut(); } });
			// The keys are the listbox behaviour's, listened for on the search box, because that is
			// where the focus is while the dialog is open. The type-ahead is off because the characters
			// are the search box's, and the dialog is inside for the dismissal because a press on the
			// heading is outside both the box and the grid (design 250).
			const keys = listBox(box2, {
				list: () => panel,
				open: showing,
				active,
				typeahead: false,
				inside: () => [dialog],
				// Tab is left alone: a modal traps the focus, so a Tab inside the dialog is the person
				// moving between the search box and the grid and not a way out of it.
				onClose: (reason) => { if (reason !== 'tab') shut(); },
				onPick: (picked, event) => {
					const held = ids.get((picked as ElementLike).getAttribute('id') ?? '');
					if (held === undefined) return;
					choose(held, event);
				},
			});

			// Opening clears the search and puts the keyboard on the chosen row, so the grid opens on
			// what is already chosen rather than making the first arrow settle it.
			const watching = showing.effect((on) => {
				if (on !== true) {
					modal.close();
					active.set(null);
					return;
				}
				query.set('');
				drawn.set(true);
				modal.open();
				// Read off the rows the caller handed over rather than off the filtered list, because a
				// derived value answers with what it last computed until the write that changed it has
				// gone round, and the write that draws the grid is the line above. The search was just
				// cleared, so the filtered list is the whole list anyway.
				const chosen = cell.get();
				const has = typeof chosen === 'string' && rowsOf(items).some((row) => row.value === chosen);
				active.set(has ? idFor(chosen as string) : null);
				(box2 as { focus?: () => void } | null)?.focus?.();
			});

			stop = () => {
				watching();
				keys();
				modal.stop();
			};
		};

		return remove;
	};
};
