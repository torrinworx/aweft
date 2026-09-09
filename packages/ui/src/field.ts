// The ids and the ARIA a labelled control writes (design 129).
//
// Three ids come off the render's counter, which starts at zero per render (design 109), so a
// server and the hydration that adopts it mint the same ids and an `aria-describedby` written on
// the server still points at something once the page is alive.
//
// This is not exported. A component calls it, spreads `aria` onto its element, and renders
// `label()` and `notes()` around it.
//
// It also tells a `Field` laid out above it what its error is, through the slot below (record
// 196). That is the only thing a control says upward, and it says it without changing an id, an
// attribute or a piece of markup.

import { h } from './h.ts';
import { slotOf, use } from './render.ts';
import { through } from './source.ts';
import { errorAt } from './validation.ts';

/** What a control hands the wiring: whatever of the three parts it was given. */
export interface WiringProps {
	/** The visible label. A value or a cell. */
	readonly label?: unknown;
	/** A line under the control saying more about it. A value or a cell. */
	readonly description?: unknown;
	/** The problem with what is in the control now. A value or a cell; anything empty is no error. */
	readonly error?: unknown;
	/** The caller's own id for the control. Omitted, one is minted off the render. */
	readonly id?: unknown;
}

/** The ids, the ARIA, and the two pieces of markup a labelled control puts around itself. */
export interface Wiring {
	/** The control's own id, which the label points at. */
	readonly id: string;
	/** Spread onto the control element. */
	readonly aria: Record<string, unknown>;
	/** Whether anything is wrapped around the control at all. */
	readonly wrapped: boolean;
	/** The `<label>`, or null when there is no label. */
	label(): unknown;
	/** The description and the error, each rendered while it has something to say. */
	notes(): unknown;
}

/** Nothing to say: what an absent label, description or error looks like. */
export const empty = (value: unknown): boolean =>
	value === undefined || value === null || value === false || value === '';

const MARKS: unique symbol = Symbol('aweft.ui.field.marks');

/** A `Field` above a control, following whether anything under it has something wrong with it. */
export interface FieldMarks {
	/**
	 * Follow one control's error, for as long as the field is on the page.
	 *
	 * The value is whatever the control was given: a plain value, or a cell. Anything `empty()`
	 * says is nothing to say.
	 */
	mark(error: unknown): void;
}

/** The slot key a `Field` writes and `wireField` reads. */
export const MARKS_SLOT = MARKS;

/** The field above this mount, or null when the control is not inside one. */
export const marksAt = (context: unknown): FieldMarks | null =>
	(slotOf(context, MARKS) as FieldMarks | undefined) ?? null;

/**
 * Mint a control's ids and work out its ARIA.
 *
 * Params:
 *   context: the opaque context `dom` handed the mounter
 *   props: the control's `label`, `description` and `error`, each a value or a cell
 *
 * Returns: the field wiring. `aria` carries `id`, `aria-describedby` and `aria-invalid`, the
 * last two following the `error` cell, so a control that becomes invalid is announced as invalid
 * without the component watching anything itself. Once the error clears, `aria-invalid` is removed
 * rather than set to `false`.
 *
 * With no `error` of its own, a control inside a `Validate` takes that one: it is announced as
 * invalid and its `aria-describedby` names the message the `Validate` rendered (design 138).
 *
 * Example:
 *   const field = wireField(context, props);
 *   return [field.label(), h('input', { ...field.aria }), field.notes()];
 */
export const wireField = (context: unknown, props: WiringProps): Wiring => {
	// A caller's own id wins, so a page that names its controls keeps its names and the label
	// still points at the right one. With none, the render's counter mints one.
	const id = props.id === undefined || props.id === null
		? use(context).ids.next('field')
		: String(props.id);
	const labelId = `${id}-label`;
	const descriptionId = `${id}-note`;

	const hasLabel = !empty(props.label);
	const hasDescription = !empty(props.description);

	// A `Validate` above this control shows the message itself (design 138), so the control points
	// at that element rather than rendering a second one. Read only where the caller gave no `error`
	// of its own: theirs wins, and then both are shown, which is the caller's choice to make.
	const outer = props.error === undefined ? errorAt(context) : null;
	const error = props.error ?? outer?.error;
	const errorId = outer === null ? `${id}-error` : outer.id;

	// One `aria-describedby` naming whichever of the two is saying something. The error half
	// follows the cell, so the attribute is written again when the error arrives and goes.
	const describedBy = through(error, (value) => {
		const named: string[] = [];
		if (hasDescription) named.push(descriptionId);
		if (!empty(value)) named.push(errorId);
		return named.length === 0 ? null : named.join(' ');
	});

	const invalid = through(error, (value) => (empty(value) ? null : 'true'));

	// The one thing a control says upward: what its error is, to a `Field` laid out around it, so
	// that field can mark itself (design 196). It is the same value the ARIA above follows.
	marksAt(context)?.mark(error);

	return {
		id,
		aria: { id, 'aria-describedby': describedBy, 'aria-invalid': invalid },
		// What the caller asked for, not what a `Validate` above lent us: an error borrowed from
		// there is announced by the control and rendered by the `Validate`, so it wraps nothing.
		wrapped: hasLabel || hasDescription || props.error !== undefined,
		label: () => (hasLabel
			? h('label', { id: labelId, for: id, theme: ['field_label'] }, props.label)
			: null),
		notes: () => [
			hasDescription
				? h('span', { id: descriptionId, theme: ['field_hint'] }, props.description)
				: null,
			outer !== null ? null : through(error, (value) => (empty(value)
				? null
				: h('span', { id: errorId, role: 'alert', theme: ['field_error'] }, value))),
		],
	};
};
