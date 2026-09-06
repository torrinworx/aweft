// A driver that survives the process, written outside the package on purpose.
//
// The proof needs storage that outlives a SIGKILL, and writing it here rather than shipping it
// answers a second question at the same time: whether `Driver` is implementable by someone who
// did not design it. One JSON file per document, replaced by rename so a kill lands either on
// the old file or the new one and never on half of either.

import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import type { Driver, Entry, Found, Lookup, Patch, Row, Write } from '@aweftjs/store';
import type { Indexable } from '@aweftjs/store';
import type { ObservableKind } from '@aweftjs/codec';
import { compare, holds } from '@aweftjs/store';

interface Held {
	root: string;
	rootKind: ObservableKind;
	rows: Record<string, Row>;
	tail: { seq: number; body: string }[];
	head: number;
	fields: Record<string, Indexable>;
}

export const fileDriver = (dir: string): Driver => {
	mkdirSync(dir, { recursive: true });
	const path = (doc: string): string => join(dir, `${encodeURIComponent(doc)}.json`);
	let declared: readonly string[] = [];

	// One file per document means the index is the directory, so a lookup reads every
	// document's projection. That is honest for a driver this small, and it is why the real
	// ones keep an index: the contract is the same, the cost is not.
	const all = (): { doc: string; held: Held }[] => readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => decodeURIComponent(f.slice(0, -5)))
		.sort()
		.flatMap((doc) => { const held = load(doc); return held === null ? [] : [{ doc, held }]; });

	const load = (doc: string): Held | null => {
		try { return JSON.parse(readFileSync(path(doc), 'utf8')) as Held; }
		catch { return null; }
	};

	// Replace by rename, and fsync the bytes before the rename, so a kill between the two
	// leaves the previous file intact rather than a truncated new one.
	const save = (doc: string, held: Held): void => {
		const tmp = `${path(doc)}.${process.pid}.tmp`;
		const fd = openSync(tmp, 'w');
		try { writeSync(fd, JSON.stringify(held)); fsyncSync(fd); } finally { closeSync(fd); }
		renameSync(tmp, path(doc));
	};

	// This driver's own cursor: the sort field, the value the hit had under it, and the name, as
	// one JSON text. A cursor means something only to the driver that minted it, so the shape
	// is this file's business; it carries these three because that is what seeking past a
	// position needs, and JSON because a name or a value may contain any character.
	const mint = (field: string | null, value: Indexable, doc: string): string =>
		JSON.stringify([field, value, doc]);
	const parse = (cursor: string, field: string | null): { value: Indexable; doc: string } => {
		let parts: unknown;
		try { parts = JSON.parse(cursor); } catch { parts = undefined; }
		if (!Array.isArray(parts) || parts.length !== 3 || typeof parts[2] !== 'string' || parts[0] !== field) {
			throw Object.assign(new Error('store: not a cursor this driver minted under this sort'), { reason: 'cursor' });
		}
		return { value: parts[1] as Indexable, doc: parts[2] };
	};

	return {
		async declare(fields) { declared = fields; },

		async find(lookup: Lookup): Promise<Found[]> {
			if (!declared.includes(lookup.where.field)) {
				throw new Error(`store: ${lookup.where.field} was not declared`);
			}
			const everything = all();
			const fieldsOf = (doc: string): Record<string, Indexable> =>
				everything.find((e) => e.doc === doc)?.held.fields ?? {};

			const field = lookup.sort?.field ?? null;
			const sign = lookup.sort?.direction === 'desc' ? -1 : 1;
			const keyOf = (doc: string): Indexable => field === null ? null : fieldsOf(doc)[field] ?? null;
			const order = (aKey: Indexable, a: string, bKey: Indexable, b: string): number => {
				const by = compare(aKey, bKey) * sign;
				return by !== 0 ? by : (a < b ? -1 : a > b ? 1 : 0);
			};

			let hits = everything
				.filter(({ held }) => holds(lookup.where, held.fields[lookup.where.field] ?? null))
				.map(({ doc, held }) => ({ doc, fields: { ...held.fields }, cursor: mint(field, keyOf(doc), doc) }));
			hits.sort((a, b) => order(keyOf(a.doc), a.doc, keyOf(b.doc), b.doc));

			// Past the position the cursor carries, never past where its document ranks now.
			if (lookup.after !== undefined) {
				const at = parse(lookup.after, field);
				hits = hits.filter((h) => order(at.value, at.doc, keyOf(h.doc), h.doc) < 0);
			}
			return lookup.limit === undefined ? hits : hits.slice(0, lookup.limit);
		},

		async scan(limit, after) {
			const at = after === undefined ? undefined : parse(after, null).doc;
			const names = all().filter(({ doc }) => at === undefined || doc > at);
			return names.slice(0, limit).map(({ doc, held }) =>
				({ doc, fields: { ...held.fields }, cursor: mint(null, null, doc) }));
		},

		async create(doc, root, rootKind) {
			if (load(doc) !== null) return false;
			save(doc, { root, rootKind, rows: {}, tail: [], head: 0, fields: {} });
			return true;
		},

		async write(w: Write) {
			const held = load(w.doc) ?? { root: w.root, rootKind: w.rootKind, rows: {}, tail: [], head: 0, fields: {} };
			if (held.root !== w.root) throw new Error(`store: ${w.doc} has root ${held.root}, not ${w.root}`);
			for (const patch of w.rows) {
				const was = held.rows[patch.id];
				const slots = { ...(was?.slots ?? {}) };
				for (const [slot, value] of Object.entries(patch.set)) slots[slot] = value;
				for (const slot of patch.unset) delete slots[slot];
				const edge = patch.edge === undefined
					? { parent: was?.parent ?? null, slot: was?.slot ?? null }
					: patch.edge === null ? { parent: null, slot: null } : patch.edge;
				held.rows[patch.id] = { id: patch.id, kind: patch.kind, parent: edge.parent, slot: edge.slot, slots };
			}
			if (w.project !== undefined) Object.assign(held.fields, w.project);
			held.head += 1;
			held.tail.push({ seq: held.head, body: Buffer.from(w.body).toString('base64') });
			save(w.doc, held);
			return held.head;
		},

		async read(doc) {
			const held = load(doc);
			if (held === null) return null;
			return { root: held.root, rootKind: held.rootKind, rows: Object.values(held.rows) };
		},

		async since(doc, seq): Promise<Entry[]> {
			const held = load(doc);
			if (held === null) return [];
			return held.tail.filter((e) => e.seq > seq)
				.map((e) => ({ seq: e.seq, body: new Uint8Array(Buffer.from(e.body, 'base64')) }));
		},

		async head(doc) { return load(doc)?.head ?? 0; },

		async truncate(doc, seq) {
			const held = load(doc);
			if (held === null) return;
			held.tail = held.tail.filter((e) => e.seq > seq);
			save(doc, held);
		},

		async forget(doc, ids) {
			const held = load(doc);
			if (held === null) return;
			for (const id of ids) delete held.rows[id];
			save(doc, held);
		},

		async remove(doc) { rmSync(path(doc), { force: true }); },

		async close() { /* nothing is held open between calls */ },
	};
};
