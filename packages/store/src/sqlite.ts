// A driver that keeps documents in one SQLite database.
//
// On its own subpath because it is an adapter for something the stack can use and must not
// require (design 140). It imports nothing: the handle is typed structurally here, so an
// application hands in the `DatabaseSync` it already opened, with the pragmas it chose, and this
// driver never closes it (design 319).
//
// The tables are the Postgres driver's, made on the first call that needs them. A write is one
// `BEGIN IMMEDIATE` transaction with nothing asynchronous inside it: the write lock is taken
// before the head is read, which is what keeps the sequence contiguous across handles, and the
// synchronous block is what keeps two writes on one handle from interleaving.

import { codecError, type ObservableKind } from '@aweftjs/codec';
import type { SnapshotValue } from '@aweftjs/core';

import type { Driver, Entry, Found, Lookup, Patch, Row, Write } from './driver.ts';
import { projectionOf } from './projection.ts';
import type { Declaration, Indexable, Where } from './query.ts';

type Value = string | number | null | Uint8Array;

/**
 * One prepared statement. `node:sqlite`'s `StatementSync` is one. Stated structurally so this
 * file imports nothing.
 */
export interface Statement {
	run(...values: (string | number | null | Uint8Array)[]): { changes: number | bigint };
	get(...values: (string | number | null | Uint8Array)[]): unknown;
	all(...values: (string | number | null | Uint8Array)[]): unknown[];
}

/**
 * The database the driver keeps documents in.
 *
 * `node:sqlite`'s `DatabaseSync` is one. The application opens it, sets its pragmas (journal
 * mode, synchronous level, busy timeout) and closes it; the driver only uses it.
 */
export interface Database {
	exec(sql: string): void;
	prepare(sql: string): Statement;
}

/** The shape of the tables this driver knows. A database holding any other is refused. */
const VERSION = 1;

const COLUMNS = ['bool_value', 'num_value', 'text_value'] as const;

// `compare` orders null, then boolean, then number, then string, so the kind is stored as this
// rank and the index leads with it, as the Postgres driver's does (design 161).
const rankOf = (value: Indexable): number =>
	value === null ? 0 : typeof value === 'boolean' ? 1 : typeof value === 'number' ? 2 : 3;

const columnOf = (value: Indexable): string => COLUMNS[rankOf(value) - 1] ?? '';

// `node:sqlite` binds no boolean.
const bound = (value: Indexable): Value => typeof value === 'boolean' ? (value ? 1 : 0) : value;

const cells = (value: Indexable): [number, number | null, number | null, string | null] => [
	rankOf(value),
	typeof value === 'boolean' ? (value ? 1 : 0) : null,
	typeof value === 'number' ? value : null,
	typeof value === 'string' ? value : null,
];

interface Projected { rank: number | bigint; bool_value: number | bigint | null; num_value: number | null; text_value: string | null }

// Integers go through `Number` because a handle opened with `readBigInts` answers bigints.
const valueOf = (row: Projected): Indexable => {
	const rank = Number(row.rank);
	if (rank === 1) return Number(row.bool_value) === 1;
	if (rank === 2) return row.num_value;
	if (rank === 3) return row.text_value;
	return null;
};

// Bytes in a slot, on their way through JSON (design 163).
const packed = (value: SnapshotValue): unknown =>
	value instanceof Uint8Array ? { bytes: Buffer.from(value).toString('base64') } : value;

const unpacked = (value: unknown): SnapshotValue => {
	if (value !== null && typeof value === 'object' && 'bytes' in value) {
		return new Uint8Array(Buffer.from((value as { bytes: string }).bytes, 'base64'));
	}
	return value as SnapshotValue;
};

const VERSION_TABLE = `CREATE TABLE IF NOT EXISTS aweft_version (
	one integer PRIMARY KEY,
	version integer NOT NULL
)`;

