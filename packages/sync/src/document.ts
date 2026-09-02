// Saying a whole document as commits, and moving one document to what another says.
//
// Two jobs, one shape. A replica that has nothing needs the whole document; a replica that
// has drifted needs only the difference. Both are commits, because the commit is the unit
// that crosses every boundary and a second shape for state would be a second thing to
// specify, validate and version.

import {
	type Commit, type Delta, type ObservableKind, type Ref, type Value,
	bytesFromHex, codecError, equalBytes, idFromText,
} from '@aweftjs/codec';
import {
	type Snapshot, type SnapshotRef, type SnapshotValue,
	createArray, createMap, createObject, snapshot,
} from '@aweftjs/core';

/** The ref a delta carries for one slot of an observable of the given kind. */
const refFor = (kind: Snapshot['observables'][string]['kind'], slot: string): Ref => {
	if (kind === 'object') return { kind: 'object', key: slot };
	if (kind === 'array') return { kind: 'array', key: bytesFromHex(slot) };
	return { kind: 'map', key: idFromText(slot) };
};

/** A snapshot slot that is not a primitive names another observable. */
const isRef = (value: SnapshotValue): value is SnapshotRef =>
	value !== null && typeof value === 'object' && !(value instanceof Uint8Array);

/** What a delta carries for a slot the snapshot describes. */
const valueFor = (value: SnapshotValue): Value =>
	isRef(value)
		? { edge: value.edge, kind: value.kind, id: idFromText(value.ref) }
		: value;

/** Do two snapshot slots say the same thing? Bytes compare by content, refs by all three parts. */
const same = (a: SnapshotValue, b: SnapshotValue): boolean => {
	if (isRef(a) || isRef(b)) {
		return isRef(a) && isRef(b) && a.ref === b.ref && a.kind === b.kind && a.edge === b.edge;
	}
	if (a instanceof Uint8Array || b instanceof Uint8Array) {
		return a instanceof Uint8Array && b instanceof Uint8Array && equalBytes(a, b);
	}
	return Object.is(a, b);
};

/**
 * Say a whole document as one commit of `add` deltas.
 *
 * Params:
 *   observable: any observable in the document. The document is read from its root
 *
 * Returns: one commit that builds everything the document holds, or undefined when it holds
 * nothing, because a commit carries at least one delta.
 *
 * The commit does not create the root: nothing addresses the root except by already having
 * it. A receiver mints its root with the same id first, `createObject(undefined, rootId)` for
 * an object root, and applies this to it.
 *
 * This is what a replica with nothing is sent, and it is also how a document built by
 * mutation rather than by replay is fed to an authority index: `record(index, asCommit(doc))`
 * says in one commit what the index would otherwise have had to watch happen.
 *
 * Example:
 *   const whole = asCommit(doc);
 *   if (whole !== undefined) apply(replica, whole);
 */
export const asCommit = (observable: unknown): Commit | undefined => {
	const snap = snapshot(observable);
	const deltas: Delta[] = [];

	for (const [key, entry] of Object.entries(snap.observables)) {
		const id = idFromText(key);
		for (const [slot, value] of Object.entries(entry.slots)) {
			deltas.push({ type: 'add', id, ref: refFor(entry.kind, slot), value: valueFor(value) });
		}
	}

	return deltas.length === 0 ? undefined : { deltas };
};

/**
 * The commit that turns this document into what a snapshot says.
 *
 * Params:
 *   observable: any observable in the document to move. It is read and not written
 *   target: the state to reach, as `snapshot` returns it
 *
 * Returns: one commit, or undefined when the document already says the same thing.
 *
 * This is what makes a resynchronization keep the document. Rebuilding from a snapshot would
 * hand back a different tree, and every watcher, every derived value and every piece of
 * interface holding the old one would be pointing at a document nothing writes to any more.
 * Applying a difference leaves identity alone and reads to a watcher like any other change.
 *
 * The two documents must share a root id: a document is only ever moved to another state of
 * itself.
 *
 * Example:
 *   const fix = reconcile(mine, snapshot(theirs));
 *   if (fix !== undefined) apply(mine, fix);
 */
export const reconcile = (observable: unknown, target: Snapshot): Commit | undefined => {
	const from = snapshot(observable);
	if (from.root !== target.root) {
		throw codecError(
			'root-mismatch',
			`${from.root} cannot be moved to ${target.root}: a document is only moved to itself`,
		);
	}

	const deltas: Delta[] = [];

	for (const [key, entry] of Object.entries(target.observables)) {
		const id = idFromText(key);
		const before = from.observables[key];

		for (const [slot, value] of Object.entries(entry.slots)) {
			const held = before?.slots[slot];
			const present = before !== undefined && slot in before.slots;
			if (present && same(held!, value)) continue;
			deltas.push({
				type: present ? 'replace' : 'add',
				id, ref: refFor(entry.kind, slot), value: valueFor(value),
			});
		}

		if (before === undefined) continue;
		for (const slot of Object.keys(before.slots)) {
			if (slot in entry.slots) continue;
			deltas.push({ type: 'remove', id, ref: refFor(before.kind, slot) });
		}
	}

	// An observable the target does not hold is one the document detaches. Taking away the
	// slot that reached it is the whole of that; core keeps a detached observable in its index
	// on purpose, and its own slots are no longer part of what the document says.

	return deltas.length === 0 ? undefined : { deltas };
};

/**
 * Make an empty document root of a stated kind and id.
 *
 * Params:
 *   id: the root's id. A replica shares its source's, or commits about it are unreachable
 *   kind: which of the three kinds the root is
 *
 * Returns: the root observable, holding nothing. Apply `asCommit` of the source to fill it.
 *
 * Example:
 *   const doc = rootFrom(frame.root.id, frame.root.kind);
 */
export const rootFrom = (id: Uint8Array, kind: ObservableKind): object => {
	if (kind === 'object') return createObject(undefined, id);
	if (kind === 'array') return createArray(undefined, id) as unknown as object;
	if (kind === 'map') return createMap(undefined, id) as unknown as object;
	throw codecError('kind-conflict', `${String(kind)} is not an observable kind`);
};
