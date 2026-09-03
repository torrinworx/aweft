// Turning a commit into the rows it changes, and rows back into a document.
//
// This is the whole reason the design is cheap: a commit names its targets by id, so the set
// of rows it touches is read straight off its deltas. Nothing walks the document, and nothing
// re-serialises it, so the work is proportional to the change rather than to what is stored.

import { idToText, isReference, slotKeyOf, type Commit, type ObservableKind } from '@aweftjs/codec';
import type { Snapshot, SnapshotValue } from '@aweftjs/core';

import type { Patch, Row } from './driver.ts';

/** A row while it is being changed. `Row` is the same shape, frozen. */
interface Draft {
	id: string;
	kind: ObservableKind;
	parent: string | null;
	slot: string | null;
	slots: Record<string, SnapshotValue>;
}

/** Every observable of one document, by id in text form. */
export type Rows = Map<string, Draft>;

/** What one commit did to a document's rows: which changed, and which lost their last edge. */
export interface Change {
	readonly touched: Patch[];
	readonly dropped: string[];
}

const draft = (id: string, kind: ObservableKind): Draft =>
	({ id, kind, parent: null, slot: null, slots: {} });

/** What a commit changed about one observable, accumulated as its deltas are folded. */
interface Pending {
	set: Record<string, SnapshotValue>;
	unset: Set<string>;
	edge?: { parent: string; slot: string } | null;
}

/** Start the rows for a document that has only its root. */
export const rowsFor = (root: string, kind: ObservableKind): Rows =>
	new Map([[root, draft(root, kind)]]);

/** Rebuild the rows a driver returned. */
export const rowsFrom = (rows: readonly Row[]): Rows =>
	new Map(rows.map((r) => [r.id, {
		id: r.id, kind: r.kind, parent: r.parent, slot: r.slot, slots: { ...r.slots },
	}]));

/**
 * Fold one commit into a document's rows.
 *
 * Params:
 *   rows: the document's rows, changed in place
 *   commit: a commit that was applied to that document
 *
 * Returns: the rows that changed and the ids that lost their attach edge in this commit.
 *
 * Call it after the commit was applied, never before, for the same reason `schema`'s index is
 * folded after: a commit the applier refuses must not reach what describes the document.
 *
 * An observable that loses its attach edge keeps its row and its slots, with `parent` and
 * `slot` set to null (design 048). It is reported in `dropped` so a caller can find the
 * orphans a commit made without walking anything, but nothing here deletes it.
 *
 * Example:
 *   apply(doc, commit);
 *   const change = record(rows, commit);
 */
export const record = (rows: Rows, commit: Commit): Change => {
	const pending = new Map<string, Pending>();
	const orphaned = new Set<string>();

	const mark = (id: string): Pending => {
		let p = pending.get(id);
		if (p === undefined) pending.set(id, p = { set: {}, unset: new Set() });
		return p;
	};

	// Taking an attach reference out of a slot orphans what it named, unless an earlier delta of
	// this same commit already moved that observable somewhere else. Deltas are in canonical
	// order rather than dependency order, so a move arrives as the add before the remove, and
	// reading the remove literally would report a live observable as an orphan. Core guards the
	// same case in its own release path.
	const detach = (prev: SnapshotValue | undefined, from: string, slot: string): void => {
		if (prev === undefined || prev === null || typeof prev !== 'object') return;
		if (!('ref' in prev) || prev.edge !== 'attach') return;
		const child = rows.get(prev.ref);
		if (child === undefined) return;
		if (child.parent !== from || child.slot !== slot) return;
		child.parent = null;
		child.slot = null;
		mark(child.id).edge = null;
		orphaned.add(child.id);
	};

	// A commit's deltas are in the canonical order of the format, which is not dependency
	// order: the delta filling a new observable's slot can come before the delta that attaches
	// it. So every observable this commit introduces gets its row first, and only then are
	// slots written into them.
	for (const delta of commit.deltas) {
		const value = delta.value;
		if (delta.type === 'remove' || value === undefined || !isReference(value)) continue;
		if (value.edge !== 'attach') continue;
		const childId = idToText(value.id);
		if (!rows.has(childId)) rows.set(childId, draft(childId, value.kind));
	}

	for (const delta of commit.deltas) {
		const ownerId = idToText(delta.id);
		const owner = rows.get(ownerId);
		if (owner === undefined) continue;   // an id this document never held; apply refused it
		const slot = slotKeyOf(delta.ref);
		const change = mark(ownerId);

		detach(owner.slots[slot], ownerId, slot);

		if (delta.type === 'remove') {
			delete owner.slots[slot];
			delete change.set[slot];
			change.unset.add(slot);
			continue;
		}

		const value = delta.value;
		change.unset.delete(slot);

		if (value !== undefined && isReference(value)) {
			const childId = idToText(value.id);
			const written: SnapshotValue = { ref: childId, kind: value.kind, edge: value.edge };
			owner.slots[slot] = written;
			change.set[slot] = written;
			if (value.edge === 'attach') {
				const child = rows.get(childId)!;
				child.parent = ownerId;
				child.slot = slot;
				mark(childId).edge = { parent: ownerId, slot };
				orphaned.delete(childId);
			}
			continue;
		}

		const written = (value ?? null) as SnapshotValue;
		owner.slots[slot] = written;
		change.set[slot] = written;
	}

	const touched: Patch[] = [];
	for (const [id, p] of pending) {
		const row = rows.get(id);
		if (row === undefined) continue;
		touched.push({
			id, kind: row.kind,
			...(p.edge === undefined ? {} : { edge: p.edge }),
			set: p.set, unset: [...p.unset],
		});
	}

	return { touched, dropped: [...orphaned].filter((id) => rows.get(id)?.parent === null) };
};

