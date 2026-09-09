// The two slots a `Validate` puts on the mount context, and what reads them (design 138).
//
// One carries the message down to the control the `Validate` wraps, so `wireField` can point the
// control's `aria-describedby` at the element `Validate` already rendered rather than rendering a
// second one. The other is the form's tally, which every `Validate` under a `ValidateContext`
// joins and leaves.
//
// They live here rather than in `validate.tsx` so that `field.ts` can read one without importing
// the component that writes it, which would be a cycle.
//
// This is not exported.

import { slotOf } from './render.ts';

const ERROR: unique symbol = Symbol('aweft.ui.validation.error');
const GROUP: unique symbol = Symbol('aweft.ui.validation.group');

/** The message a `Validate` is showing, and the id of the element showing it. */
export interface FieldError {
	/** A value or a cell. Anything empty means no error. */
	readonly error: unknown;
	/** The id of the live region the message is rendered in. */
	readonly id: string;
}

/** One member of a form's tally: a `Validate` that has an answer. */
export interface Member {
	isValid(): boolean;
	/** The cell this member is checking, so the form can follow it (design 208). */
	readonly value: unknown;
	/** Run this member's check again, because another field in the form moved. */
	recheck(): void;
}

/** The tally a `ValidateContext` keeps. */
export interface Group {
	/** Register, and hand back the way out. Called again by a member whose answer changed. */
	join(member: Member): () => void;
	/** Work the answer out again and write the cell. */
	settle(): void;
}

export const ERROR_SLOT = ERROR;
export const GROUP_SLOT = GROUP;

/** The error a `Validate` above this mount is showing, or null when there is none. */
export const errorAt = (context: unknown): FieldError | null =>
	(slotOf(context, ERROR) as FieldError | undefined) ?? null;

/** The tally a `ValidateContext` above this mount keeps, or null when there is none. */
export const groupAt = (context: unknown): Group | null =>
	(slotOf(context, GROUP) as Group | undefined) ?? null;
