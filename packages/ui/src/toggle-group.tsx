// A row of choices drawn as one control, on the platform's own inputs (design 202).
//
// Single choice is a group of radios, so the arrow keys, the wrapping and the one tab stop are the
// platform's. `multiple` makes them checkboxes, so Space toggles each one. Nothing here writes a
// key handler or a `tabindex`: the input is real, it is inside its `<label>`, and it is off the
// screen rather than gone.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { checkedOf, controlStates, elementFor, groupFor, sizeSegments } from './control.ts';
import { empty } from './field.ts';
import { h } from './h.ts';
import { isSource, isWritable, through } from './source.ts';

/** What `ToggleGroup` takes. Everything not named here goes to the element. */
export interface ToggleGroupProps {
	/**
	 * What is chosen: a cell holding one of `options`, or a cell holding a list of them when
	 * `multiple` is set. Absent, the component keeps its own.
	 */
	readonly value?: unknown;
	/** The items to choose from: a list, or a cell holding one. */
	readonly options?: unknown;
	/** What each item reads as: a function of the item, or a list of strings read by position. */
	readonly display?: unknown;
	/** Let more than one be chosen, which makes the inputs checkboxes and the value a list. */
	readonly multiple?: unknown;
	/** How tall the options are: `sm`, `lg`, or nothing. A value or a cell. */
	readonly size?: unknown;
	/** The theme variant: nothing, or `quiet` for a group with no edges of its own. */
	readonly type?: unknown;
	/** A value or a cell, applied to every option. */
	readonly disabled?: unknown;
	/** What the group is, read out by a screen reader. */
	readonly label?: unknown;
	/** Called with what the cell now holds. */
	readonly onChange?: (next: unknown, event: unknown) => void;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * A row of choices drawn as one control.
 *
 * Params:
 *   props: `value`, `options`, `display`, `multiple`, `size`, `type`, `disabled`, `label`,
 *          `onChange`, `element`, and anything else, which goes to the element
 *
 * Returns: a `<div role="group">` on `togglegroup`, holding one `<label>` per option on
 * `togglegroup_item`. Each label wraps a real `<input>`, off the screen and still in the focus
 * order, so what a person operates is the platform's own control and what they see is a button.
 *
 * The cell holds the item, never the string the element carries, so an object list comes back as
 * objects. With `multiple` it holds a list, in the order the options are declared.
 *
 * `display` reads exactly as `Select` reads it: a function of the item, or a list of strings taken
 * by position.
 *
 * Example:
 *   <ToggleGroup label="Alignment" value={align} options={['left', 'centre', 'right']} />
 *   <ToggleGroup label="Days" value={days} options={week} multiple={true} display={(d) => d.short} />
 */
export const ToggleGroup = (props: ToggleGroupProps): Mounter => (elem, _item, before, context) => {
	const {
		value, options, display, multiple, size, type, disabled, label, onChange, element, theme,
		...rest
	} = props;

	const many = Boolean(multiple);
	const cell = isWritable(value) ? value : mutable<unknown>(many ? [] : null);
	const states = controlStates(disabled, props);
	// One name per value cell, from the same helper `Radio` uses, so a toggle group and a radio
	// pointed at one cell are one group. Checkboxes take it too: a shared name is harmless there and
	// it keeps one code path.
	const name = groupFor(context, cell as unknown as object);

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

	const chosen = (item: unknown): unknown => through(cell, (held) => (many
		? Array.isArray(held) && held.includes(item)
		: held === item));

	/** What the cell holds once this option has been ticked or cleared. */
	const next = (item: unknown, on: boolean): unknown => {
		if (!many) return on ? item : null;
		const held = cell.get();
		const was = Array.isArray(held) ? held : [];
		// Rebuilt from the options rather than pushed, so the list stays in the order the options
		// were declared however they were clicked.
		return list().filter((one) => (one === item ? on : was.includes(one)));
	};

	// The options are mapped rather than run through `each`, because each one carries a handler that
	// has to know which option it is, and what a list clones per row is values: text, attributes and
	// properties, not the functions a row was built with (`packages/dom/README.md`). Measured while
	// building this: under `each`, ticking the first box wrote the last option's item.
	const items = through(options, (held) => (Array.isArray(held) ? held : []).map((item) => {
		const on = chosen(item);
		return h('label', {
			theme: ['togglegroup_item', type, sizeSegments(size), ...states.segments],
			isHovered: states.isHovered,
			isClicked: states.isClicked,
		},
		h('input', {
			theme: ['offscreen'],
			type: many ? 'checkbox' : 'radio',
			name,
			disabled,
			// The attribute is what a static render writes; the property is what a live element
			// answers to.
			checked: on,
			$checked: on,
			onChange: (event: unknown) => {
				const held = next(item, checkedOf(event));
				cell.set(held);
				onChange?.(held, event);
			},
		}),
		textOf(item));
	}));

	const node = h(elementFor(element, 'div'), {
		...rest,
		role: 'group',
		'aria-label': empty(label) ? null : label,
		theme: ['togglegroup', type, theme],
	}, items);

	return mount(elem, node, before, context);
};
