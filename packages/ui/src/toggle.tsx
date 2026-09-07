// A switch: the platform's own checkbox wearing the switch role (design 128).
//
// `role="switch"` is a checkbox that reads as on and off rather than ticked and clear. Everything
// else about it is the checkbox: Space toggles it, a form posts it, and the label points at it.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { checkedOf, controlStates, elementFor } from './control.ts';
import { wireField } from './field.ts';
import { h } from './h.ts';
import { isWritable, through } from './source.ts';

/** What `Toggle` takes. Everything not named here goes to the element. */
export interface ToggleProps {
	/** Whether it is on, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The words beside it. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with it. */
	readonly error?: unknown;
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
 * An on and off switch.
 *
 * Params:
 *   props: `value`, `label`, `description`, `error`, `disabled`, `type`, `onChange`, `element`,
 *          and anything else, which goes to the `<input>`
 *
 * Returns: an `<input type="checkbox" role="switch">`, inside a `<div>` with its label when it was
 * given one.
 *
 * Example:
 *   <Toggle label="Email me" value={subscribed} />
 */
export const Toggle = (props: ToggleProps): Mounter => (elem, _item, before, context) => {
	const { value, label, description, error, disabled, type, onChange, element, theme, ...rest } = props;

	const cell = isWritable(value) ? value : mutable(false);
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	const track = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		theme: ['toggle', type, theme, ...states.segments],
		type: 'checkbox',
		role: 'switch',
		disabled,
		checked: through(cell, Boolean),
		$checked: through(cell, Boolean),
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onChange: (event: unknown) => {
			const next = checkedOf(event);
			cell.set(next);
			onChange?.(next, event);
		},
	});

	const node = field.wrapped
		? h('div', { theme: ['field', 'inline'] }, track, field.label(), field.notes())
		: track;
	return mount(elem, node, before, context);
};
