// A driver that keeps everything in one process.
//
// It exists so the conformance suite has something to run against with no service to start,
// and so an application can develop against the same semantics it will deploy on. It is not a
// simplified driver: it takes the same atomicity and sequencing obligations as the others,
// because a memory driver that is loose about them lets a consumer depend on behaviour the
// real ones do not have.

import type { ObservableKind } from '@aweftjs/codec';

import type { Driver, Entry, Found, Lookup, Patch, Row, Write } from './driver.ts';
import { compare, holds, type Indexable } from './query.ts';

interface Held {
	root: string;
	rootKind: ObservableKind;
	rows: Map<string, Row>;
	tail: Entry[];
	head: number;
	fields: Record<string, Indexable>;
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
	// One index per declared field, exactly as the other drivers build one. It is a map rather
	// than a scan so that this driver has the same complexity class as the others: a memory
	// driver that scanned would let a consumer write a query that only it can afford.
	const indexes = new Map<string, Map<string, Indexable>>();
	const declared = new Set<string>();
	let closed = false;
	const index = (field: string): Map<string, Indexable> => {
		let m = indexes.get(field);
		if (m === undefined) indexes.set(field, m = new Map());
		return m;
	};

	const open = (): void => {
		if (closed) throw new Error('store: the driver is closed');
	};

	const found = (doc: string): Found => ({ doc, fields: { ...(docs.get(doc)?.fields ?? {}) } });

	return {
		async declare(fields: readonly string[]): Promise<void> {
			open();
			for (const field of fields) { declared.add(field); index(field); }
		},

		async find(lookup: Lookup): Promise<Found[]> {
			open();
			const from = indexes.get(lookup.where.field);
			if (from === undefined) throw new Error(`store: ${lookup.where.field} was not declared`);

			let hits = [...from.entries()]
				.filter(([, value]) => holds(lookup.where, value))
				.map(([doc]) => doc);

			const sort = lookup.sort;
			if (sort === undefined) hits.sort();
			else {
				const on = indexes.get(sort.field);
				const sign = sort.direction === 'desc' ? -1 : 1;
				hits.sort((a, b) => {
					const by = compare(on?.get(a) ?? null, on?.get(b) ?? null) * sign;
					return by !== 0 ? by : (a < b ? -1 : a > b ? 1 : 0);
				});
			}

			if (lookup.after !== undefined) {
				const at = hits.indexOf(lookup.after);
				hits = at === -1 ? hits : hits.slice(at + 1);
			}
			if (lookup.limit !== undefined) hits = hits.slice(0, lookup.limit);
			return hits.map(found);
		},

		async scan(limit: number, after?: string): Promise<Found[]> {
			open();
			let names = [...docs.keys()].sort();
			if (after !== undefined) {
				const at = names.indexOf(after);
				names = at === -1 ? names : names.slice(at + 1);
			}
			return names.slice(0, limit).map(found);
		},

		async write(write: Write): Promise<number> {
			open();
			let held = docs.get(write.doc);
			if (held === undefined) {
				held = { root: write.root, rootKind: write.rootKind, rows: new Map(), tail: [], head: 0, fields: {} };
				docs.set(write.doc, held);
			} else if (held.root !== write.root) {
				throw new Error(`store: ${write.doc} has root ${held.root}, not ${write.root}`);
			}

			// One place, so the transaction is that nothing above yields. Build first, commit
			// after, so a rejection cannot leave rows written and the tail short.
			const seq = held.head + 1;
			for (const patch of write.rows) merge(held.rows, patch);
			if (write.project !== undefined) {
				for (const [field, value] of Object.entries(write.project)) {
					if (!declared.has(field)) continue;
					held.fields[field] = value;
					index(field).set(write.doc, value);
				}
			}
			held.tail.push({ seq, actor: write.actor, body: write.body.slice() });
			held.head = seq;
			return seq;
		},

		async create(doc: string, root: string, rootKind: ObservableKind): Promise<boolean> {
			open();
			if (docs.has(doc)) return false;
			docs.set(doc, { root, rootKind, rows: new Map(), tail: [], head: 0, fields: {} });
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
			for (const m of indexes.values()) m.delete(doc);
		},

		async close(): Promise<void> {
			closed = true;
			docs.clear();
			indexes.clear();
			declared.clear();
		},
	};
};
