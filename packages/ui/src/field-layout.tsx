// Laying a form out: the box around one field, the stack a form is, and a fieldset (design 196).
//
// These three do layout and nothing else. A control still writes its own label, its own ids and its
// own ARIA (designs 128, 129), so nothing here can disagree with a control about what a label is.
//
// The one thing a `Field` learns from below is whether a control inside it has something wrong
// with it. `wireField` says so through the slot in `field.ts`, and the field counts what it hears
// and carries `data-invalid` while the count is above zero.

import { type Mounter, mount, watch } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { type FieldMarks, MARKS_SLOT, empty } from './field.ts';
import { elementFor } from './control.ts';
import { h } from './h.ts';
import { through } from './source.ts';
import { withSlot } from './render.ts';

/** What `Field` takes. Everything not named here goes to the element. */
export interface FieldProps {
	/** `column`, `inline` or `responsive`. A value or a cell; nothing is a column. */
	readonly orientation?: unknown;
	/** Decorate this node instead of building one. Any element; nothing builds a `<div>`. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/** What `FieldGroup` takes. Everything not named here goes to the element. */
export interface FieldGroupProps {
	/** Decorate this node instead of building one. Any element; nothing builds a `<div>`. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/** What `FieldSet` takes. Everything not named here goes to the element. */
export interface FieldSetProps {
	/** The heading, rendered as the `<legend>`. A value or a cell. */
	readonly legend?: unknown;
	/** Decorate this `<fieldset>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

// `column` and nothing are the entry's own layout, so neither is a segment. Anything else is one,
// which is `field_inline` and `field_responsive` here and an application's own modifier elsewhere.
const laidOut = (orientation: unknown): unknown =>
	through(orientation, (held) => (empty(held) || held === 'column' ? null : String(held)));

// Any element will do for a box that only lays things out, but it has to be one: a component or a
// text node handed in here would wear the theme and lay nothing out.
const boxFor = (element: unknown): unknown =>
	(element === undefined || element === null ? 'div' : elementFor(element));

/**
 * The box around one field: a control, whatever labels it, and whatever is said under it.
 *
 * Params:
 *   props: `orientation`, `element`, `theme`, and anything else, which goes to the element
 *   children: the control, and anything the caller wants beside it
 *
 * Returns: a `<div role="group">` on the `field` entry. `orientation` is `column` (the default:
 * the label above, the control, then the notes), `inline` (the control beside its words, on one
 * `$control`-tall line) or `responsive` (a column that turns inline from 28rem of its container's
 * width). It is a value or a cell, so a field can change shape while it is on the page.
 *
 * A `responsive` field measures the nearest ancestor that declares itself a container, which in
 * this package is `FieldGroup` and nothing else. With no group above it, it stays a column at
 * every width.
 *
 * The field carries `data-invalid` while a control inside it says it has an error, whether the
 * error came from the control's own `error` prop or from a `Validate` around it, and drops the
 * attribute when the error clears. The default theme colours a label under a marked field the
 * colour its error message already has.
 *
 * This lays out; it labels nothing. A control that was given a `label` still writes its own, and a
 * bare control is named by a `<label for>` the caller writes here.
 *
 * Example:
 *   <Field orientation="responsive"><TextField label="Email" value={email} /></Field>
 *   <Field orientation="inline"><Checkbox label="Email me" value={subscribed} /></Field>
 */
export const Field = (
	props: FieldProps,
	cleanup: (...fns: (() => void)[]) => void,
): Mounter => (elem, _item, before, context) => {
	const { orientation, element, theme, children, ...rest } = props;

	// How many controls under this field are saying something. A count rather than a flag, because
	// a field may hold more than one control and the first one to clear is not the last one wrong.
	const wrong = mutable(0);
	const marks: FieldMarks = {
		mark: (error) => {
			let counted = false;
			cleanup(watch(error, (value) => {
				const now = !empty(value);
				if (now === counted) return;
				counted = now;
				wrong.set(wrong.get() + (now ? 1 : -1));
			}));
		},
	};

	const node = h(boxFor(element), {
		role: 'group',
		...rest,
		theme: ['field', laidOut(orientation), theme],
		'data-invalid': wrong.map((held) => (held > 0 ? 'true' : null)),
	}, ...(children ?? []));

	return mount(elem, node, before, withSlot(context, MARKS_SLOT, marks));
};

/**
 * The stack a form is: fields down the page, evenly spaced.
 *
 * Params:
 *   props: `element`, `theme`, and anything else, which goes to the element
 *   children: the fields
 *
 * Returns: a `<div>` on the `field_group` part, a full-width column with `$space6` between its
 * children. It declares itself an inline-size container, which is what a `responsive` `Field`
 * inside it measures.
 *
 * Example:
 *   <FieldGroup>
 *     <Field orientation="responsive"><TextField label="Email" value={email} /></Field>
 *     <Field orientation="inline"><Checkbox label="Email me" value={subscribed} /></Field>
 *   </FieldGroup>
 */
export const FieldGroup = (props: FieldGroupProps): unknown => {
	const { element, theme, children, ...rest } = props;
	return h(boxFor(element), {
		...rest,
		theme: ['field_group', theme],
	}, ...(children ?? []));
};

/**
 * A run of fields under a heading, on the element the platform has for one.
 *
 * Params:
 *   props: `legend`, `element`, `theme`, and anything else, which goes to the element
 *   children: the fields
 *
 * Returns: a `<fieldset>` on the `field_set` part with a `<legend>` on `field_legend` first, then
 * the children. The fieldset's own border, padding, margin and minimum width are taken off, so it
 * is the same column a `FieldGroup` is. An `element` has to be a `<fieldset>`, because the legend
 * and the disabling below are that element's and nothing else has them.
 *
 * `disabled` goes through to the element, and the platform disables every control inside it. It
 * does not dim them: the theme's disabled look is a class a control writes from its own `disabled`
 * prop, and a fieldset writes no class on anything. Set `disabled` on the controls too where the
 * dimming matters.
 *
 * Example:
 *   <FieldSet legend="Billing address">
 *     <Field><TextField label="Street" value={street} /></Field>
 *   </FieldSet>
 */
export const FieldSet = (props: FieldSetProps): unknown => {
	const { legend, element, theme, children, ...rest } = props;
	// The legend goes first because that is where the host expects it: a `<legend>` anywhere else
	// in a fieldset is laid out as an ordinary child and stops being the box's name.
	const head = through(legend, (held) => (empty(held)
		? null
		: h('legend', { theme: ['field_legend'] }, held)));
	return h(elementFor(element, 'fieldset'), {
		...rest,
		theme: ['field_set', theme],
	}, head, ...(children ?? []));
};
