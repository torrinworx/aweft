// A tick box, on the platform's own input (design 128).

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { checkedOf, controlStates, elementFor } from './control.ts';
import { wireField } from './field.ts';
import { h } from './h.ts';
import { isWritable, through } from './source.ts';

/** What `Checkbox` takes. Everything not named here goes to the element. */
export interface CheckboxProps {
	/** Whether it is ticked, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The words beside it. Without one the box has no name for a screen reader. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with it. */
	readonly error?: unknown;
	/** Tick it when the cell is false rather than when it is true. */
	readonly invert?: unknown;
	/** Neither ticked nor clear: a value or a cell. */
	readonly indeterminate?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Called with what the cell now holds. */
	readonly onChange?: (next: boolean, event: unknown) => void;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * A tick box.
 *
 * Params:
 *   props: `value`, `label`, `description`, `error`, `invert`, `indeterminate`, `disabled`,
 *          `type`, `onChange`, `element`, and anything else, which goes to the `<input>`
 *
 * Returns: an `<input type="checkbox">`, inside a `<div>` with its label when it was given one.
 * Space toggles it, because it is the platform's own box.
 *
 * `invert` flips what ticked means: the box is ticked while the cell is false. What the cell
 * holds is unaffected, so a caller reading it reads the same thing either way.
 *
 * `indeterminate` is a property rather than an attribute in the platform, so it is not in the
 * markup a static render writes and it is set again on the first mount, which is where it can be
 * set at all.
 *
 * Example:
 *   <Checkbox label="Remember me" value={remember} />
 */
export const Checkbox = (props: CheckboxProps): Mounter => (elem, _item, before, context) => {
	const {
		value, label, description, error, invert, indeterminate,
		disabled, type, onChange, element, theme, ...rest
	} = props;

	const cell = isWritable(value) ? value : mutable(false);
	const flipped = Boolean(invert);
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	const box = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		theme: ['checkbox', type, theme, ...states.segments],
		type: 'checkbox',
		disabled,
		// The attribute is what a static render writes, so a server page shows the box ticked; the
		// property is what a live element answers to.
		checked: through(cell, (held) => Boolean(held) !== flipped),
		$checked: through(cell, (held) => Boolean(held) !== flipped),
		$indeterminate: indeterminate ?? false,
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onChange: (event: unknown) => {
			const next = checkedOf(event) !== flipped;
			cell.set(next);
			onChange?.(next, event);
		},
	});

	const node = field.wrapped
		? h('div', { theme: ['field', 'inline'] }, box, field.label(), field.notes())
		: box;
	return mount(elem, node, before, context);
};
