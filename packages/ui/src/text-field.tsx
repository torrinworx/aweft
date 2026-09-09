// A single line of text, on the platform's own input (design 128).
//
// Given a `leading` or a `trailing` it draws a box around the input and puts the addons in it
// (design 210). With neither, the markup is the input and nothing else, so a page that has one and
// a selector written against it are both unaffected by the branch.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { controlStates, elementFor, sizeSegments, starting, valueOf } from './control.ts';
import { isWritable, through } from './source.ts';

/** Text becomes an addon; anything else is already something to mount, and nothing is nothing. */
const addon = (given: unknown): unknown => {
	if (given === undefined || given === null || given === false || given === '') return null;
	return typeof given === 'string' || typeof given === 'number'
		? h('span', { theme: ['input_group_addon'] }, given)
		: given;
};

/** What `TextField` takes. Everything not named here goes to the element. */
export interface TextFieldProps {
	/** Before the input, inside a box: text, an `Icon`, or a `Button` of `size="icon"`. */
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
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * One line of text.
 *
 * Params:
 *   props: `leading`, `trailing`, `value`, `label`, `description`, `error`, `placeholder`,
 *          `password`, `onEnter`, `onKeyDown`, `disabled`, `type`, `size`, `element`, and anything
 *          else, which goes to the `<input>`
 *
 * Returns: an `<input>` on its own, or the input inside a `<div>` with its label, description and
 * error, when it was given any of the three. The cell and the element follow each other: typing
 * writes the cell, and writing the cell writes the element.
 *
 * With a `leading` or a `trailing`, the input goes inside a `<div>` on the `input_group` entry
 * which carries the border, the radius, the fill and the height, and the input itself carries none
 * of them, so the two read as one control (design 210). The focus ring is on the box. An addon that
 * is text is wrapped on `input_group_addon`; anything else is mounted as it is, which is what lets
 * an `Icon` or a `Button` of `size="icon"` go there. With neither, none of that is rendered.
 *
 * While `error` says something the field carries `aria-invalid`, its `aria-describedby` names the
 * message, and the message is a live region, so it is read out when it arrives.
 *
 * Example:
 *   <TextField label="Email" value={email} error={emailError} />
 *   <TextField label="Price" leading="$" trailing="CAD" value={price} />
 */
export const TextField = (props: TextFieldProps): Mounter => (elem, _item, before, context) => {
	const {
		leading, trailing, value, label, description, error, placeholder, password,
		onEnter, onKeyDown, disabled, type, size, element, theme, ...rest
	} = props;

	const cell = isWritable(value) ? value : mutable('');
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	const onKey = (event: unknown): void => {
		if (onEnter !== undefined && (event as { key?: string }).key === 'Enter') {
			// Prevented before the handler runs, so a field inside a form does not submit it as
			// well as calling the handler.
			(event as { preventDefault?: () => void }).preventDefault?.();
			onEnter(event);
		}
		onKeyDown?.(event);
	};

	const lead = addon(leading);
	const trail = addon(trailing);
	const boxed = lead !== null || trail !== null;

	// The look, the size and the state go wherever the border is: on the box when there is one, on
	// the input when there is not. Whichever wears them also wears the hover and press tracking.
	const dressed = {
		theme: [
			boxed ? 'input_group' : 'input', type, sizeSegments(size),
			through(error, (held) => (empty(held) ? null : 'invalid')),
			theme, ...states.segments,
		],
		isHovered: states.isHovered,
		isClicked: states.isClicked,
	};

	const input = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		...(boxed ? { theme: ['input_group_control'] } : dressed),
		type: password ? 'password' : 'text',
		placeholder,
		disabled,
		// The text it starts with, so a server page shows what is in the field before any script
		// runs. Written once rather than followed: the property below is what the cell drives, and
		// the platform reads this attribute as the default value, so rewriting it on every
		// keystroke would be a DOM write per key that changes nothing anyone can see.
		value: starting(cell),
		$value: cell,
		onInput: (event: unknown) => { cell.set(valueOf(event)); },
		onKeyDown: onKey,
	});

	const control = boxed
		? h('div', dressed, lead, input, trail)
		: input;

	const node = field.wrapped
		? h('div', { theme: ['field'] }, field.label(), control, field.notes())
		: control;
	return mount(elem, node, before, context);
};
