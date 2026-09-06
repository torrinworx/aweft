// Answering whether a commit keeps a document inside its description.
//
// A delta names a slot of an observable, and a description names slots by where they sit, so
// the work is a walk: find where the observable sits once the commit has landed, walk the
// description down that path, and hold what the slot ends up holding against what is written
// there. Everything the commit attaches is walked as well, because a subtree arriving at a
// path has to satisfy the description at that path whole, not only in the slots that happened
// to carry a delta.

import { type Commit, type ObservableKind, codecError, idToText, slotKeyOf } from '@aweftjs/codec';
import type { Refusal } from '@aweftjs/core';

import { type Field, type Shape, isLeaf } from './shape.ts';
import { type Held, isNamed, landing } from './resolve.ts';
import type { StandardIssue, StandardSchema } from './standard.ts';

/** The package's own word for each observable kind, so a message reads as the description does. */
const WORDS: Record<ObservableKind, string> = { object: 'a shape', array: 'a list', map: 'a table' };

const wanted = (field: Field): string => (isLeaf(field) ? 'a value' : WORDS[field.kind]);

const found = (held: Held | undefined): string =>
	held === undefined ? 'nothing' : isNamed(held) ? WORDS[held.kind] : 'a value';

/** The slot of a described observable that this step names, or undefined when it names none. */
const below = (field: Shape, step: string): Field | undefined => {
	if (field.kind === 'object') return field.fields[step];
	return field.kind === 'array' ? field.item : field.value;
};

/**
 * Does this commit keep the document inside its description?
 *
 * Params:
 *   form: the description, from `shape`, `list` or `table`
 *   document: any observable in the document the commit is addressed to
 *   commit: the commit to judge. It may or may not have been applied already
 *
 * Returns: one refusal per problem, empty when the commit keeps the document valid. A refusal
 * carries a code (`invalid` from a validator, `kind` when an observable of the wrong kind or a
 * value lands where the other belongs, `unexpected` for a slot the description does not name),
 * the validator's message, and the path from the root: object keys as themselves, map ids in
 * text form, array positions in hex.
 *
 * The answer is the same before and after the commit is applied, so the same function serves a
 * boundary, where nothing has landed yet, and a guard, where everything has. The document is
 * never written to.
 *
 * Judging a commit is not judging a document: this answers what the commit changes, and takes
 * the rest of the document as it finds it. A document that was already outside its description
 * stays that way until something writes to the slot that is wrong.
 *
 * Throws: `async-validator` when a leaf answers with a promise, naming the path. A commit
 * closes now, so a validator that answers later cannot decide one.
 *
 * Example:
 *   const problems = check(Board, board, arriving);
 *   if (problems.length === 0) apply(board, arriving);
 */
export const check = (form: Shape, document: unknown, commit: Commit): readonly Refusal[] => {
	const view = landing(document, commit);
	const out: Refusal[] = [];
	const done = new Set<string>();
	/** `at` overrides where an observable is judged: an alias is judged where it is filed. */
	const pending: Array<{ readonly id: string; readonly slot: string; readonly at?: readonly string[] }> = [];

	const refuse = (code: string, message: string, path: readonly string[]): void => {
		out.push({ code, message, path });
	};

	const validate = (leaf: StandardSchema, value: Held | undefined, path: readonly string[]): void => {
		const answer = leaf['~standard'].validate(value);

		if (typeof (answer as { then?: unknown }).then === 'function') {
			throw codecError(
				'async-validator',
				`${path.join('/')} is checked by a validator that answers later, and a commit is decided now`,
				'Give the slot a validator that answers now, and do the slow check before the write.',
			);
		}

		const issues = (answer as { issues?: ReadonlyArray<StandardIssue> }).issues;
		if (issues === undefined) return;
		for (const issue of issues) refuse('invalid', issue.message, path);
	};

	/** Hold what a slot ends up holding against what the description writes there. */
	const inspect = (field: Field, held: Held | undefined, required: boolean, path: readonly string[]): void => {
		const where = path.join('/');

		// An array position or a map id that nothing sits at is not a hole, it is one fewer
		// element. Only an object field is named by the description and therefore expected.
		if (held === undefined && !required) return;

		if (isLeaf(field)) {
			if (held !== undefined && isNamed(held)) {
				refuse('kind', `${where} holds ${found(held)} where the shape has a value`, path);
				return;
			}
			validate(field, held, path);
			return;
		}

		if (held === undefined) {
			refuse('invalid', `${where} is ${wanted(field)} and cannot be removed`, path);
			return;
		}
		if (!isNamed(held)) {
			refuse('kind', `${where} holds a value where the shape has ${wanted(field)}`, path);
			return;
		}
		if (held.kind !== field.kind) {
			refuse('kind', `${where} holds ${found(held)} where the shape has ${wanted(field)}`, path);
		}
	};

	const visit = (id: string, slot: string, under?: readonly string[]): void => {
		const once = `${under === undefined ? '' : under.join('/') + '@'}${id} ${slot}`;
		if (done.has(once)) return;
		done.add(once);

		// Nothing attaches this observable once the commit has landed, so it is not part of the
		// document any more and the description has nothing to say about it.
		const at = under ?? view.path(id);
		if (at === undefined) return;

		const path = [...at, slot];
		const where = path.join('/');

		let field: Shape = form;
		for (const step of at) {
			const next = below(field, step);
			if (next === undefined) {
				refuse('unexpected', `${where} sits under ${step}, which the shape does not name`, path);
				return;
			}
			if (isLeaf(next)) {
				refuse('kind', `${where} sits under ${at.join('/')}, which the shape has as a value`, path);
				return;
			}
			field = next;
		}

		const kind = view.kind(id);
		if (kind !== undefined && kind !== field.kind) {
			refuse('kind', `${where} is in ${WORDS[kind]} where the shape has ${wanted(field)}`, path);
			return;
		}

		const slotField = below(field, slot);
		if (slotField === undefined) {
			refuse('unexpected', `${where} is not in the shape`, path);
			return;
		}

		const held = view.held(id, slot);
		inspect(slotField, held, field.kind === 'object', path);

		// What a commit attaches lands whole, so it is held to its description whole. An object
		// arriving without a field the shape names is as wrong as one arriving with that field
		// set to something the validator refuses, and only one of the two carries a delta. An
		// alias is judged the same way where it is filed, once, at filing: afterwards the
		// observable is judged at the one path it lives at, which is what an alias is.
		if (held === undefined || !isNamed(held)) return;
		if (isLeaf(slotField) || held.kind !== slotField.kind) return;

		const inside = view.slots(held.id);
		const steps = slotField.kind === 'object'
			? new Set([...Object.keys(slotField.fields), ...inside])
			: inside;
		const filedAt = held.edge === 'attach' ? undefined : path;
		for (const step of steps) {
			pending.push(filedAt === undefined ? { id: held.id, slot: step } : { id: held.id, slot: step, at: filedAt });
		}
	};

	for (const delta of commit.deltas) {
		pending.push({ id: idToText(delta.id), slot: slotKeyOf(delta.ref) });
	}
	// The list grows while it is walked: an attach puts the slots of what it attached on the
	// end, and those may attach more.
	for (let i = 0; i < pending.length; i++) visit(pending[i]!.id, pending[i]!.slot, pending[i]!.at);

	return out;
};
