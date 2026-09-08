// A driver that keeps documents in Postgres.
//
// On its own subpath because it is an adapter for something the stack can use and must not
// require (design 140). It imports nothing: the pool is typed structurally here, so an
// application hands in the one it already made for its own SQL and this package lists no peer
// and never ends a connection it did not open (design 160).
//
// The tables are made here, in whatever schema the pool's `search_path` names, on the first
// call that needs them, which is `declare` whenever a store made the driver. Two applications
// on one database keep apart by schema, which the pool already decides.
//
// A write is one transaction under the document's row lock (design 161). That lock is what
// makes the sequence contiguous: `MAX(seq) + 1` races under read committed and two appends
// collide on the tail's key. Everything else in the write rides in the same transaction,
// because rows that disagree with the tail beside them is the one corruption this design can
// produce.

import { codecError, type ObservableKind } from '@aweftjs/codec';
import type { SnapshotValue } from '@aweftjs/core';

import type { Driver, Entry, Found, Lookup, Patch, Row, Write } from './driver.ts';
import { projectionOf } from './projection.ts';
import type { Declaration, Indexable, Where } from './query.ts';

/**
 * One connection, borrowed from a pool.
 *
 * `pg`'s `PoolClient` is one. Stated structurally so this file imports nothing.
 */
export interface PoolClient {
	query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
	release(): void;
}

/**
 * Where the driver gets its connections.
 *
 * `pg`'s `Pool` is one. The application makes it, decides how many connections it has, how it
 * authenticates and which schema it lands in, and ends it; the driver only borrows.
 */
export interface Pool {
	connect(): Promise<PoolClient>;
}

/**
 * The shape of the tables this driver knows. A row carrying any other number is refused before
 * anything is read, because the driver would otherwise write into tables it does not
 * understand.
 */
const VERSION = 1;

// The advisory lock the install takes, so two processes making the tables at the same instant
// take turns. Any constant does; this one is fixed so every process picks the same one.
const INSTALL_LOCK = 6862397;

/** The value columns of the projection, in the order `compare` puts their kinds. */
const COLUMNS = ['bool_value', 'num_value', 'text_value'] as const;

// `compare` orders null, then boolean, then number, then string. Postgres orders a jsonb value
// by another rule entirely, so the kind is stored as this rank and the index leads with it: one
// composite index then pages every declared field in the order every driver has to produce.
const rankOf = (value: Indexable): number =>
	value === null ? 0 : typeof value === 'boolean' ? 1 : typeof value === 'number' ? 2 : 3;

const columnOf = (value: Indexable): string => COLUMNS[rankOf(value) - 1] ?? '';

// Bytes in a slot, on their way through jsonb (design 163). No reference carries this key and
// no primitive is an object, so the shape is unambiguous on the way back.
const packed = (value: SnapshotValue): unknown =>
	value instanceof Uint8Array ? { bytes: Buffer.from(value).toString('base64') } : value;

const unpacked = (value: unknown): SnapshotValue => {
	if (value !== null && typeof value === 'object' && 'bytes' in value) {
		return new Uint8Array(Buffer.from((value as { bytes: string }).bytes, 'base64'));
	}
	return value as SnapshotValue;
};

const packedSlots = (slots: Readonly<Record<string, SnapshotValue>>): string =>
	JSON.stringify(Object.fromEntries(Object.entries(slots).map(([slot, v]) => [slot, packed(v)])));

const unpackedSlots = (slots: Record<string, unknown>): Record<string, SnapshotValue> =>
	Object.fromEntries(Object.entries(slots).map(([slot, v]) => [slot, unpacked(v)]));

/** The tables, made idempotently. The version table comes first, so its guard runs first. */
const VERSION_TABLE = `CREATE TABLE IF NOT EXISTS aweft_version (
	one boolean PRIMARY KEY,
	version integer NOT NULL
)`;

