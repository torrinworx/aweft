// What a write costs on the Postgres driver, and what a declared read costs through its index.
//
// Design 047 is built on a measurement made before `store` existed: one field of one record
// changed per edit, against writing the document whole. This is that measurement again, on the
// driver the stack actually ships, so the README cites a script in this repo rather than a
// number from a run nobody can repeat.
//
// Write-ahead log bytes are the second number because latency alone hides the cost: Postgres
// has no in-place update, so a design that rewrites a row pays for the whole row in the log
// whatever the edit was.
//
// Run: node bench/store-postgres.ts
//
// CI does not gate on this. A performance claim cites this script and its recorded output.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

import { atomic, createObject } from '@aweftjs/core';
import { createStore } from '@aweftjs/store';
import { postgresDriver } from '@aweftjs/store/postgres';

type Doc = Record<string, unknown>;
const DATABASE = 'bench';

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
	const probe = createServer();
	probe.on('error', reject);
	probe.listen(0, () => {
		const at = probe.address();
		const port = typeof at === 'object' && at !== null ? at.port : 0;
		probe.close(() => resolve(port));
	});
});

const directory = mkdtempSync(join(tmpdir(), 'aweft-pg-'));
const port = await freePort();
const server = new EmbeddedPostgres({
	databaseDir: directory, port, user: 'postgres', password: 'password',
	persistent: false, onLog: () => {}, onError: () => {},
});
await server.initialise();
await server.start();
await server.createDatabase(DATABASE);

const pool = new pg.Pool({
	host: 'localhost', port, user: 'postgres', password: 'password', database: DATABASE, max: 8,
});

const one = async <T>(text: string, values: unknown[] = []): Promise<T> =>
	(await pool.query(text, values)).rows[0] as T;

/** Where the write-ahead log is now, so a later call can say how much of it a run wrote. */
const walAt = async (): Promise<string> =>
	(await one<{ at: string }>('SELECT pg_current_wal_lsn() AS at')).at;

const walSince = async (before: string): Promise<number> => Number(
	(await one<{ wrote: string }>(
		'SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1) AS wrote', [before])).wrote);

/** What the driver is holding for one document, in bytes, as it stores it. */
const storedBytes = async (doc: string): Promise<number> => Number(
	(await one<{ bytes: string }>(
		`SELECT COALESCE(SUM(octet_length(slots::text) + octet_length(id) + 24), 0) AS bytes
		 FROM aweft_rows WHERE doc = $1`, [doc])).bytes);

// A document of `records` records, each a small object of five fields, which is the shape
// design 047 measured: a list of records where an edit touches one field of one of them.
const build = async (doc: string, records: number): Promise<{ store: ReturnType<typeof createStore>; items: Doc[] }> => {
	const store = createStore({ driver: postgresDriver(pool), declare: { owner: ['owner'] } });
	const handle = await store.open(doc);
	const root = handle.root as Doc;
	const items: Doc[] = [];
	atomic(() => { root.owner = 'u_7'; });
	for (let i = 0; i < records; i++) {
		const item = createObject<Doc>({
			title: `record number ${i}`,
			body: `some prose about record ${i}, long enough to be a real field rather than a token`,
			status: i % 3 === 0 ? 'open' : 'done',
			weight: i,
			at: `2026-09-0${(i % 9) + 1}T12:00:00.000Z`,
		});
		root[`r${i}`] = item;
		items.push(item);
	}
	await store.settled(handle);
	return { store, items };
};

const edits = async (label: string, records: number, runs: number): Promise<void> => {
	const doc = `doc${records}`;
	const { store, items } = await build(doc, records);
	const held = await storedBytes(doc);

	// Warm the connection and the plan, so the numbers are the write rather than the first one.
	for (let i = 0; i < 20; i++) { items[0]!.title = `warm ${i}`; }
	await store.settled(await store.open(doc));

	const before = await walAt();
	const started = process.hrtime.bigint();
	for (let i = 0; i < runs; i++) {
		items[i % records]!.title = `edit ${i}`;
		await store.settled(await store.open(doc));
	}
	const took = Number(process.hrtime.bigint() - started) / 1e6;
	const wrote = await walSince(before);
	await store.stop();

	console.log(`  ${label.padEnd(26)} ${(held / 1024).toFixed(0).padStart(5)} KB stored `
		+ `${(took / runs).toFixed(3).padStart(8)} ms/write `
		+ `${(wrote / runs / 1024).toFixed(2).padStart(7)} KB WAL/write`);
};

console.log('\n## one field of one record, edited over and over');
console.log('   the cost has to follow the change, not the document (design 047)');
await edits('a 150 KB document', 515, 200);
await edits('a 620 KB document', 2110, 200);

console.log('\n## a declared read against 20,000 documents');
{
	const store = createStore({
		driver: postgresDriver(pool),
		declare: { owner: ['owner'], weight: ['weight'] },
	});
	const started = process.hrtime.bigint();
	for (let i = 0; i < 20000; i++) {
		const handle = await store.open(`small${i}`);
		atomic(() => {
			(handle.root as Doc).owner = `u_${i % 500}`;
			(handle.root as Doc).weight = i;
		});
		await store.settled(handle);
		await store.close(handle);
	}
	console.log(`  built 20,000 documents in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
	await pool.query('ANALYZE aweft_projection');

	let best = Infinity;
	for (let attempt = 0; attempt < 5; attempt++) {
		const at = process.hrtime.bigint();
		const hits = await store.find({ where: [{ field: 'owner', op: 'eq', value: 'u_311' }], limit: 40 });
		const took = Number(process.hrtime.bigint() - at) / 1e6;
		if (attempt === 0) console.log(`  ${String(hits.length)} hits`);
		if (took < best) best = took;
	}
	console.log(`  find through the index      ${best.toFixed(3).padStart(8)} ms`);

	// The query the driver sends for `owner eq 'u_311'`, spelled out so the plan is visible.
	// Every value column is a bound, which is what makes this a lookup rather than a scan of
	// the field.
	const plan = await pool.query(
		`EXPLAIN SELECT p.doc FROM aweft_projection p
		 WHERE p.field = 'owner' AND p.rank = 3 AND p.bool_value IS NULL AND p.num_value IS NULL
		   AND p.text_value = 'u_311' ORDER BY p.doc ASC LIMIT 40`);
	for (const line of plan.rows as { 'QUERY PLAN': string }[]) console.log(`  ${line['QUERY PLAN']}`);

	await store.stop();
}

await pool.end();
await server.stop();
rmSync(directory, { recursive: true, force: true });