// No table references another: foreign keys are a pragma, and a cascade that does nothing when
// the application leaves it off would leave rows behind a removed document.
const TABLES = [
	`CREATE TABLE IF NOT EXISTS aweft_documents (
		doc text PRIMARY KEY,
		root text NOT NULL,
		root_kind text NOT NULL,
		head integer NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS aweft_rows (
		doc text NOT NULL,
		id text NOT NULL,
		kind text NOT NULL,
		parent text,
		slot text,
		slots text NOT NULL DEFAULT '{}',
		PRIMARY KEY (doc, id)
	)`,
	`CREATE TABLE IF NOT EXISTS aweft_tail (
		doc text NOT NULL,
		seq integer NOT NULL,
		body blob NOT NULL,
		PRIMARY KEY (doc, seq)
	)`,
	`CREATE TABLE IF NOT EXISTS aweft_projection (
		doc text NOT NULL,
		field text NOT NULL,
		rank integer NOT NULL,
		bool_value integer,
		num_value real,
		text_value text,
		PRIMARY KEY (doc, field)
	)`,
	`CREATE INDEX IF NOT EXISTS aweft_projection_order
		ON aweft_projection (field, rank, bool_value, num_value, text_value, doc)`,
	`CREATE TABLE IF NOT EXISTS aweft_declared (
		field text PRIMARY KEY,
		path text NOT NULL
	)`,
];

const ROW_UPSERT = `INSERT INTO aweft_rows (doc, id, kind, parent, slot, slots) VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT (doc, id) DO UPDATE SET
		kind = excluded.kind, parent = excluded.parent, slot = excluded.slot, slots = excluded.slots`;

const FIELD_UPSERT = `INSERT INTO aweft_projection (doc, field, rank, bool_value, num_value, text_value)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT (doc, field) DO UPDATE SET
		rank = excluded.rank, bool_value = excluded.bool_value,
		num_value = excluded.num_value, text_value = excluded.text_value`;

// SQLite stores a string holding a zero byte, and `node:sqlite` reads it back only as far as
// that byte, so a document name would come back shortened. Refused where the Postgres driver
// refuses it, before the transaction opens, so the two SQL drivers take the same writes.
const noZeroByte = (where: string, value: string): void => {
	if (value.includes('\u0000')) {
		throw codecError('zero-byte', `${where} holds a zero byte, and SQLite reads text back only as far as one`,
			'Strip the zero byte from the string before writing it.');
	}
};

/**
 * A driver that keeps documents in one SQLite database.
 *
 * Params:
 *   db: the database. `node:sqlite`'s `DatabaseSync` is one. The application opens it, sets its
 *       pragmas and closes it; the driver never does, and never changes a setting on it
 *
 * Returns: a `Driver`. It makes its tables on `declare`, and brings the projection into line
 * with the declaration before `declare` resolves: a field nothing projected, or one projected
 * under a path that has since changed, is computed again from every document's rows, and a
 * field the declaration no longer names is dropped.
 *
 * Every write is one `BEGIN IMMEDIATE` transaction. Another handle on the same file, in this
 * process or another, waits for the write lock as long as its busy timeout says and is refused
 * with `SQLITE_BUSY` after that. Nothing is told that a document changed.
 *
 * The driver throws `unknown-version` when the database holds tables made by a driver of another
 * shape, `driver-closed` after `close`, `undeclared` when a lookup names a field nothing indexed,
 * `cursor` when a page is asked for with a cursor from another sort, `root-conflict` when a write
 * names a root the stored document does not have, and `zero-byte` for a string holding one.
 *
 * Example:
 *   import { DatabaseSync } from 'node:sqlite';
 *   import { createStore } from '@aweftjs/store';
 *   import { sqliteDriver } from '@aweftjs/store/sqlite';
 *
 *   const db = new DatabaseSync('app.db');
 *   db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000');
 *   const store = createStore({ driver: sqliteDriver(db), declare: { title: ['title'] } });
 */