// `text_value` is collated C so that ordering is by code point rather than by the locale
// initdb happened to pick, which is what `compare` does and what every other driver produces.
const TABLES = [
	`CREATE TABLE IF NOT EXISTS aweft_documents (
		doc text PRIMARY KEY,
		root text NOT NULL,
		root_kind text NOT NULL,
		head integer NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS aweft_rows (
		doc text NOT NULL REFERENCES aweft_documents (doc) ON DELETE CASCADE,
		id text NOT NULL,
		kind text NOT NULL,
		parent text,
		slot text,
		slots jsonb NOT NULL DEFAULT '{}'::jsonb,
		PRIMARY KEY (doc, id)
	)`,
	`CREATE TABLE IF NOT EXISTS aweft_tail (
		doc text NOT NULL REFERENCES aweft_documents (doc) ON DELETE CASCADE,
		seq integer NOT NULL,
		body bytea NOT NULL,
		PRIMARY KEY (doc, seq)
	)`,
	`CREATE TABLE IF NOT EXISTS aweft_projection (
		doc text NOT NULL REFERENCES aweft_documents (doc) ON DELETE CASCADE,
		field text NOT NULL,
		rank smallint NOT NULL,
		bool_value boolean,
		num_value double precision,
		text_value text COLLATE "C",
		PRIMARY KEY (doc, field)
	)`,
	`CREATE INDEX IF NOT EXISTS aweft_projection_order
		ON aweft_projection (field, rank, bool_value, num_value, text_value, doc)`,
	// The paths the projection was built from, so `declare` can tell a field nothing has
	// projected from one projected under a path that has since changed.
	`CREATE TABLE IF NOT EXISTS aweft_declared (
		field text PRIMARY KEY,
		path jsonb NOT NULL
	)`,
];

// The unset list is taken off in both branches. A patch that names a slot in `set` and the same
// one in `unset` is not the case: `record` never produces one. A patch that creates a row and
// unsets a slot is, and a driver that only subtracts on the merge stores what it was told to
// remove.
const ROW_UPSERT = `INSERT INTO aweft_rows (doc, id, kind, parent, slot, slots)
	VALUES ($1, $2, $3, $4, $5, $6::jsonb - $8::text[])
	ON CONFLICT (doc, id) DO UPDATE SET
		kind = EXCLUDED.kind,
		parent = CASE WHEN $7 THEN EXCLUDED.parent ELSE aweft_rows.parent END,
		slot = CASE WHEN $7 THEN EXCLUDED.slot ELSE aweft_rows.slot END,
		slots = (aweft_rows.slots || EXCLUDED.slots) - $8::text[]`;

const FIELD_UPSERT = `INSERT INTO aweft_projection (doc, field, rank, bool_value, num_value, text_value)
	VALUES ($1, $2, $3, $4, $5, $6)
	ON CONFLICT (doc, field) DO UPDATE SET
		rank = EXCLUDED.rank,
		bool_value = EXCLUDED.bool_value,
		num_value = EXCLUDED.num_value,
		text_value = EXCLUDED.text_value`;

/** The typed columns of one projected value: its rank and the one column that holds it. */
const cells = (value: Indexable): [number, boolean | null, number | null, string | null] => [
	rankOf(value),
	typeof value === 'boolean' ? value : null,
	typeof value === 'number' ? value : null,
	typeof value === 'string' ? value : null,
];

// Postgres stores no text holding a zero byte, in a jsonb string or a text column alike, and
// what comes back without this is a bare driver error from inside a transaction that has
// already written half of a commit. Checked before the transaction opens, so nothing is undone.
const noZeroByte = (where: string, value: string): void => {
	if (value.includes('\u0000')) {
		throw codecError('zero-byte', `${where} holds a zero byte, and Postgres stores no text that does`,
			'Strip the zero byte from the string before writing it.');
	}
};

const valueOf = (row: { rank: number; bool_value: boolean | null; num_value: number | null; text_value: string | null }): Indexable => {
	if (row.rank === 1) return row.bool_value;
	if (row.rank === 2) return row.num_value;
	if (row.rank === 3) return row.text_value;
	return null;
};

/**
 * A driver that keeps documents in Postgres.
 *
 * Params:
 *   pool: where connections come from. `pg`'s `Pool` is one. The driver borrows and returns
 *         them and never ends the pool, because the application made it
 *
 * Returns: a `Driver`. It makes its tables on `declare`, in the schema the pool's `search_path`
 * names, and brings the projection into line with the declaration before `declare` resolves:
 * a field nothing projected, or one projected under a path that has since changed, is computed
 * again from every document's rows, and a field the declaration no longer names is dropped.
 *
 * The driver throws `unknown-version` when the tables in that schema were made by a driver of
 * another shape, `driver-closed` after `close`, `undeclared` when a lookup names a field
 * nothing indexed, `cursor` when a page is asked for with a cursor from another sort, and
 * `root-conflict` when a write names a root the stored document does not have.
 *
 * Nothing is told that a document changed. Live updates go through `sync`.
 *
 * Example:
 *   import { Pool } from 'pg';
 *   import { createStore } from '@aweftjs/store';
 *   import { postgresDriver } from '@aweftjs/store/postgres';
 *
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   const store = createStore({ driver: postgresDriver(pool), declare: { title: ['title'] } });
 */
