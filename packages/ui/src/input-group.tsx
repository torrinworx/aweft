// A text field with something beside it inside the same box (design 200).
//
// The label, the description, the error and the three ids are `wireField`'s, the same function
// `TextField` calls, so the two cannot disagree about what a label is (designs 129, 138) and a
// `Field` above either is marked the same way (design 196). What is written out here is the
// element's own props, because this element sits in a box and a plain text field does not.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { controlStates, elementFor, sizeSegments, starting, valueOf } from './control.ts';
import { isWritable, through } from './source.ts';

/** What `InputGroup` takes. Everything not named here goes to the `<input>`. */
export interface InputGroupProps {
	/** Before the input: text, an `Icon`, or a `Button` of `size="icon"`. Anything mountable. */
	readonly leading?: unknown;
	/** After the input, the same. */
	readonly trailing?: unknown;
	/** The text, a cell, written on every keystroke. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The label above it. Without one the field has no name for a screen reader. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with what is in it. A value or a cell; anything empty is no problem. */
	readonly error?: unknown;
	/** The grey text shown while it is empty. */
	readonly placeholder?: unknown;
	/** Type it as a password. */
	readonly password?: unknown;
	/** Called when Enter is pressed. The key's own default is prevented first. */
	readonly onEnter?: (event: unknown) => void;
	/** Called for every key, after `onEnter`. */
	readonly onKeyDown?: (event: unknown) => void;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** How tall it is: `sm`, `lg`, or nothing for the default. A value or a cell. */
	readonly size?: unknown;
	/** Decorate this `<input>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to the box's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/** Text becomes an addon; anything else is already something to mount. */
const addon = (given: unknown): unknown => {
	if (given === undefined || given === null || given === false || given === '') return null;
	return typeof given === 'string' || typeof given === 'number'
		? h('span', { theme: ['inputgroup_addon'] }, given)
		: given;
};

/**
 * A text field with something beside it inside the same box.
 *
 * Params:
 *   props: `leading`, `trailing`, and every `TextField` prop: `value`, `label`, `description`,
 *          `error`, `placeholder`, `password`, `onEnter`, `onKeyDown`, `disabled`, `type`, `size`,
 *          `element`, and anything else, which goes to the `<input>`
 *
 * Returns: a `<div>` on the `inputgroup` entry holding the addons and an `<input>` on
 * `inputgroup_control`, inside a `<div>` with its label, description and error when it was given
 * any of the three. The box carries the border, the radius, the fill and the height, and the input
 * inside it carries none of them, so the two read as one control.
 *
 * The focus ring is on the box: tabbing into the input rings the whole thing, through a
 * `:has(:focus-visible)` rule on the entry.
 *
 * A `leading` or `trailing` that is text is wrapped on `inputgroup_addon`; anything else is
 * mounted as it is, which is what lets an `Icon` or a `Button` of `size="icon"` go there.
 *
 * Example:
 *   <InputGroup label="Price" leading="$" trailing="CAD" value={price} />
 *   <InputGroup label="Search" leading={<Icon name="search" />} value={query} />
 */
export const InputGroup = (props: InputGroupProps): Mounter => (elem, _item, before, context) => {
	const {
		leading, trailing, value, label, description, error, placeholder, password,
		onEnter, onKeyDown, disabled, type, size, element, theme, ...rest
	} = props;

	const cell = isWritable(value) ? value : mutable('');
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	const onKey = (event: unknown): void => {
		if (onEnter !== undefined && (event as { key?: string }).key === 'Enter') {
			// Prevented before the handler runs, so a field inside a form does not submit it as well
			// as calling the handler.
			(event as { preventDefault?: () => void }).preventDefault?.();
			onEnter(event);
		}
		onKeyDown?.(event);
	};

	const input = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		theme: ['inputgroup_control'],
		type: password ? 'password' : 'text',
		placeholder,
		disabled,
		// The text it starts with, so a server page shows what is in the field before any script
		// runs. Written once rather than followed, for the reason `TextField` says.
		value: starting(cell),
		$value: cell,
		onInput: (event: unknown) => { cell.set(valueOf(event)); },
		onKeyDown: onKey,
	});

	const box = h('div', {
		theme: [
			'inputgroup', type, sizeSegments(size),
			through(error, (held) => (empty(held) ? null : 'invalid')),
			theme, ...states.segments,
		],
		isHovered: states.isHovered,
		isClicked: states.isClicked,
	}, addon(leading), input, addon(trailing));

	const node = field.wrapped
		? h('div', { theme: ['field'] }, field.label(), box, field.notes())
		: box;
	return mount(elem, node, before, context);
};