export const sqliteDriver = (db: Database): Driver => {
	let declared: Declaration = {};
	let closed = false;
	let installed = false;

	const open = (): void => {
		if (closed) {
			throw codecError('driver-closed', 'this driver was closed',
				'Open a new store; a closed driver cannot be reused.');
		}
	};

	const statements = new Map<string, Statement>();
	const sql = (text: string): Statement => {
		let statement = statements.get(text);
		if (statement === undefined) statements.set(text, statement = db.prepare(text));
		return statement;
	};

	// Nothing between BEGIN and COMMIT awaits, so no other call on this handle can run inside the
	// transaction, and the IMMEDIATE takes the write lock before the first read.
	const transaction = <T>(work: () => T): T => {
		db.exec('BEGIN IMMEDIATE');
		try {
			const out = work();
			db.exec('COMMIT');
			return out;
		} catch (e) {
			// SQLite ends the transaction itself on some failures, and then there is nothing to roll
			// back; the error worth reporting is the one that got us here.
			try { db.exec('ROLLBACK'); } catch { /* already gone */ }
			throw e;
		}
	};

	const ready = (): void => {
		if (installed) return;
		transaction(() => {
			db.exec(VERSION_TABLE);
			sql('INSERT INTO aweft_version (one, version) VALUES (1, ?) ON CONFLICT (one) DO NOTHING').run(VERSION);
			const found = (sql('SELECT version FROM aweft_version WHERE one = 1').get() as { version: number | bigint } | undefined)?.version;
			if (Number(found) !== VERSION) {
				throw codecError(
					'unknown-version',
					`these tables are version ${String(found)} and this driver writes version ${String(VERSION)}`,
					'Open a database this driver made, or run the driver whose version matches the tables.',
				);
			}
			for (const table of TABLES) db.exec(table);
		});
		installed = true;
	};

	const rowsOf = (doc: string): Row[] =>
		(sql('SELECT id, kind, parent, slot, slots FROM aweft_rows WHERE doc = ?').all(doc) as
			{ id: string; kind: ObservableKind; parent: string | null; slot: string | null; slots: string }[])
			.map((r) => ({
				id: r.id, kind: r.kind, parent: r.parent, slot: r.slot,
				slots: Object.fromEntries(Object.entries(JSON.parse(r.slots) as Record<string, unknown>)
					.map(([slot, v]) => [slot, unpacked(v)])),
			}));

	const fieldsOf = (doc: string): Record<string, Indexable> => {
		const out: Record<string, Indexable> = {};
		for (const row of sql('SELECT field, rank, bool_value, num_value, text_value FROM aweft_projection WHERE doc = ?')
			.all(doc) as (Projected & { field: string })[]) {
			out[row.field] = valueOf(row);
		}
		return out;
	};

	// The sort field, the value the hit had under it, and the name (design 060).
	const mint = (field: string | null, value: Indexable, doc: string): string =>
		JSON.stringify([field, value, doc]);

	const refuse = (detail: string): never => {
		throw codecError('cursor', detail,
			'Page with the cursor the previous page of this same query handed back.');
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

	// Design 162, as the Postgres driver does it: a field is behind when nothing projected it for
	// a document, or when it was projected from a path that has since changed, and a field the
	// declaration no longer names leaves the projection. `aweft_declared` holds the paths the
	// index was built from.
	const reconcile = (declaration: Declaration): void => transaction(() => {
		const fields = Object.keys(declaration);
		const stored = new Map((sql('SELECT field, path FROM aweft_declared').all() as { field: string; path: string }[])
			.map((r) => [r.field, r.path]));
		const behind: Record<string, readonly string[]> = {};
		for (const [field, path] of Object.entries(declaration)) {
			if (stored.get(field) !== JSON.stringify(path)) behind[field] = path;
		}

		const owed = new Map<string, { root: string; want: Record<string, readonly string[]> }>();
		if (Object.keys(behind).length > 0) {
			for (const { doc, root } of sql('SELECT doc, root FROM aweft_documents').all() as { doc: string; root: string }[]) {
				owed.set(doc, { root, want: { ...behind } });
			}
		}
		const unchanged = fields.filter((field) => !Object.hasOwn(behind, field));
		if (unchanged.length > 0) {
			const gaps = sql(`SELECT d.doc, d.root, wanted.value AS field
				FROM aweft_documents d, json_each(?) AS wanted
				WHERE NOT EXISTS (
					SELECT 1 FROM aweft_projection p WHERE p.doc = d.doc AND p.field = wanted.value)`)
				.all(JSON.stringify(unchanged)) as { doc: string; root: string; field: string }[];
			for (const { doc, root, field } of gaps) {
				const held = owed.get(doc) ?? { root, want: {} };
				held.want[field] = declaration[field]!;
				owed.set(doc, held);
			}
		}
		for (const [doc, { root, want }] of owed) {
			for (const [field, value] of Object.entries(projectionOf(rowsOf(doc), root, want))) {
				sql(FIELD_UPSERT).run(doc, field, ...cells(value));
			}
		}

		const named = JSON.stringify(fields);
		sql('DELETE FROM aweft_projection WHERE field NOT IN (SELECT value FROM json_each(?))').run(named);
		for (const [field, path] of Object.entries(declaration)) {
			sql('INSERT INTO aweft_declared (field, path) VALUES (?, ?) ON CONFLICT (field) DO UPDATE SET path = excluded.path')
				.run(field, JSON.stringify(path));
		}
		sql('DELETE FROM aweft_declared WHERE field NOT IN (SELECT value FROM json_each(?))').run(named);
	});

	// Slot by slot, never the row whole (design 047). The slots go through a Map so that a slot
	// named `__proto__` is a slot rather than a prototype. An absent `edge` keeps the stored one;
	// a null one detaches, and the slots stay either way (design 048).
	const merge = (doc: string, patch: Patch): void => {
		const held = sql('SELECT parent, slot, slots FROM aweft_rows WHERE doc = ? AND id = ?').get(doc, patch.id) as
			{ parent: string | null; slot: string | null; slots: string } | undefined;
		const slots = new Map(Object.entries(held === undefined ? {} : JSON.parse(held.slots) as Record<string, unknown>));
		for (const [slot, value] of Object.entries(patch.set)) slots.set(slot, packed(value));
		for (const slot of patch.unset) slots.delete(slot);
		const edge = patch.edge === undefined
			? { parent: held?.parent ?? null, slot: held?.slot ?? null }
			: patch.edge ?? { parent: null, slot: null };
		sql(ROW_UPSERT).run(doc, patch.id, patch.kind, edge.parent, edge.slot, JSON.stringify(Object.fromEntries(slots)));
	};

	const write = async (w: Write): Promise<number> => {
		open();
		ready();
		noZeroByte('the document name', w.doc);
		for (const patch of w.rows) {
			for (const [slot, value] of Object.entries(patch.set)) {
				noZeroByte(`a slot name on ${patch.id}`, slot);
				if (typeof value === 'string') noZeroByte(`the slot ${slot} of ${patch.id}`, value);
			}
			for (const slot of patch.unset) noZeroByte(`an unset slot name on ${patch.id}`, slot);
		}
		for (const [field, value] of Object.entries(w.project ?? {})) {
			if (typeof value === 'string') noZeroByte(`the projected field ${field}`, value);
		}

		return transaction(() => {
			let document = sql('SELECT root, head FROM aweft_documents WHERE doc = ?').get(w.doc) as
				{ root: string; head: number | bigint } | undefined;
			if (document === undefined) {
				sql('INSERT INTO aweft_documents (doc, root, root_kind, head) VALUES (?, ?, ?, 0)').run(w.doc, w.root, w.rootKind);
				document = { root: w.root, head: 0 };
			}
			if (document.root !== w.root) {
				throw codecError('root-conflict', `${w.doc} has root ${document.root}, not ${w.root}`,
					'Write to a name nothing holds, or remove the stored document first.');
			}

			const seq = Number(document.head) + 1;
			for (const patch of w.rows) merge(w.doc, patch);
			sql('INSERT INTO aweft_tail (doc, seq, body) VALUES (?, ?, ?)').run(w.doc, seq, w.body);
			for (const [field, value] of Object.entries(w.project ?? {})) {
				if (!Object.hasOwn(declared, field)) continue;
				sql(FIELD_UPSERT).run(w.doc, field, ...cells(value));
			}
			sql('UPDATE aweft_documents SET head = ? WHERE doc = ?').run(seq, w.doc);
			return seq;
		});
	};

	/** One condition, as index bounds on the projection's typed columns. */
	const condition = (where: Where, param: (value: Indexable) => string): string => {
		const bounds = (op: string, value: Indexable): string => {
			const column = columnOf(value);
			const parts = [`p.rank = ${String(rankOf(value))}`];
			for (const held of COLUMNS) {
				parts.push(held === column ? `p.${held} ${op} ${param(value)}` : `p.${held} IS NULL`);
			}
			return parts.join(' AND ');
		};

		if (where.op === 'eq') return bounds('=', where.value);
		// `holds` refuses a comparison against null, so a range against null matches nothing.
		if (where.value === null) return '0';
		const op = where.op === 'gt' ? '>' : where.op === 'gte' ? '>=' : where.op === 'lt' ? '<' : '<=';
		return bounds(op, where.value);
	};

	// Past the position the cursor carries, never past where its document ranks now (design 060).
	// The name breaks a tie in ascending order under both directions, as every driver does.
	const seek = (
		key: string | null, at: { value: Indexable; doc: string }, desc: boolean,
		param: (value: Indexable) => string,
	): string => {
		const after = `p.doc > ${param(at.doc)}`;
		if (key === null) return after;

		const rank = rankOf(at.value);
		const column = `s.${columnOf(at.value)}`;
		const past = desc ? `${key} < ${String(rank)}` : `${key} > ${String(rank)}`;
		const same = `${key} = ${String(rank)}`;
		if (at.value === null) return desc ? `(${same} AND ${after})` : `(${past} OR (${same} AND ${after}))`;

		const nearer = `${same} AND ${column} ${desc ? '<' : '>'} ${param(at.value)}`;
		return `(${past} OR (${nearer}) OR (${same} AND ${column} = ${param(at.value)} AND ${after}))`;
	};

	const find = async (lookup: Lookup): Promise<Found[]> => {
		open();
		ready();
		if (!Object.hasOwn(declared, lookup.where.field)) {
			throw codecError('undeclared', `${lookup.where.field} has no index here`,
				'Declare the path in createStore, or call scan to read without an index.');
		}

		const sort = lookup.sort?.field ?? null;
		const desc = lookup.sort?.direction === 'desc';
		// Numbered, because `seek` writes its placeholders in another order than it asks for them.
		const values: Value[] = [];
		const param = (value: Indexable): string => `?${String(values.push(bound(value)))}`;

		const parts = [`p.field = ${param(lookup.where.field)}`, condition(lookup.where, param)];
		// A document with no row for the sort field sorts as null.
		const key = sort === null ? null : 'COALESCE(s.rank, 0)';
		const join = sort === null
			? ''
			: ` LEFT JOIN aweft_projection s ON s.doc = p.doc AND s.field = ${param(sort)}`;
		if (lookup.after !== undefined) parts.push(seek(key, parseCursor(lookup.after, sort), desc, param));

		const direction = desc ? 'DESC' : 'ASC';
		const order = key === null
			? 'p.doc ASC'
			: `${key} ${direction}, s.bool_value ${direction}, s.num_value ${direction}, `
				+ `s.text_value ${direction}, p.doc ASC`;
		const limit = lookup.limit === undefined ? '' : ` LIMIT ${param(lookup.limit)}`;

		const docs = (sql(
			`SELECT p.doc FROM aweft_projection p${join} WHERE ${parts.join(' AND ')} ORDER BY ${order}${limit}`,
		).all(...values) as { doc: string }[]).map((r) => r.doc);
		return docs.map((doc) => {
			const fields = fieldsOf(doc);
			return { doc, fields, cursor: mint(sort, sort === null ? null : fields[sort] ?? null, doc) };
		});
	};

	const scan = async (limit: number, after?: string): Promise<Found[]> => {
		open();
		ready();
		const at = after === undefined ? null : parseCursor(after, null).doc;
		const docs = (sql('SELECT doc FROM aweft_documents WHERE (?1 IS NULL OR doc > ?1) ORDER BY doc LIMIT ?2')
			.all(at, limit) as { doc: string }[]).map((r) => r.doc);
		return docs.map((doc) => ({ doc, fields: fieldsOf(doc), cursor: mint(null, null, doc) }));
	};

	const create = async (doc: string, root: string, rootKind: ObservableKind): Promise<boolean> => {
		open();
		ready();
		noZeroByte('the document name', doc);
		return transaction(() => {
			const made = Number(sql(`INSERT INTO aweft_documents (doc, root, root_kind, head) VALUES (?, ?, ?, 0)
				ON CONFLICT (doc) DO NOTHING`).run(doc, root, rootKind).changes) === 1;
			// A document created and never written holds nothing, and nothing is what every
			// declared path reads out of it; without these rows it would be missing from `find`,
			// `field eq null` included, until somebody wrote to it.
			if (made) {
				for (const field of Object.keys(declared)) sql(FIELD_UPSERT).run(doc, field, ...cells(null));
			}
			return made;
		});
	};

	const read = async (doc: string): Promise<{ root: string; rootKind: ObservableKind; rows: Row[] } | null> => {
		open();
		ready();
		const document = sql('SELECT root, root_kind FROM aweft_documents WHERE doc = ?').get(doc) as
			{ root: string; root_kind: ObservableKind } | undefined;
		if (document === undefined) return null;
		return { root: document.root, rootKind: document.root_kind, rows: rowsOf(doc) };
	};

	const since = async (doc: string, seq: number): Promise<Entry[]> => {
		open();
		ready();
		return (sql('SELECT seq, body FROM aweft_tail WHERE doc = ? AND seq > ? ORDER BY seq').all(doc, seq) as
			{ seq: number | bigint; body: Uint8Array }[])
			.map((e) => ({ seq: Number(e.seq), body: new Uint8Array(e.body) }));
	};

	const head = async (doc: string): Promise<number> => {
		open();
		ready();
		const held = sql('SELECT head FROM aweft_documents WHERE doc = ?').get(doc) as { head: number | bigint } | undefined;
		return held === undefined ? 0 : Number(held.head);
	};

	const truncate = async (doc: string, seq: number): Promise<void> => {
		open();
		ready();
		sql('DELETE FROM aweft_tail WHERE doc = ? AND seq <= ?').run(doc, seq);
	};

	const forget = async (doc: string, ids: readonly string[]): Promise<void> => {
		open();
		ready();
		transaction(() => {
			for (const id of ids) sql('DELETE FROM aweft_rows WHERE doc = ? AND id = ?').run(doc, id);
		});
	};

	const remove = async (doc: string): Promise<void> => {
		open();
		ready();
		transaction(() => {
			for (const table of ['aweft_rows', 'aweft_tail', 'aweft_projection', 'aweft_documents']) {
				sql(`DELETE FROM ${table} WHERE doc = ?`).run(doc);
			}
		});
	};

	// The handle belongs to whoever opened it, and may hold the application's own tables.
	const close = async (): Promise<void> => { closed = true; };

	const declare = async (declaration: Declaration): Promise<void> => {
		open();
		for (const field of Object.keys(declaration)) noZeroByte(`the declared field ${field}`, field);
		ready();
		reconcile(declaration);
		declared = declaration;
	};

	return {
		declare, find, scan, write, create, read, since, head, truncate, forget, remove, close,
	};
};
