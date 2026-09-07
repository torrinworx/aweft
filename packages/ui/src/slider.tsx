// A number picked by dragging, on the platform's own range input (design 128).
//
// Every key a range input answers to comes with it: the arrows, Page Up and Page Down, Home and
// End. So does the value announced as a percentage, and the pointer and touch handling. The theme
// draws the track and the thumb on the vendor pseudo-elements.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { controlStates, elementFor, valueOf } from './control.ts';
import { wireField } from './field.ts';
import { h } from './h.ts';
import { InputContext } from './input.ts';
import { isWritable, through } from './source.ts';

/** What `Slider` takes. Everything not named here goes to the element. */
export interface SliderProps {
	/** The number, a cell. Absent, the component keeps its own, starting at `min`. */
	readonly value?: unknown;
	/** The label above it. */
	readonly label?: unknown;
	/** A line under it saying more. */
	readonly description?: unknown;
	/** The problem with the number. */
	readonly error?: unknown;
	/** The lowest it goes. 0 when omitted. */
	readonly min?: unknown;
	/** The highest it goes. 100 when omitted. */
	readonly max?: unknown;
	/** The size of one step. `0` means any number in the range. 1 when omitted. */
	readonly step?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Set false to fire no `InputContext` event for this slider. */
	readonly track?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * A number on a line.
 *
 * Params:
 *   props: `value`, `label`, `description`, `error`, `min`, `max`, `step`, `disabled`, `type`,
 *          `track`, `element`, and anything else, which goes to the `<input>`
 *
 * Returns: an `<input type="range">`, inside a `<div>` with its label when it was given one. The
 * cell holds a number, not the text the element carries.
 *
 * `step: 0` is written out as `any`, which is what the platform calls a range with no steps in it.
 *
 * An `onInput` of your own is called with the event, after the cell has been written.
 *
 * Fires the `InputContext` `slide` event with `{ component: 'Slider', label, value }` on every
 * change, unless `track` is false.
 *
 * Example:
 *   <Slider label="Volume" value={volume} min={0} max={11} />
 */
export const Slider = (props: SliderProps): Mounter => (elem, _item, before, context) => {
	const {
		value, label, description, error, min, max, step, disabled, type, track, element, theme,
		onInput, ...rest
	} = props;

	const low = min ?? 0;
	const cell = isWritable(value) ? value : mutable(Number(low));
	const states = controlStates(disabled, props);
	const field = wireField(context, { label, description, error, id: rest['id'] });

	const line = h(elementFor(element, 'input'), {
		...rest,
		...field.aria,
		theme: ['slider', type, theme, ...states.segments],
		type: 'range',
		min: low,
		max: max ?? 100,
		// A step of nothing is a step of one; a step of zero is the platform's `any`.
		step: step === 0 ? 'any' : (step ?? 1),
		disabled,
		$value: through(cell, (held) => String(held ?? low)),
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onInput: (event: unknown) => {
			const next = Number(valueOf(event));
			cell.set(next);
			// A handler of the caller's own is called after the cell, not instead of it: spreading
			// `rest` alone put it there and then wrote over it, which lost it in silence.
			(onInput as ((event: unknown) => void) | undefined)?.(event);
			if (track !== false) {
				InputContext.fire(context, 'slide', { component: 'Slider', label, value: next });
			}
		},
	});

	const node = field.wrapped
		? h('div', { theme: ['field'] }, field.label(), line, field.notes())
		: line;
	return mount(elem, node, before, context);
};
