// Reading a whole document out as plain data.
//
// The live tree is proxies and cells, which is the wrong shape for comparing two documents,
// for writing one to a file, or for a conformance suite that has to say what a document is
// after a commit. This is the same document with nothing live in it.

import {
	bytesFromHex, codecError, idFromText, isValidPosition, type EdgeKind, type ObservableKind,
} from '@aweftjs/codec';

import type { Node, Primitive } from './types.ts';
import { plantCell } from './node.ts';
import { nodeOf, toCell } from './value.ts';
import { createArray } from './array.ts';
import { createMap } from './map.ts';
import { createObject } from './object.ts';

/** A slot naming another observable: which one, what kind, and which edge names it. */
export interface SnapshotRef {
	readonly ref: string;
	readonly kind: ObservableKind;
	readonly edge: EdgeKind;
}

/** What a slot holds in a snapshot: a primitive, or the name of another observable. */
export type SnapshotValue = Primitive | SnapshotRef;

/** One observable as plain data: its kind, and its slots by key. */
export interface SnapshotObservable {
	readonly kind: ObservableKind;
	readonly slots: Record<string, SnapshotValue>;
}

/** A whole document as plain data, flat, keyed by id in text form, with the root named. */
export interface Snapshot {
	readonly root: string;
	readonly observables: Record<string, SnapshotObservable>;
}

/**
 * Read a document out as plain data.
 *
 * Params:
 *   observable: any observable in the document. The document is read from its root
 *
 * Returns: every observable reachable from the root, by id in text form, with each slot
 * either a primitive or the name of another observable and the kind of edge naming it.
 *
 * An observable that has lost its attach edge is not here. Nothing reaches it, and a delta
 * naming it is refused, so it is not part of what the document says.
 *
 * Example:
 *   assert.deepStrictEqual(snapshot(mirror), snapshot(doc));
 */
export const snapshot = (observable: unknown): Snapshot => {
	const from = nodeOf(observable);
	if (from === undefined) throw codecError('not-observable', 'snapshot takes an observable');

	const root = from.root;
	const observables: Record<string, SnapshotObservable> = {};
	const stack: Node[] = [root];

	while (stack.length > 0) {
		const node = stack.pop()!;
		if (observables[node.key] !== undefined) continue;

		const slots: Record<string, SnapshotValue> = {};
		observables[node.key] = { kind: node.kind, slots };

		for (const [slot, cell] of node.slots) {
			if (cell.kind === 'value') {
				slots[slot] = cell.value;
				continue;
			}

			slots[slot] = { ref: cell.node.key, kind: cell.node.kind, edge: cell.edge };
			if (cell.edge === 'attach' && cell.node.parent === node) stack.push(cell.node);
		}
	}

	return { root: root.key, observables };
};

/** The shape sniff: a snapshot slot that is not a primitive names another observable. */
const isRef = (value: SnapshotValue): value is SnapshotRef =>
	value !== null && typeof value === 'object' && !(value instanceof Uint8Array);

const HEX = /^(?:[0-9a-f]{2})+$/;

/**
 * Build a live document from a snapshot (design 029).
 *
 * Params:
 *   snap: what `snapshot` returned, or the same shape written by hand
 *
 * Returns: the root observable, with the snapshot's ids, kinds, slots, positions and
 * aliases. `snapshot(fromSnapshot(s))` deep-equals `s`, and commits addressed to the
 * original document's ids apply to the rebuilt one.
 *
 * The rebuilt document holds what the snapshot says, which is the document, not the
 * detached observables the original may still index. A commit that re-attaches one of
 * those names an id the rebuilt document has never held, so its subtree arrives empty and
 * deltas over its old slots are refused. A replica that must replay that kind of history
 * replays the commit log rather than starting from a snapshot.
 *
 * Throws with the vocabulary `apply` uses when the snapshot does not describe a document:
 * a ref naming an id the snapshot does not hold, an observable attached twice or not at
 * all, a kind that disagrees with its target, or a slot key invalid for its kind.
 *
 * Example:
 *   const copy = fromSnapshot(snapshot(doc));
 */
export const fromSnapshot = (snap: Snapshot): object => {
	// Validate before building, so a malformed snapshot is refused whole rather than half
	// constructed, and the reason named is the structural one rather than whichever plant
	// happened to run first.
	if (snap.observables[snap.root] === undefined) {
		throw codecError('unreachable', `${snap.root} is named as the root but is not in the snapshot`);
	}

	const attached = new Set<string>();

	for (const [key, entry] of Object.entries(snap.observables)) {
		idFromText(key);
		if (entry.kind !== 'object' && entry.kind !== 'array' && entry.kind !== 'map') {
			throw codecError('kind-conflict', `${key} claims to be ${String(entry.kind)}, which is not a kind`);
		}

		for (const [slot, value] of Object.entries(entry.slots)) {
			if (entry.kind === 'array' && (!HEX.test(slot) || !isValidPosition(bytesFromHex(slot)))) {
				throw codecError('invalid-key', `${slot} is not a position key`);
			}
			if (entry.kind === 'map') idFromText(slot);
			if (!isRef(value)) continue;

			const target = snap.observables[value.ref];
			if (target === undefined) {
				throw codecError('unreachable', `${value.ref} is named but not in the snapshot`);
			}
			if (target.kind !== value.kind) {
				throw codecError('kind-conflict', `${value.ref} is ${target.kind} but a slot calls it ${value.kind}`);
			}
			if (value.edge !== 'attach') continue;

			if (attached.has(value.ref) || value.ref === snap.root) {
				throw codecError(
					'multiple-attach',
					`${value.ref} would have two attach edges, and an observable lives in one place`,
				);
			}
			attached.add(value.ref);
		}
	}

	for (const key of Object.keys(snap.observables)) {
		if (key !== snap.root && !attached.has(key)) {
			throw codecError('unreachable', `${key} has no attach path from the root`);
		}
	}

	const made = new Map<string, Node>();
	for (const [key, entry] of Object.entries(snap.observables)) {
		const id = idFromText(key);
		const proxy =
			entry.kind === 'object' ? createObject(undefined, id)
			: entry.kind === 'array' ? createArray(undefined, id)
			: createMap(undefined, id);
		made.set(key, nodeOf(proxy)!);
	}

	for (const [key, entry] of Object.entries(snap.observables)) {
		const node = made.get(key)!;
		for (const [slot, value] of Object.entries(entry.slots)) {
			if (!isRef(value)) {
				plantCell(node, slot, toCell(value));
				continue;
			}
			// A cycle among the attach edges is the one shape counting cannot see; plantCell's
			// ancestry check refuses it here.
			plantCell(node, slot, { kind: 'ref', node: made.get(value.ref)!, edge: value.edge });
		}
	}

	return made.get(snap.root)!.proxy;
};
