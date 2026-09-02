// A driver that keeps everything in one process.
//
// It exists so the conformance suite has something to run against with no service to start,
// and so an application can develop against the same semantics it will deploy on. It is not a
// simplified driver: it takes the same atomicity and sequencing obligations as the others,
// because a memory driver that is loose about them lets a consumer depend on behaviour the
// real ones do not have.

import type { ObservableKind } from '@aweftjs/codec';

import type { Driver, Entry, Patch, Row, Write } from './driver.ts';

interface Held {
	root: string;
	rootKind: ObservableKind;
	rows: Map<string, Row>;
	tail: Entry[];
	head: number;
}

/**
 * A driver that keeps documents in memory.
 *
 * Returns: a `Driver`. Nothing is shared between two calls, so two stores over one of these
 * are two separate places.
 *
 * Example:
 *   const store = createStore({ driver: memoryDriver() });
 */
/** Fold one observable's changes into the row held for it, creating the row when it is new. */
const merge = (rows: Map<string, Row>, patch: Patch): void => {
	const held = rows.get(patch.id);
	const slots = { ...(held?.slots ?? {}) };
	for (const [slot, value] of Object.entries(patch.set)) slots[slot] = value;
	for (const slot of patch.unset) delete slots[slot];

	const edge = patch.edge === undefined
		? { parent: held?.parent ?? null, slot: held?.slot ?? null }
		: patch.edge === null ? { parent: null, slot: null } : patch.edge;

	rows.set(patch.id, { id: patch.id, kind: patch.kind, parent: edge.parent, slot: edge.slot, slots });
};

export const memoryDriver = (): Driver => {
	const docs = new Map<string, Held>();
	let closed = false;

	const open = (): void => {
		if (closed) throw new Error('store: the driver is closed');
	};

	return {
		async write(write: Write): Promise<number> {
			open();
			let held = docs.get(write.doc);
			if (held === undefined) {
				held = { root: write.root, rootKind: write.rootKind, rows: new Map(), tail: [], head: 0 };
				docs.set(write.doc, held);
			} else if (held.root !== write.root) {
				throw new Error(`store: ${write.doc} has root ${held.root}, not ${write.root}`);
			}

			// One place, so the transaction is that nothing above yields. Build first, commit
			// after, so a rejection cannot leave rows written and the tail short.
			const seq = held.head + 1;
			for (const patch of write.rows) merge(held.rows, patch);
			held.tail.push({ seq, actor: write.actor, body: write.body.slice() });
			held.head = seq;
			return seq;
		},

		async create(doc: string, root: string, rootKind: ObservableKind): Promise<boolean> {
			open();
			if (docs.has(doc)) return false;
			docs.set(doc, { root, rootKind, rows: new Map(), tail: [], head: 0 });
			return true;
		},

		async read(doc: string): Promise<{ root: string; rootKind: ObservableKind; rows: Row[] } | null> {
			open();
			const held = docs.get(doc);
			if (held === undefined) return null;
			return { root: held.root, rootKind: held.rootKind, rows: [...held.rows.values()] };
		},

		async since(doc: string, seq: number): Promise<Entry[]> {
			open();
			const held = docs.get(doc);
			if (held === undefined) return [];
			return held.tail.filter((e) => e.seq > seq).map((e) => ({ ...e, body: e.body.slice() }));
		},

		async head(doc: string): Promise<number> {
			open();
			return docs.get(doc)?.head ?? 0;
		},

		async truncate(doc: string, seq: number): Promise<void> {
			open();
			const held = docs.get(doc);
			if (held === undefined) return;
			held.tail = held.tail.filter((e) => e.seq > seq);
		},

		async remove(doc: string): Promise<void> {
			open();
			docs.delete(doc);
		},

		async close(): Promise<void> {
			closed = true;
			docs.clear();
		},
	};
};
