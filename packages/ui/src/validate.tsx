// Saying what is wrong with what is in a control, and tallying that up for a form (design 138).
//
// `Validate` wraps a control it did not build, so the message goes down to it through a slot on the
// mount context and `wireField` reads it (design 129). One message, rendered once, with the control
// pointing at the element that is already on the page.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { Icon } from './icon.tsx';
import { type Checked, VALIDATORS } from './validators.ts';
import { type Group, type Member, ERROR_SLOT, GROUP_SLOT, groupAt } from './validation.ts';
import { assert } from './assert.ts';
import { h } from './h.ts';
import { isSource, isWritable, through } from './source.ts';
import { use, withSlot } from './render.ts';

/** What `Validate` takes. */
export interface ValidateProps {
	/** The cell being checked. The validator is handed this, not what it holds. */
	readonly value?: unknown;
	/** The check: a function of the cell, or the name of one of the eight built-in validators. */
	readonly validate?: unknown;
	/** A cell. Until it changes for the first time nothing is checked; after that, everything is. */
	readonly signal?: unknown;
	/** A cell written true while there is no problem. */
	readonly valid?: unknown;
	/** A cell written the message, or null. */
	readonly error?: unknown;
	/** Keep the message on the screen. True unless it is set false. */
	readonly showError?: unknown;
	/** What sits beside the message. An `Icon` `triangle-alert` by default. */
	readonly icon?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	/** The control. */
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/** What `ValidateContext` takes. */
export interface ValidateContextProps {
	/** A cell written true while every `Validate` below is happy. */
	readonly value?: unknown;
	readonly children?: unknown[];
}

const names = Object.keys(VALIDATORS).join(', ');

/**
 * Check what is in a control, and say what is wrong with it.
 *
 * Params:
 *   props: `value`, `validate`, `signal`, `valid`, `error`, `showError`, `icon`, `type`
 *   children: the control
 *
 * Returns: the control, and after it the message while there is one, as a live region in the
 * `field_error` entry.
 *
 * The message reaches the control too: a control of this package that was given no `error` of its
 * own goes `aria-invalid` and its `aria-describedby` names the message rendered here (design 138).
 * A `Validate` around a plain `<input>` still shows and announces the message, and the input itself
 * stays unmarked, because nothing read it.
 *
 * The children are one control. Every control under a `Validate` takes the message, so one wrapped
 * around two of them marks both invalid and points both at the same message; two controls want two
 * `Validate`s.
 *
 * With a `signal`, nothing is checked until that cell changes for the first time, and every change
 * to `value` is checked after that. With none, checking is live from the start.
 *
 * `showError` false takes the message off the screen and leaves it announced, because a control that
 * says it is invalid and then says nothing else is a dead end.
 *
 * The validator is given the cell, so one that formats what was typed can write it back. Four of the
 * eight do: `phone`, `pan`, `expDate` and `postalCode`.
 *
 * A validator that throws is reported the way a handler that throws is reported anywhere in this
 * package, on a microtask the host sees, and the value counts as invalid with the error's message.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a `value` that is not
 * a cell and for a name that is not one of the eight.
 *
 * Example:
 *   <Validate value={email} validate="email" signal={submitted}>
 *     <TextField label="Email" value={email} />
 *   </Validate>
 */
export const Validate = (
	props: ValidateProps,
	cleanup: (...fns: (() => void)[]) => void,
): Mounter => (elem, _item, before, context) => {
	const { value, validate, signal, valid, error, showError, icon, type, theme, children } = props;

	assert(isSource(value), 'Validate needs a value cell to check; pass value={cell}');
	const named = typeof validate === 'string' ? VALIDATORS[validate] : undefined;
	assert(typeof validate !== 'string' || named !== undefined,
		`there is no built-in validator named ${String(validate)}; the eight are ${names}, `
		+ 'or pass a function of the cell');

	const run = typeof validate === 'function'
		? validate as (cell: Checked) => unknown
		: named;

	const message = mutable('');
	const id = use(context).ids.next('validate');
	const group = groupAt(context);

	// Nothing is checked before the signal has moved; with no signal there is nothing to wait for.
	let live = !isSource(signal);
	// A formatting validator writes the cell it was given, which lands back here through the same
	// effect. One pass at a time, so the write does not start a second check inside the first.
	let running = false;

	const check = (): void => {
		if (!live || run === undefined || running) return;
		running = true;
		let said = '';
		try {
			const answer = run(value as Checked);
			said = answer === null || answer === undefined ? '' : String(answer);
		} catch (thrown) {
			// A check the page wrote is not this component's to die on. Reported where `Detached`
			// reports a handler that threw, and the value counts as invalid with what the error
			// said, so a form is never quietly valid because its check crashed.
			queueMicrotask(() => { throw thrown; });
			said = thrown instanceof Error ? thrown.message : String(thrown);
		} finally {
			running = false;
		}
		message.set(said);
		if (isWritable(valid)) valid.set(said === '');
		if (isWritable(error)) error.set(said === '' ? null : said);
		group?.settle();
	};

	if (isSource(signal)) {
		let first = true;
		cleanup(signal.effect(() => {
			// An effect calls back with what the cell holds now, and that first call is not a change.
			if (first) {
				first = false;
				return;
			}
			live = true;
			check();
		}));
	}
	if (isSource(value)) cleanup(value.effect(() => { check(); }));

	if (group !== null) {
		const member: Member = { isValid: () => message.get() === '' };
		cleanup(group.join(member));
	}

	const note = through(message, (said) => (said === ''
		? null
		: h('span', {
			id,
			role: 'alert',
			theme: ['field', 'error', 'validate', showError === false ? 'offscreen' : null, type, theme],
		}, icon ?? h(Icon, { name: 'triangle-alert' }), said)));

	const own = withSlot(context, ERROR_SLOT, { error: message, id });
	return mount(elem, [...(children ?? []), note], before, own);
};

/**
 * The form's answer: true while every `Validate` below it is happy.
 *
 * Params:
 *   props: `value`, a cell this writes
 *   children: the form
 *
 * Returns: the children. Each `Validate` under it registers when it mounts and leaves when it
 * unmounts, so a field that goes away stops holding the form invalid.
 *
 * Example:
 *   <ValidateContext value={allValid}><Form /></ValidateContext>
 */
export const ValidateContext = (props: ValidateContextProps): Mounter =>
	(elem, _item, before, context) => {
		const members = new Set<Member>();

		const settle = (): void => {
			if (!isWritable(props.value)) return;
			let happy = true;
			for (const member of members) {
				if (member.isValid()) continue;
				happy = false;
				break;
			}
			props.value.set(happy);
		};

		const group: Group = {
			join: (member) => {
				members.add(member);
				settle();
				return () => {
					members.delete(member);
					settle();
				};
			},
			settle,
		};

		settle();
		return mount(elem, props.children ?? [], before, withSlot(context, GROUP_SLOT, group));
	};
