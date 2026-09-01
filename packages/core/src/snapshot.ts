// Reading a whole document out as plain data.
//
// The live tree is proxies and cells, which is the wrong shape for comparing two documents,
// for writing one to a file, or for a conformance suite that has to say what a document is
// after a commit. This is the same document with nothing live in it.

import { codecError, type EdgeKind, type ObservableKind } from '@aweftjs/codec';

import type { Node, Primitive } from './types.ts';
import { nodeOf } from './value.ts';

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
