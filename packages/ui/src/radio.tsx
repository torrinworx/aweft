// One of a group, on the platform's own input (design 128).
//
// A radio group is a group because its members share a `name`. The name is minted off the render's
// id counter, once per `value` cell, so every radio pointing at one cell is one group and the
// platform's own arrow keys, wrapping and roving focus all work with nothing written here.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { controlStates, elementFor } from './control.ts';
import { wireField } from './field.ts';
import { h } from './h.ts';
import { type Render, use } from './render.ts';
import { isWritable, through } from './source.ts';

// Per render, and inside that per cell, so two renders on one page never mint one name for two
// groups. Both keys are objects the caller already holds, which is the only kind of cache this
// package keeps at module scope (design 109).
const groups = new WeakMap<Render, WeakMap<object, string>>();

/** The `name` every radio sharing this cell uses. */
const groupName = (render: Render, cell: object): string => {
	let byCell = groups.get(render);
	if (byCell === undefined) {
		byCell = new WeakMap();
		groups.set(render, byCell);
	}
	let name = byCell.get(cell);
	if (name === undefined) {
		name = render.ids.next('radio');
		byCell.set(cell, name);
	}
	return name;
};

/** What `Radio` takes. Everything not named here goes to the element. */
export interface RadioProps {
	/** The group's chosen value, a cell shared by every radio in the group. */
	readonly value?: unknown;
	/** This radio's own value: what the cell holds when this one is picked. */
	readonly option?: unknown;
	/** The words beside it. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with the choice. */
	readonly error?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Called with the value now chosen. */
	readonly onChange?: (next: unknown, event: unknown) => void;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * One choice out of a group.
 *
 * Params:
 *   props: `value`, the cell the group shares; `option`, this one's value; `label`,
 *          `description`, `error`, `disabled`, `type`, `onChange`, `element`, and anything else,
 *          which goes to the `<input>`
 *
 * Returns: an `<input type="radio">`, inside a `<div>` with its label when it was given one. Every
 * radio handed the same `value` cell is one group, so the arrow keys move between them and Tab
 * steps over the group as a whole, both from the platform.
 *
 * Example:
 *   <Radio value={size} option="small" label="Small" />
 *   <Radio value={size} option="large" label="Large" />
 */
export const Radio = (props: RadioProps): Mounter => (elem, _item, before, context) => {
	const {
		value, option, label, description, error, disabled, type, onChange, element, theme, ...rest
	} = props;

	const cell = isWritable(value) ? value : mutable(option);
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });
	const name = groupName(use(context), cell as unknown as object);

	const dot = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		theme: ['radio', type, theme, ...states.segments],
		type: 'radio',
		name,
		disabled,
		checked: through(cell, (held) => held === option),
		$checked: through(cell, (held) => held === option),
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onChange: (event: unknown) => {
			// A radio only ever fires when it becomes the chosen one, so there is nothing to read
			// off the element: the option this radio stands for is the new value.
			cell.set(option);
			onChange?.(option, event);
		},
	});

	const node = field.wrapped
		? h('div', { theme: ['field', 'inline'] }, dot, field.label(), field.notes())
		: dot;
	return mount(elem, node, before, context);
};
