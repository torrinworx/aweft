// Several lines of text, on the platform's own textarea (design 128).
//
// The one thing the platform does not do is grow the box to fit what is in it, so this does that,
// up to a height the theme names. The height is written as part of the element's own `style`
// object rather than onto `element.style`, so there is one writer of that attribute and a
// hydration compares the value the server wrote.

import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { controlStates, elementFor, starting, valueOf } from './control.ts';
import { empty, wireField } from './field.ts';
import { h } from './h.ts';
import { isWritable, through } from './source.ts';

/** What `TextArea` takes. Everything not named here goes to the element. */
export interface TextAreaProps {
	/** The text, a cell. Absent, the component keeps its own. */
	readonly value?: unknown;
	/** The label above it. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with what is in it. */
	readonly error?: unknown;
	/** The grey text shown while it is empty. */
	readonly placeholder?: unknown;
	/** How tall it may grow. A CSS length; `$textAreaMax` when omitted. */
	readonly maxHeight?: unknown;
	/** Called when Enter is pressed, with the key's own default prevented first. */
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

interface Measurable {
	readonly scrollHeight?: number;
}

/**
 * Several lines of text, growing to fit them.
 *
 * Params:
 *   props: `value`, `label`, `description`, `error`, `placeholder`, `maxHeight`, `onEnter`,
 *          `onKeyDown`, `disabled`, `type`, `element`, and anything else, which goes to the
 *          `<textarea>`
 *
 * Returns: a `<textarea>` on its own, or the textarea inside a `<div>` with its label,
 * description and error, when it was given any of the three.
 *
 * It measures itself after every change and takes the height of its content, up to `maxHeight`,
 * after which it scrolls. On a host with no layout, which is a static render and the light tree,
 * there is nothing to measure and it keeps the height the theme gives it.
 *
 * Example:
 *   <TextArea label="Notes" value={notes} maxHeight="12rem" />
 */
export const TextArea = (props: TextAreaProps): Mounter => (elem, _item, before, context) => {
	const {
		value, label, description, error, placeholder, maxHeight,
		onEnter, onKeyDown, disabled, type, element, theme, ...rest
	} = props;

	const cell = isWritable(value) ? value : mutable('');
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	// The element is made here rather than by `h`, because growing it means measuring it, and
	// measuring it means holding it.
	const tag = elementFor(element, 'textarea');
	const node = (typeof tag === 'string' ? createElement(tag) : tag) as ElementLike;
	const height = mutable<string | null>(null);

	const grow = (): void => {
		const measured = node as unknown as Measurable;
		if (typeof measured.scrollHeight !== 'number') return;
		// Cleared first, so the measurement is of the content and not of the height it was last
		// given. The clear is written straight through, because the style cell writes on set.
		height.set(null);
		height.set(`${String(measured.scrollHeight)}px`);
	};

	const onKey = (event: unknown): void => {
		if (onEnter !== undefined && (event as { key?: string }).key === 'Enter') {
			(event as { preventDefault?: () => void }).preventDefault?.();
			onEnter(event);
		}
		onKeyDown?.(event);
	};

	const area = h(node, {
		...rest,
		...field.aria,
		theme: ['input', 'textarea', type, through(error, (held) => (empty(held) ? null : 'invalid')), theme, ...states.segments],
		style: { maxHeight, height },
		placeholder,
		disabled,
		$value: cell,
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onInput: (event: unknown) => {
			cell.set(valueOf(event));
			grow();
		},
		onKeyDown: onKey,
	// A textarea carries its text as its content, so that is where the text it starts with goes
	// and a server page shows it. Written once, for the reason `text-field.tsx` gives.
	}, starting(cell));

	const item = field.wrapped
		? h('div', { theme: ['field'] }, field.label(), area, field.notes())
		: area;
	const remove = mount(elem, item, before, context);
	// Once it is in the document it has a layout, and what was put in it before the first
	// keystroke is as much reason to grow as a keystroke is.
	grow();
	return remove;
};
