// Applying a commit that came from somewhere else.
//
// Every delta is checked before any is applied, so a commit that breaks a rule leaves the
// document exactly as it was and no watcher ever sees a half-applied one. The checks run in
// the order the format states them, and each throws the reason `spec/fixtures/invalid` names,
// because a format whose implementations disagree about why an input is invalid has not been
// specified, only implemented.

import {
	type Commit, type Delta, type ObservableKind,
	assertId, assertPosition, assertValue, codecError, idToText, isReference, slotKeyOf,
} from '@aweftjs/codec';

import type { Cell, Node } from './types.ts';
import { anchorOf } from './node.ts';
import { nodeFor } from './create.ts';
import { atomic, write } from './transaction.ts';
import { nodeOf } from './value.ts';

/**
 * Every ref names a slot the format allows.
 *
 * The decoder checks this on the way in, so a commit that arrived as bytes has been through
 * it already. One that did not, because it was handed straight over in the same process, has
 * not, and a position the format forbids applied here makes a document nothing can ever
 * encode: every later reader of it is refused, and the refusal comes from the encoder rather
 * than from whoever wrote the bad key.
 */
// A delta says a slot and what goes in it, and both have to be things the format can spell.
// Checking the slot key and not the value let a commit put a value in a document that the
// encoder then refuses, which makes the document unserveable to every byte client and lands
// the failure on whoever encodes rather than on whoever wrote it.
const checkWire = (commit: Commit): void => {
	for (const delta of commit.deltas) {
		if (delta.ref.kind === 'array') assertPosition(delta.ref.key);
		else if (delta.ref.kind === 'map') assertId(delta.ref.key);
		if (delta.value !== undefined) assertValue(delta.value);
	}
};

/** Every observable the commit mentions, and the kind each mention says it is. */
const kindsIn = (commit: Commit, index: Map<string, Node>): Map<string, ObservableKind> => {
	const kinds = new Map<string, ObservableKind>();

	const claim = (key: string, kind: ObservableKind, where: string): void => {
		const known = kinds.get(key) ?? index.get(key)?.kind;
		if (known === undefined) {
			kinds.set(key, kind);
			return;
		}
		if (known !== kind) {
			throw codecError('kind-conflict', `${key} is ${known} but ${where} calls it ${kind}`);
		}
		kinds.set(key, kind);
	};

	for (const delta of commit.deltas) {
		claim(idToText(delta.id), delta.ref.kind, 'a delta');
		if (delta.value !== undefined && isReference(delta.value)) {
			claim(idToText(delta.value.id), delta.value.kind, 'a reference');
		}
	}

	return kinds;
};

/**
 * Nothing may end up with two attach edges.
 *
 * Counting rather than checking each delta in turn is what keeps this independent of the
 * order the deltas arrive in, which matters because a commit is a set.
 */
const checkAttachments = (
	commit: Commit,
	index: Map<string, Node>,
	attachedBy: Map<string, string>,
): void => {
	const counts = new Map<string, number>();

	const bump = (key: string, by: number): void => {
		const existing = counts.get(key) ?? (index.get(key)?.parent != null ? 1 : 0);
		counts.set(key, existing + by);
	};

	for (const delta of commit.deltas) {
		const holder = index.get(idToText(delta.id));
		const slot = slotKeyOf(delta.ref);
		const displaced = holder?.slots.get(slot);

		if (delta.type !== 'add' && displaced?.kind === 'ref' && displaced.edge === 'attach') {
			bump(displaced.node.key, -1);
		}

		if (delta.value !== undefined && isReference(delta.value) && delta.value.edge === 'attach') {
			const target = idToText(delta.value.id);
			bump(target, 1);
			attachedBy.set(target, idToText(delta.id));
		}
	}

	for (const [key, count] of counts) {
		if (count > 1) {
			throw codecError(
				'multiple-attach',
				`${key} would have ${count} attach edges, and an observable lives in one place`,
			);
		}
	}
};

/**
 * Can a delta about this observable be applied?
 *
 * Reachability is judged against the document as it was, extended by the attach edges this
 * commit adds. Edges the commit removes are not counted, so a commit may write into a subtree
 * in the same breath as it detaches it.
 */
