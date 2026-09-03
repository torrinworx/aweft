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

interface Stored {
	root: string;
	rootKind: ObservableKind;
	rows: Map<string, Row>;
	tail: Entry[];
	head: number;
	fields: Record<string, Indexable>;
}

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

/**
 * A driver that keeps documents in memory.
 *
 * Returns: a `Driver`. Nothing is shared between two calls, so two stores over one of these
 * are two separate places.
 *
 * Example:
 *   const store = createStore({ driver: memoryDriver() });
 */
export const memoryDriver = (): Driver => {
	const docs = new Map<string, Stored>();
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

	const found = (doc: string, cursor: string): Found =>
		({ doc, fields: { ...(docs.get(doc)?.fields ?? {}) }, cursor });

	// A cursor is the sort field, the value the hit had under it, and the name: enough to seek
	// past the position without looking the document up again, which is the whole point
	// (design 060). Plain JSON, because opaque means "do not parse it", not "unreadable".
	const mint = (field: string | null, value: Indexable, doc: string): string =>
		JSON.stringify([field, value, doc]);
	const refuse = (message: string): never => {
		throw Object.assign(new Error(`store: ${message}`), { reason: 'cursor' });
	};
	const parseCursor = (cursor: string, field: string | null): { value: Indexable; doc: string } => {
		let parsed: unknown;
		try { parsed = JSON.parse(cursor); } catch { parsed = undefined; }
		if (!Array.isArray(parsed) || parsed.length !== 3 || typeof parsed[2] !== 'string') {
			return refuse('not a cursor this driver minted');
		}
		if (parsed[0] !== field) {
			return refuse(`the cursor was minted under sort ${String(parsed[0])}, not ${String(field)}`);
		}
		return { value: parsed[1] as Indexable, doc: parsed[2] };
	};

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

			// Order by the sort value and then by name, so the ordering is total and a cursor
			// names a position rather than a row. Sorting by name alone when nothing was asked
			// for is the same rule with an empty sort key.
			const field = lookup.sort?.field ?? null;
			const keyOf = (doc: string): Indexable => field === null
				? null
				: indexes.get(field)?.get(doc) ?? null;
			const sign = lookup.sort?.direction === 'desc' ? -1 : 1;
			const order = (aKey: Indexable, a: string, bKey: Indexable, b: string): number => {
				const by = compare(aKey, bKey) * sign;
				return by !== 0 ? by : (a < b ? -1 : a > b ? 1 : 0);
			};
			hits.sort((a, b) => order(keyOf(a), a, keyOf(b), b));

			// Seek past the position the cursor carries, never past where its document ranks
			// now. A document that stopped matching, moved, or is gone between two pages is
			// ordinary in a live collection; looking it up again would restart or skip.
			if (lookup.after !== undefined) {
				const at = parseCursor(lookup.after, field);
				hits = hits.filter((doc) => order(at.value, at.doc, keyOf(doc), doc) < 0);
			}
			if (lookup.limit !== undefined) hits = hits.slice(0, lookup.limit);
			return hits.map((doc) => found(doc, mint(field, keyOf(doc), doc)));
		},

		async scan(limit: number, after?: string): Promise<Found[]> {
			open();
			const at = after === undefined ? undefined : parseCursor(after, null).doc;
			const names = [...docs.keys()].sort()
				.filter((doc) => at === undefined || doc > at);
			return names.slice(0, limit).map((doc) => found(doc, mint(null, null, doc)));
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
			held.tail.push({ seq, body: write.body.slice() });
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
			return {
				root: held.root, rootKind: held.rootKind,
				rows: [...held.rows.values()].map((r) => ({ ...r, slots: { ...r.slots } })),
			};
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

		async forget(doc: string, ids: readonly string[]): Promise<void> {
			open();
			const held = docs.get(doc);
			if (held === undefined) return;
			for (const id of ids) held.rows.delete(id);
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
