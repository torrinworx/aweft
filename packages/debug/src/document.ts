// A document read back as a tree.
//
// Built on `snapshot`, which is public, so this needs no hook and no reach into core. Slots
// that hold an observable become children; slots that hold a primitive become facts. That is
// the shape a reader has in their head, and the snapshot's flat id-keyed map is not.

import { idOf, snapshot, type Snapshot, type SnapshotValue } from '@aweftjs/core';
import { idToText } from '@aweftjs/codec';

import type { Described, Fact } from './described.ts';

const isRef = (v: SnapshotValue): v is Extract<SnapshotValue, { ref: string }> =>
	typeof v === 'object' && v !== null && !(v instanceof Uint8Array);

// Depth-first from the root, carrying every id already printed anywhere in this walk. One set
// does two jobs: a cycle through an alias terminates, and an observable reached twice prints
// its contents once. An alias is what makes both reachable, so neither is defensive.
const walk = (snap: Snapshot, id: string, slot: string | undefined, seen: Set<string>): Described => {
	const node = snap.observables[id];
	if (node === undefined) return { kind: 'missing', id, facts: [['named by', slot ?? 'the root']] };

	const kind = slot === undefined ? node.kind : `${slot}: ${node.kind}`;
	if (seen.has(id)) return { kind, id, facts: [['seen', 'already, above in this tree']] };

	const facts: Fact[] = [];
	const children: Described[] = [];
	seen.add(id);

	// An array addresses its slots by position key, which is what the wire needs and unreadable
	// to anyone else. Positions order as byte strings and a hex string orders the same way, so
	// sorting the keys recovers the index a reader is actually looking for.
	const entries = Object.entries(node.slots);
	if (node.kind === 'array') entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	let index = 0;
	for (const [key, held] of entries) {
		const label = node.kind === 'array' ? `[${index++}]` : key;
		if (isRef(held)) {
			const child = walk(snap, held.ref, label, seen);
			children.push(held.edge === 'alias' ? { ...child, kind: `${label}: alias to ${child.kind.replace(/^.*: /, '')}` } : child);
		} else facts.push([label, held]);
	}

	return children.length === 0 ? { kind, id, facts } : { kind, id, facts, children };
};

/**
 * A whole document as a tree, ids resolved to the slots that hold them.
 *
 * Params:
 *   document: any observable in the document; the whole document is read from its root
 *
 * Returns: the described tree, ready for `render`. An observable the document no longer holds
 * comes back as `detached` rather than as the tree it used to sit in.
 *
 * Throws: `not-observable` when the value is not one of this stack's observables.
 *
 * Example:
 *   console.log(render(documentOf(doc)));
 */
export const documentOf = (document: unknown): Described => {
	const snap = snapshot(document);

	// A detached observable still answers `snapshot` with the document it used to be in, so
	// walking from that root would print a tree the subject is not in and give no sign of it.
	// Being told the subject is gone is the answer; a confident wrong tree is not.
	const id = idToText(idOf(document));
	if (snap.observables[id] === undefined) {
		return {
			kind: 'detached',
			id,
			facts: [['held by', 'nothing; no path from the root reaches it any more']],
		};
	}

	return walk(snap, snap.root, undefined, new Set());
};