const checkReach = (
	commit: Commit,
	root: Node,
	index: Map<string, Node>,
	attachedBy: Map<string, string>,
): void => {
	const settled = new Map<string, boolean>();

	const reaches = (key: string): boolean => {
		const answer = settled.get(key);
		if (answer !== undefined) return answer;

		const seen = new Set<string>();
		let at = key;

		for (;;) {
			const node = index.get(at);
			if (node !== undefined && anchorOf(node) === root) {
				settled.set(key, true);
				return true;
			}

			const holder = attachedBy.get(at);
			if (holder === undefined || seen.has(holder)) {
				settled.set(key, false);
				return false;
			}

			seen.add(holder);
			at = holder;
		}
	};

	for (const delta of commit.deltas) {
		const key = idToText(delta.id);
		if (!reaches(key)) throw codecError('unreachable', `${key} has no attach path from the root`);
	}
};

/** An add needs a free slot, and a replace or a remove needs one that is taken. */
const checkSlots = (commit: Commit, index: Map<string, Node>): void => {
	for (const delta of commit.deltas) {
		const key = idToText(delta.id);
		const slot = slotKeyOf(delta.ref);
		const present = index.get(key)?.slots.has(slot) === true;

		if (delta.type === 'add' && present) {
			throw codecError('slot-exists', `${key} already holds ${slot}`);
		}
		if (delta.type !== 'add' && !present) {
			throw codecError('slot-missing', `${key} does not hold ${slot}`);
		}
	}
};

type Resolve = (key: string, kind: ObservableKind, id: Uint8Array) => Node;

const cellFor = (delta: Delta, resolve: Resolve): Cell | undefined => {
	if (delta.type === 'remove') return undefined;

	const value = delta.value!;
	if (!isReference(value)) return { kind: 'value', value };

	const key = idToText(value.id);
	return { kind: 'ref', node: resolve(key, value.kind, value.id), edge: value.edge };
};

/**
 * Apply a whole commit to a document.
 *
 * Params:
 *   observable: any observable in the document. The commit is applied to its root
 *   commit: the commit, its deltas in any order
 *
 * Throws: an error naming the rule broken, having changed nothing. An integrity tag is not
 * checked here: the algorithm is open in `spec/format.md` 8, and a tag is opaque bytes until
 * it is settled.
 *
 * Watchers are called once, after every delta has been applied, with the deltas that fell in
 * their scope. A watcher cannot tell an applied commit from a local mutation, so anything
 * that records what a watcher delivers, an undo stack included, receives the commits it
 * applies itself and wants a way to tell its own apart, such as a flag held for the duration
 * of the call (`examples/core` does exactly this).
 *
 * That flag only covers this call when the call is made from ordinary code. Userspace calls
 * are deferred, so calling `apply` from inside a watcher hands the commit to the second
 * document's watchers after the outer watcher has returned and cleared the flag. Queue the
 * commit and apply it once the delivery has finished, which is what a transport does anyway.
 *
 * A commit only names observables reachable in the receiving document, so a replica of an
 * existing document starts from its root id, `createObject(undefined, idOf(source))` for an
 * object root; from there, applying the source's commits in the order they happened rebuilds
 * it. A plain empty observable has a different root id and refuses them as unreachable.
 *
 * Example:
 *   apply(doc, decodeCommit(bytes));
 */
export const apply = (observable: unknown, commit: Commit): void => {
	const from = nodeOf(observable);
	if (from === undefined) throw codecError('not-observable', 'apply takes an observable');

	const root = from.root;
	const index = root.index!;

	if (commit.deltas.length === 0) {
		throw codecError('empty-commit', 'a commit carries at least one delta');
	}

	checkWire(commit);
	const kinds = kindsIn(commit, index);
	const attachedBy = new Map<string, string>();
	checkAttachments(commit, index, attachedBy);
	checkReach(commit, root, index, attachedBy);
	checkSlots(commit, index);

	// An observable is created by being mentioned. Made ones are held here as well as looked
	// for in the index, because nothing puts them in the index until a delta attaches them,
	// and two deltas about one new observable must find the same one.
	const made = new Map<string, Node>();
	const resolve: Resolve = (key, kind, id) => {
		const known = index.get(key) ?? made.get(key);
		if (known !== undefined) return known;

		const node = nodeFor(kinds.get(key) ?? kind, id);
		made.set(key, node);
		return node;
	};

	atomic(() => {
		for (const delta of commit.deltas) {
			const node = resolve(idToText(delta.id), delta.ref.kind, delta.id);
			write(node, slotKeyOf(delta.ref), cellFor(delta, resolve));
		}
	});
};