export const postgresDriver = (pool: Pool): Driver => {
	let declared: Declaration = {};
	let closed = false;

	const open = (): void => {
		if (closed) {
			throw codecError('driver-closed', 'this driver was closed',
				'Open a new store; a closed driver cannot be reused.');
		}
	};

	const borrow = async <T>(use: (client: PoolClient) => Promise<T>): Promise<T> => {
		const client = await pool.connect();
		try { return await use(client); } finally { client.release(); }
	};

	const rowsOf = async (client: PoolClient, doc: string): Promise<Row[]> => {
		const held = await client.query(
			'SELECT id, kind, parent, slot, slots FROM aweft_rows WHERE doc = $1', [doc]);
		return (held.rows as { id: string; kind: ObservableKind; parent: string | null; slot: string | null; slots: Record<string, unknown> }[])
			.map((r) => ({ id: r.id, kind: r.kind, parent: r.parent, slot: r.slot, slots: unpackedSlots(r.slots) }));
	};

	// Every projected field of the documents a page found, as one more query. Design 161: the
	// driver gathers them rather than the store reopening each document to ask.
	const fieldsOf = async (client: PoolClient, docs: readonly string[]): Promise<Map<string, Record<string, Indexable>>> => {
		const out = new Map<string, Record<string, Indexable>>(docs.map((doc) => [doc, {}]));
		if (docs.length === 0) return out;
		const held = await client.query(
			`SELECT doc, field, rank, bool_value, num_value, text_value
			 FROM aweft_projection WHERE doc = ANY($1::text[])`, [docs]);
		for (const row of held.rows as { doc: string; field: string; rank: number; bool_value: boolean | null; num_value: number | null; text_value: string | null }[]) {
			out.get(row.doc)![row.field] = valueOf(row);
		}
		return out;
	};

	// This driver's own cursor: the sort field, the value the hit had under it, and the name, as
	// one JSON text, which is what seeking past a position needs and nothing more (design 060).
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

	const rollback = async (client: PoolClient): Promise<void> => {
		// A connection that died takes its transaction with it, so there is nothing left to
		// undo and the failure worth reporting is the one that got us here.
		try { await client.query('ROLLBACK'); } catch { /* the transaction is already gone */ }
	};

	// The tables are made once, before anything else touches them, and every method waits on
	// the same promise so the work happens on the first call and never again. `declare` is that
	// call whenever a store made the driver, which is the shape design 161 describes; a
	// conformance check that writes without declaring anything still finds its tables.
	let installed: Promise<void> | undefined;
	const ready = (): Promise<void> => installed ??= borrow(install);

	const install = async (client: PoolClient): Promise<void> => {
		await client.query('BEGIN');
		try {
			// Two processes running `CREATE TABLE IF NOT EXISTS` at the same instant collide in
			// the catalogue rather than one of them doing nothing, and eight processes opening
			// one document at once is the case this driver is for.
			await client.query('SELECT pg_advisory_xact_lock($1)', [INSTALL_LOCK]);
			await client.query(VERSION_TABLE);
			await client.query(
				'INSERT INTO aweft_version (one, version) VALUES (true, $1) ON CONFLICT (one) DO NOTHING',
				[VERSION]);
			const held = await client.query('SELECT version FROM aweft_version WHERE one');
			const found = (held.rows[0] as { version: number } | undefined)?.version;
			if (found !== VERSION) {
				throw codecError(
					'unknown-version',
					`these tables are version ${String(found)} and this driver writes version ${String(VERSION)}`,
					'Point the pool at a schema this driver made, or run the driver whose version matches the tables.',
				);
			}
			for (const table of TABLES) await client.query(table);
			await client.query('COMMIT');
		} catch (e) {
			// The next call tries again, because a failure here is a connection or a permission
			// rather than an answer, and a driver that latched would refuse for the rest of the
			// process over something that has since been fixed.
			installed = undefined;
			await rollback(client);
			throw e;
		}
	};

	const declare = async (declaration: Declaration): Promise<void> => {
		open();
		await ready();
		await borrow((client) => reconcile(client, declaration));
		declared = declaration;
	};

	// Design 162, and what the driver has to do to keep the index and the declaration saying
	// the same thing. A field is behind when nothing projected it, and equally when something
	// projected it from another path, which reads worse: `find` keeps answering from the path
	// that was declared last time and nothing says so. A field the declaration no longer names
	// leaves the projection, so `Found.fields` carries what is declared now and nothing else.
	//
	// `aweft_declared` is what makes that decidable: the paths this index was built from. One
	// transaction under the same advisory lock as the install, so two processes declaring at
	// once take turns rather than half filling one index between them.
	const reconcile = async (client: PoolClient, declaration: Declaration): Promise<void> => {
		const fields = Object.keys(declaration);

		await client.query('BEGIN');
		try {
			await client.query('SELECT pg_advisory_xact_lock($1)', [INSTALL_LOCK]);

			const stored = new Map((await client.query('SELECT field, path FROM aweft_declared')).rows
				.map((r) => [(r as { field: string }).field, JSON.stringify((r as { path: string[] }).path)]));
			const behind: Record<string, readonly string[]> = {};
			for (const [field, path] of Object.entries(declaration)) {
				if (stored.get(field) !== JSON.stringify(path)) behind[field] = path;
			}

			// What each document is missing, by name. A changed path is wrong for every document
			// at once; an unchanged one can still be missing from a document nothing has
			// projected, which is a document created and never written, or one written before the
			// field existed. Both leave a hole the index has no row for, and a hole answers
			// nothing, not even `field eq null`.
			const owed = new Map<string, { root: string; want: Record<string, readonly string[]> }>();
			if (Object.keys(behind).length > 0) {
				const all = await client.query('SELECT doc, root FROM aweft_documents');
				for (const { doc, root } of all.rows as { doc: string; root: string }[]) {
					owed.set(doc, { root, want: { ...behind } });
				}
			}
			const unchanged = fields.filter((field) => !(field in behind));
			if (unchanged.length > 0) {
				const gaps = await client.query(
					`SELECT d.doc, d.root, wanted.field FROM aweft_documents d
					 CROSS JOIN unnest($1::text[]) AS wanted (field)
					 WHERE NOT EXISTS (
						SELECT 1 FROM aweft_projection p WHERE p.doc = d.doc AND p.field = wanted.field)`,
					[unchanged]);
				for (const { doc, root, field } of gaps.rows as { doc: string; root: string; field: string }[]) {
					const held = owed.get(doc) ?? { root, want: {} };
					held.want[field] = declaration[field]!;
					owed.set(doc, held);
				}
			}
			for (const [doc, { root, want }] of owed) {
				for (const [field, value] of Object.entries(projectionOf(await rowsOf(client, doc), root, want))) {
					await client.query(FIELD_UPSERT, [doc, field, ...cells(value)]);
				}
			}

			await client.query('DELETE FROM aweft_projection WHERE NOT (field = ANY($1::text[]))', [fields]);
			// Written over rather than replaced, so a second reconcile arriving behind this one
			// cannot collide on the key.
			for (const [field, path] of Object.entries(declaration)) {
				await client.query(
					`INSERT INTO aweft_declared (field, path) VALUES ($1, $2::jsonb)
					 ON CONFLICT (field) DO UPDATE SET path = EXCLUDED.path`,
					[field, JSON.stringify(path)]);
			}
			await client.query('DELETE FROM aweft_declared WHERE NOT (field = ANY($1::text[]))', [fields]);
			await client.query('COMMIT');
		} catch (e) {
			await rollback(client);
			throw e;
		}
	};

	const write = async (w: Write): Promise<number> => {
		open();
		await ready();
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

		return borrow(async (client) => {
			await client.query('BEGIN');
			try {
				// The lock, and the whole reason a write is a transaction: it serialises every
				// writer of this document at the one point that has to be serial, and nothing
				// else waits.
				const locked = async (): Promise<{ root: string; head: number } | undefined> => {
					const held = await client.query(
						'SELECT root, head FROM aweft_documents WHERE doc = $1 FOR UPDATE', [w.doc]);
					return held.rows[0] as { root: string; head: number } | undefined;
				};

				let document = await locked();
				if (document === undefined) {
					// A write to a name nothing holds creates it here, inside the same
					// transaction. The insert either puts the row there or loses to a racer whose
					// transaction has committed by the time it returns, so the second lock always
					// finds one.
					await client.query(
						`INSERT INTO aweft_documents (doc, root, root_kind, head) VALUES ($1, $2, $3, 0)
						 ON CONFLICT (doc) DO NOTHING`,
						[w.doc, w.root, w.rootKind]);
					document = (await locked())!;
				}
				if (document.root !== w.root) {
					throw codecError('root-conflict', `${w.doc} has root ${document.root}, not ${w.root}`,
						'Write to a name nothing holds, or remove the stored document first.');
				}

				const seq = document.head + 1;

				for (const patch of w.rows) await merge(client, w.doc, patch);

				await client.query('INSERT INTO aweft_tail (doc, seq, body) VALUES ($1, $2, $3)',
					[w.doc, seq, Buffer.from(w.body)]);

				for (const [field, value] of Object.entries(w.project ?? {})) {
					if (!(field in declared)) continue;
					await client.query(FIELD_UPSERT, [w.doc, field, ...cells(value)]);
				}

				await client.query('UPDATE aweft_documents SET head = $2 WHERE doc = $1', [w.doc, seq]);
				await client.query('COMMIT');
				return seq;
			} catch (e) {
				await rollback(client);
				throw e;
			}
		});
	};

	// Slot by slot, never the row whole: two writers touching different slots of one observable
	// must both survive, which is the failure design 047 was written against one level down.
	// An absent `edge` means the stored edge is unchanged; a null one means detached, and the
	// slots stay either way (design 048).
	const merge = async (client: PoolClient, doc: string, patch: Patch): Promise<void> => {
		const edge = patch.edge ?? null;
		await client.query(ROW_UPSERT, [
			doc, patch.id, patch.kind, edge?.parent ?? null, edge?.slot ?? null,
			packedSlots(patch.set), patch.edge !== undefined, patch.unset,
		]);
	};

	/** One condition, as index bounds. Every value column is named, so all of them are bounds. */
	const condition = (where: Where, param: (value: unknown) => string): string => {
		// Every value column is named, the two the value does not use as `IS NULL`, so all of
		// them are bounds on the index rather than a filter run over a whole field's rows.
		const bounds = (op: string, value: Indexable): string => {
			const column = columnOf(value);
			const parts = [`p.rank = ${String(rankOf(value))}`];
			for (const held of COLUMNS) {
				parts.push(held === column ? `p.${held} ${op} ${param(value)}` : `p.${held} IS NULL`);
			}
			return parts.join(' AND ');
		};

		if (where.op === 'eq') return bounds('=', where.value);
		// `holds` refuses a comparison against null and one across kinds, so a range against
		// null matches nothing at all rather than everything above it.
		if (where.value === null) return 'false';
		const op = where.op === 'gt' ? '>' : where.op === 'gte' ? '>=' : where.op === 'lt' ? '<' : '<=';
		return bounds(op, where.value);
	};

	// Past the position the cursor carries, never past where its document ranks now: a document
	// that stopped matching, moved, or is gone between two pages is ordinary in a live
	// collection, and looking it up again would restart or skip (design 060). The name breaks
	// the tie in ascending order under both directions, as every driver does.
	const seek = (
		key: string | null, at: { value: Indexable; doc: string }, desc: boolean,
		param: (value: unknown) => string,
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
		await ready();
		if (!(lookup.where.field in declared)) {
			throw codecError('undeclared', `${lookup.where.field} has no index here`,
				'Declare the path in createStore, or call scan to read without an index.');
		}

		const sort = lookup.sort?.field ?? null;
		const desc = lookup.sort?.direction === 'desc';
		const values: unknown[] = [];
		const param = (value: unknown): string => `$${String(values.push(value))}`;

		const parts = [`p.field = ${param(lookup.where.field)}`, condition(lookup.where, param)];
		// A document with no row for the sort field sorts as null, which is what every other
		// driver does with a field it holds no value for.
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

		return borrow(async (client) => {
			const hits = await client.query(
				`SELECT p.doc FROM aweft_projection p${join} WHERE ${parts.join(' AND ')} ORDER BY ${order}${limit}`,
				values);
			const docs = (hits.rows as { doc: string }[]).map((r) => r.doc);
			const fields = await fieldsOf(client, docs);
			return docs.map((doc) => {
				const held = fields.get(doc)!;
				return { doc, fields: held, cursor: mint(sort, sort === null ? null : held[sort] ?? null, doc) };
			});
		});
	};

	const scan = async (limit: number, after?: string): Promise<Found[]> => {
		open();
		await ready();
		const at = after === undefined ? null : parseCursor(after, null).doc;
		return borrow(async (client) => {
			const hits = await client.query(
				`SELECT doc FROM aweft_documents WHERE ($1::text IS NULL OR doc > $1)
				 ORDER BY doc LIMIT $2`, [at, limit]);
			const docs = (hits.rows as { doc: string }[]).map((r) => r.doc);
			const fields = await fieldsOf(client, docs);
			return docs.map((doc) => ({ doc, fields: fields.get(doc)!, cursor: mint(null, null, doc) }));
		});
	};

	const create = async (doc: string, root: string, rootKind: ObservableKind): Promise<boolean> => {
		open();
		await ready();
		noZeroByte('the document name', doc);
		return borrow(async (client) => {
			await client.query('BEGIN');
			try {
				const held = await client.query(
					`INSERT INTO aweft_documents (doc, root, root_kind, head) VALUES ($1, $2, $3, 0)
					 ON CONFLICT (doc) DO NOTHING RETURNING doc`,
					[doc, root, rootKind]);

				// A document that is created and never written holds nothing, and nothing is
				// what every declared path reads out of it. Leaving the rows out would keep it
				// out of `find` on any of them, `field eq null` included, until somebody wrote
				// to it. The winner writes them; the loser leaves the winner's alone.
				if (held.rows.length === 1) {
					for (const field of Object.keys(declared)) {
						await client.query(
							`INSERT INTO aweft_projection (doc, field, rank, bool_value, num_value, text_value)
							 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (doc, field) DO NOTHING`,
							[doc, field, ...cells(null)]);
					}
				}
				await client.query('COMMIT');
				return held.rows.length === 1;
			} catch (e) {
				await rollback(client);
				throw e;
			}
		});
	};

	const read = async (doc: string): Promise<{ root: string; rootKind: ObservableKind; rows: Row[] } | null> => {
		open();
		await ready();
		return borrow(async (client) => {
			const held = await client.query(
				'SELECT root, root_kind FROM aweft_documents WHERE doc = $1', [doc]);
			const document = held.rows[0] as { root: string; root_kind: ObservableKind } | undefined;
			if (document === undefined) return null;
			return { root: document.root, rootKind: document.root_kind, rows: await rowsOf(client, doc) };
		});
	};

	const since = async (doc: string, seq: number): Promise<Entry[]> => {
		open();
		await ready();
		return borrow(async (client) => {
			const held = await client.query(
				'SELECT seq, body FROM aweft_tail WHERE doc = $1 AND seq > $2 ORDER BY seq', [doc, seq]);
			// A fresh Uint8Array rather than the Buffer the driver was handed: the contract says
			// bytes, and a Buffer is a Uint8Array that prints and compares as something else.
			return (held.rows as { seq: number; body: Buffer }[])
				.map((e) => ({ seq: e.seq, body: new Uint8Array(e.body) }));
		});
	};

	const head = async (doc: string): Promise<number> => {
		open();
		await ready();
		return borrow(async (client) => {
			const held = await client.query('SELECT head FROM aweft_documents WHERE doc = $1', [doc]);
			return (held.rows[0] as { head: number } | undefined)?.head ?? 0;
		});
	};

	const truncate = async (doc: string, seq: number): Promise<void> => {
		open();
		await ready();
		await borrow((client) => client.query('DELETE FROM aweft_tail WHERE doc = $1 AND seq <= $2', [doc, seq]));
	};

	const forget = async (doc: string, ids: readonly string[]): Promise<void> => {
		open();
		await ready();
		await borrow((client) => client.query('DELETE FROM aweft_rows WHERE doc = $1 AND id = ANY($2::text[])', [doc, ids]));
	};

	const remove = async (doc: string): Promise<void> => {
		open();
		await ready();
		await borrow((client) => client.query('DELETE FROM aweft_documents WHERE doc = $1', [doc]));
	};

	// The pool belongs to whoever made it. Ending it here would take out an application's own
	// SQL along with the store.
	const close = async (): Promise<void> => { closed = true; };

	return {
		declare, find, scan, write, create, read, since, head, truncate, forget, remove, close,
	};
};