/**
 * Read the reachable part of a document's rows out as a snapshot.
 *
 * Params:
 *   rows: the document's rows
 *   root: the id of the root, in text form
 *
 * Returns: a snapshot holding what is reachable from the root, which is what `fromSnapshot`
 * will build.
 *
 * A row with no attach edge is left out, because `fromSnapshot` refuses an observable with no
 * attach path from the root. `store` still holds it: design 048 keeps the row and refuses
 * the commit that would re-attach it, rather than letting the observable come back empty.
 *
 * An alias naming one of those rows is left out too, and its slot with it. `fromSnapshot`
 * refuses a snapshot that names what it does not hold, so carrying the alias would make the
 * document unopenable rather than incomplete. Design 050 has the reasoning and `dropped`
 * says which slots went.
 *
 * Example:
 *   const { snapshot, dropped } = snapshotOf(rows, root);
 *   const doc = fromSnapshot(snapshot);
 */
/**
 * Every row the document holds, found by walking attach edges down from the root.
 *
 * Params:
 *   rows: the document's rows
 *   root: the id of the root
 *
 * Returns: the ids reachable from the root, the root included.
 *
 * A row's own parent pointer cannot answer this. Detaching a branch takes the edge off the
 * top of it and leaves every descendant pointing at a parent that is itself unreachable, so
 * asking each row about its parent finds the top of a dead subtree and nothing under it.
 * There is one walk, and both what the document holds and what it has stopped holding are
 * read off it.
 *
 * Example:
 *   const held = reachable(rows, rootId);
 */
export const reachable = (rows: Rows, root: string): Set<string> => {
	const held = new Set<string>();
	const stack = [root];

	while (stack.length > 0) {
		const id = stack.pop()!;
		if (held.has(id)) continue;
		const row = rows.get(id);
		if (row === undefined) continue;

		held.add(id);
		for (const value of Object.values(row.slots)) {
			if (value === null || typeof value !== 'object' || !('ref' in value)) continue;
			if (value.edge === 'attach') stack.push(value.ref);
		}
	}

	return held;
};

export const snapshotOf = (rows: Rows, root: string): { snapshot: Snapshot; dropped: string[] } => {
	const observables: Record<string, { kind: ObservableKind; slots: Record<string, SnapshotValue> }> = {};

	// An alias can only be judged once every attach edge has been followed, because it may
	// name something the walk reaches later.
	for (const id of reachable(rows, root)) {
		const row = rows.get(id)!;
		observables[id] = { kind: row.kind, slots: { ...row.slots } };
	}

	const dropped: string[] = [];
	for (const [id, held] of Object.entries(observables)) {
		for (const [slot, value] of Object.entries(held.slots)) {
			if (value === null || typeof value !== 'object' || !('ref' in value)) continue;
			if (value.edge === 'alias' && observables[value.ref] === undefined) {
				delete held.slots[slot];
				dropped.push(`${id}.${slot}`);
			}
		}
	}

	return { snapshot: { root, observables }, dropped };
};



/** The ids a commit attaches, so a caller can tell whether the document still holds them. */
export const attachedBy = (commit: Commit): string[] => {
	const out: string[] = [];
	for (const delta of commit.deltas) {
		const value = delta.value;
		if (value !== undefined && isReference(value) && value.edge === 'attach') {
			out.push(idToText(value.id));
		}
	}
	return out;
};
