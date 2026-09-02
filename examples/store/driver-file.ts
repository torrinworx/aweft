// A driver that survives the process, written outside the package on purpose.
//
// The proof needs storage that outlives a SIGKILL, and writing it here rather than shipping it
// answers a second question at the same time: whether `Driver` is implementable by someone who
// did not design it. One JSON file per document, replaced by rename so a kill lands either on
// the old file or the new one and never on half of either.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import type { Driver, Entry, Patch, Row, Write } from '@aweftjs/store';
import type { ObservableKind } from '@aweftjs/codec';

interface Held {
	root: string;
	rootKind: ObservableKind;
	rows: Record<string, Row>;
	tail: { seq: number; actor: string; body: string }[];
	head: number;
}

export const fileDriver = (dir: string): Driver => {
	mkdirSync(dir, { recursive: true });
	const path = (doc: string): string => join(dir, `${encodeURIComponent(doc)}.json`);

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

	return {
		async create(doc, root, rootKind) {
			if (load(doc) !== null) return false;
			save(doc, { root, rootKind, rows: {}, tail: [], head: 0 });
			return true;
		},

		async write(w: Write) {
			const held = load(w.doc) ?? { root: w.root, rootKind: w.rootKind, rows: {}, tail: [], head: 0 };
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
			held.head += 1;
			held.tail.push({ seq: held.head, actor: w.actor, body: Buffer.from(w.body).toString('base64') });
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
				.map((e) => ({ seq: e.seq, actor: e.actor, body: new Uint8Array(Buffer.from(e.body, 'base64')) }));
		},

		async head(doc) { return load(doc)?.head ?? 0; },

		async truncate(doc, seq) {
			const held = load(doc);
			if (held === null) return;
			held.tail = held.tail.filter((e) => e.seq > seq);
			save(doc, held);
		},

		async remove(doc) { rmSync(path(doc), { force: true }); },

		async close() { /* nothing is held open between calls */ },
	};
};
