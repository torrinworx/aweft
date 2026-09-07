// A single line of text, on the platform's own input (design 128).

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { controlStates, elementFor, starting, valueOf } from './control.ts';
import { isWritable, through } from './source.ts';

/** What `TextField` takes. Everything not named here goes to the element. */
export interface TextFieldProps {
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
 *   props: `value`, `label`, `description`, `error`, `placeholder`, `password`, `onEnter`,
 *          `onKeyDown`, `disabled`, `type`, `element`, and anything else, which goes to the
 *          `<input>`
 *
 * Returns: an `<input>` on its own, or the input inside a `<div>` with its label, description and
 * error, when it was given any of the three. The cell and the element follow each other: typing
 * writes the cell, and writing the cell writes the element.
 *
 * While `error` says something the field carries `aria-invalid`, its `aria-describedby` names the
 * message, and the message is a live region, so it is read out when it arrives.
 *
 * Example:
 *   <TextField label="Email" value={email} error={emailError} />
 */
export const TextField = (props: TextFieldProps): Mounter => (elem, _item, before, context) => {
	const {
		value, label, description, error, placeholder, password,
		onEnter, onKeyDown, disabled, type, element, theme, ...rest
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

	const input = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		theme: ['input', type, through(error, (held) => (empty(held) ? null : 'invalid')), theme, ...states.segments],
		type: password ? 'password' : 'text',
		placeholder,
		disabled,
		// The text it starts with, so a server page shows what is in the field before any script
		// runs. Written once rather than followed: the property below is what the cell drives, and
		// the platform reads this attribute as the default value, so rewriting it on every
		// keystroke would be a DOM write per key that changes nothing anyone can see.
		value: starting(cell),
		$value: cell,
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onInput: (event: unknown) => { cell.set(valueOf(event)); },
		onKeyDown: onKey,
	});

	const node = field.wrapped
		? h('div', { theme: ['field'] }, field.label(), input, field.notes())
		: input;
	return mount(elem, node, before, context);
};
