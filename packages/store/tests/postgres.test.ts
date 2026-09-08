// The Postgres driver, against a real Postgres.
//
// A real server, because the obligations this driver takes on are transactional and nothing
// but a real one enforces a row lock (design 160). One cluster for the file, a schema per
// check, which is also how two applications on one database keep apart.
//
// The suite in `@aweftjs/testing` is the contract; what is here is what the suite cannot see:
// two drivers over one database, the version guard, the order the index pages in, and what a
// rolled back write leaves behind.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

import { compare, createStore, type Indexable } from '../src/index.ts';
import { postgresDriver } from '../src/postgres.ts';
import { createArray, createObject } from '@aweftjs/core';
import { driverChecks, randomBelow, randomFrom } from '@aweftjs/testing';

type Doc = Record<string, unknown>;

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
	const probe = createServer();
	probe.on('error', reject);
	probe.listen(0, () => {
		const at = probe.address();
		const port = typeof at === 'object' && at !== null ? at.port : 0;
		probe.close(() => resolve(port));
	});
});

// The prefix matters: a run that is killed mid-test leaves a Postgres behind, and this is how
// it is found and stopped.
const directory = mkdtempSync(join(tmpdir(), 'aweft-pg-'));
const port = await freePort();
const server = new EmbeddedPostgres({
	databaseDir: directory, port, user: 'postgres', password: 'password',
	persistent: false, onLog: () => {}, onError: () => {},
});
await server.initialise();
await server.start();

const connection = { host: 'localhost', port, user: 'postgres', password: 'password', database: 'postgres' };
const admin = new pg.Pool(connection);
const open: pg.Pool[] = [admin];

let schemas = 0;
/** A pool of its own, in a schema of its own, so two checks never see each other's tables. */
const freshPool = async (): Promise<pg.Pool> => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);
	return poolOn(schema);
};

const poolOn = (schema: string): pg.Pool => {
	const pool = new pg.Pool({ ...connection, options: `-c search_path=${schema}` });
	open.push(pool);
	return pool;
};

after(async () => {
	for (const pool of open) await pool.end();
	await server.stop();
	rmSync(directory, { recursive: true, force: true });
});

for (const check of driverChecks()) {
	test(`[postgres] ${check.name}`, () => check.run(async () => postgresDriver(await freshPool())));
}

test('a driver that finds tables it does not know refuses before it reads anything', async () => {
	const pool = await freshPool();
	await pool.query('CREATE TABLE aweft_version (one boolean PRIMARY KEY, version integer NOT NULL)');
	await pool.query('INSERT INTO aweft_version (one, version) VALUES (true, 9)');

	await assert.rejects(
		() => postgresDriver(pool).declare({}),
		(e: Error) => {
			assert.equal((e as { reason?: string }).reason, 'unknown-version');
			assert.match(e.message, /version 9 and this driver writes version 1/);
			return true;
		},
		'a shape this driver does not know has to be named, not written into',
	);
});

test('a second driver fills in a path declared after the documents were written', async () => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);

	const first = createStore({ driver: postgresDriver(poolOn(schema)), declare: { title: ['title'] } });
	const urgent = await first.open('urgent');
	(urgent.root as Doc).title = 'the urgent one';
	(urgent.root as Doc).meta = createObject<Doc>({ tag: 'now' });
	const quiet = await first.open('quiet');
	(quiet.root as Doc).title = 'the quiet one';
	await first.settled(urgent);
	await first.settled(quiet);
	const heads = [await first.head('urgent'), await first.head('quiet')];
	await first.stop();

	// A path nobody had declared when those two were written, and nothing writes them again.
	const second = createStore({
		driver: postgresDriver(poolOn(schema)),
		declare: { title: ['title'], tag: ['meta', 'tag'] },
	});
	assert.deepEqual(
		(await second.find({ where: [{ field: 'tag', op: 'eq', value: 'now' }] })).map((f) => f.doc),
		['urgent'],
		'a document written before the path was declared is invisible until a driver fills it in',
	);
	assert.deepEqual(
		(await second.find({ where: [{ field: 'tag', op: 'eq', value: null }] })).map((f) => f.doc),
		['quiet'],
		'and one whose new path holds nothing has to answer for null, or it is invisible forever',
	);
	assert.deepEqual([await second.head('urgent'), await second.head('quiet')], heads,
		'the backfill wrote the index, not the documents');
	await second.stop();
});

test('a path that changed is computed again, and a field nobody declares any more goes', async () => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);

	const first = createStore({
		driver: postgresDriver(poolOn(schema)),
		declare: { tag: ['meta', 'tag'], title: ['title'] },
	});
	const handle = await first.open('board');
	(handle.root as Doc).title = 'the board';
	(handle.root as Doc).label = 'from the other path';
	(handle.root as Doc).meta = createObject<Doc>({ tag: 'from the first path' });
	await first.settled(handle);
	await first.stop();

	// `tag` keeps its name and changes its path, which is the case a driver that only asks
	// whether a value is there cannot see: it would keep answering from the old path forever.
	const second = createStore({ driver: postgresDriver(poolOn(schema)), declare: { tag: ['label'] } });
	assert.deepEqual(
		(await second.find({ where: [{ field: 'tag', op: 'eq', value: 'from the other path' }] })).map((f) => f.doc),
		['board'],
		'the field still holds what the path it used to name held',
	);
	assert.deepEqual(
		(await second.find({ where: [{ field: 'tag', op: 'eq', value: 'from the first path' }] })).map((f) => f.doc),
		[],
		'and the value from the old path still answers, silently',
	);
	assert.deepEqual(Object.keys((await second.scan(10))[0]!.fields), ['tag'],
		'a field the declaration no longer names is still in what a hit carries');
	await second.stop();
});

test('two stores declaring the same new path at once both come up with it whole', async () => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);

	const first = createStore({ driver: postgresDriver(poolOn(schema)), declare: { title: ['title'] } });
	for (const name of ['one', 'two', 'three']) {
		const handle = await first.open(name);
		(handle.root as Doc).title = `${name} of three`;
		(handle.root as Doc).meta = createObject<Doc>({ owner: `u_${name}` });
		await first.settled(handle);
	}
	await first.stop();

	// Two processes booting together on the same schema, which is the ordinary shape of a
	// deploy. Neither may see the other halfway through filling the index in.
	const declare = { title: ['title'], owner: ['meta', 'owner'] };
	const both = [
		createStore({ driver: postgresDriver(poolOn(schema)), declare }),
		createStore({ driver: postgresDriver(poolOn(schema)), declare }),
	];
	const answers = await Promise.all(both.map((store) =>
		store.find({ where: [{ field: 'owner', op: 'eq', value: 'u_two' }] })));
	assert.deepEqual(answers.map((hits) => hits.map((f) => f.doc)), [['two'], ['two']]);
	for (const store of both) await store.stop();
});

test('a path into an array is refused when the backfill walks into one', async () => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);

	const first = createStore({ driver: postgresDriver(poolOn(schema)) });
	const board = await first.open('board');
	(board.root as Doc).tasks = createArray<Doc>([createObject<Doc>({ title: 'one' })]);
	await first.settled(board);
	await first.stop();

	// An array position is a byte string the runtime chose, so a literal step into one names a
	// place rather than a thing. The backfill is where a driver finds that out, and it has to
	// come back out of the transaction rather than half filling the index.
	const second = createStore({
		driver: postgresDriver(poolOn(schema)),
		declare: { first: ['tasks', '0'] },
	});
	await assert.rejects(
		() => second.scan(10),
		(e: Error) => (e as { reason?: string }).reason === 'array-in-path',
	);
	await second.stop();
});

test('a slot holding bytes projects as null, and the bytes survive the round trip', async () => {
	const store = createStore({
		driver: postgresDriver(await freshPool()),
		declare: { blob: ['blob'], title: ['title'] },
	});
	const held = new Uint8Array([0, 17, 128, 255, 3]);
	const handle = await store.open('withbytes');
	(handle.root as Doc).title = 'has bytes';
	(handle.root as Doc).blob = held;
	await store.settled(handle);
	await store.close(handle);

	const again = await store.open('withbytes');
	assert.deepEqual((again.root as Doc).blob, held, 'the bytes came back changed');
	assert.deepEqual(
		(await store.find({ where: [{ field: 'blob', op: 'eq', value: null }] })).map((f) => f.doc),
		['withbytes'],
		'bytes are not an index key, so the path that names them holds null',
	);
	await store.stop();
});

test('the index pages every kind of value in the order compare puts them', async () => {
	const driver = postgresDriver(await freshPool());
	await driver.declare({ all: ['all'], k: ['k'] });

	const values: Indexable[] = [null, true, false, -3.5, 0, 12, 'a', 'B', 'zebra', 'apple'];
	const ROOT = 'AAAAAAAAAAAAAAAA';
	for (const [i, value] of values.entries()) {
		await driver.write({
			doc: `d${i}`, root: `${ROOT}${i}`, rootKind: 'object', dropped: [],
			body: new Uint8Array([i]),
			rows: [{ id: `${ROOT}${i}`, kind: 'object', set: {}, unset: [] }],
			project: { all: 'yes', k: value },
		});
	}
	// A document with no value at all for the sort field sorts as null, like the rest of them.
	await driver.write({
		doc: 'dx', root: `${ROOT}x`, rootKind: 'object', dropped: [], body: new Uint8Array([99]),
		rows: [{ id: `${ROOT}x`, kind: 'object', set: {}, unset: [] }],
		project: { all: 'yes' },
	});

	// The expected order comes from `compare`, which is what a driver has to agree with, and
	// the name breaks a tie in ascending order under both directions.
	const named: { doc: string; k: Indexable }[] = values.map((k, i) => ({ doc: `d${i}`, k }));
	named.push({ doc: 'dx', k: null });
	const ordered = (sign: number): string[] => [...named]
		.sort((a, b) => compare(a.k, b.k) * sign || (a.doc < b.doc ? -1 : 1))
		.map((h) => h.doc);

	for (const direction of ['asc', 'desc'] as const) {
		const seen: string[] = [];
		let after: string | undefined;
		for (let page = 0; page < 20; page++) {
			const got = await driver.find({
				where: { field: 'all', op: 'eq', value: 'yes' },
				sort: { field: 'k', direction }, limit: 2,
				...(after === undefined ? {} : { after }),
			});
			if (got.length === 0) break;
			seen.push(...got.map((f) => f.doc));
			after = got.at(-1)!.cursor;
		}
		assert.deepEqual(seen, ordered(direction === 'desc' ? -1 : 1),
			`paging ${direction} through the index did not produce the order compare asks for`);
	}

	// Every range operator, against every kind, is a comparison inside one kind: `holds` refuses
	// one across kinds and one against null, so neither may answer here either.
	const found = async (op: 'gt' | 'gte' | 'lt' | 'lte', value: Indexable): Promise<string[]> =>
		(await driver.find({ where: { field: 'k', op, value } })).map((f) => f.doc).sort();
	assert.deepEqual(await found('gt', 0), ['d5'], 'gt');
	assert.deepEqual(await found('gte', 0), ['d4', 'd5'], 'gte');
	assert.deepEqual(await found('lt', 0), ['d3'], 'lt');
	assert.deepEqual(await found('lte', 0), ['d3', 'd4'], 'lte');
	assert.deepEqual(await found('gte', 'a'), ['d6', 'd8', 'd9'], 'strings order by code point, so B is below a');
	assert.deepEqual(await found('gt', true), [], 'a boolean has nothing above it');
	assert.deepEqual(await found('gt', null), [], 'a comparison against null matches nothing, not everything');
	await driver.close();
});

test('a write that fails leaves the rows, the tail and the head as they were', async () => {
	const driver = postgresDriver(await freshPool());
	await driver.declare({ title: ['title'] });
	const ROOT = 'AAAAAAAAAAAAAAAA';
	await driver.write({
		doc: 'a', root: ROOT, rootKind: 'object', dropped: [], body: new Uint8Array([1]),
		rows: [{ id: ROOT, kind: 'object', set: { title: 'first' }, unset: [] }],
		project: { title: 'first' },
	});

	// A projected value too long for the index fails at the projection upsert, which is after
	// the rows and the tail entry of this write are already in the transaction. Incompressible,
	// because the index compresses an entry before it measures it. Everything has to go back.
	const tooLong = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 2654435761) % 256)).toString('base64');
	await assert.rejects(() => driver.write({
		doc: 'a', root: ROOT, rootKind: 'object', dropped: [], body: new Uint8Array([2]),
		rows: [{ id: ROOT, kind: 'object', set: { title: 'second' }, unset: [] }],
		project: { title: tooLong },
	}), /index row size/);

	assert.equal(await driver.head('a'), 1, 'the head moved for a write that did not land');
	assert.deepEqual((await driver.since('a', 0)).map((e) => e.seq), [1], 'the tail kept the failed entry');
	const rows = (await driver.read('a'))!.rows;
	assert.deepEqual(rows.find((r) => r.id === ROOT)?.slots, { title: 'first' },
		'the rows kept a change the transaction rolled back');
	assert.deepEqual(
		(await driver.find({ where: { field: 'title', op: 'eq', value: 'first' } })).map((f) => f.doc), ['a']);
	await driver.close();
});

test('the sequence carries on after the whole tail is truncated away', async () => {
	const driver = postgresDriver(await freshPool());
	const ROOT = 'AAAAAAAAAAAAAAAA';
	const write = (n: number) => driver.write({
		doc: 'a', root: ROOT, rootKind: 'object', dropped: [], body: new Uint8Array([n]),
		rows: [{ id: ROOT, kind: 'object', set: { n }, unset: [] }],
	});
	await write(1);
	await write(2);
	await driver.truncate('a', 2);
	assert.deepEqual(await driver.since('a', 0), [], 'the tail is empty');
	// The head is where the sequence comes from, not the tail: a sequence taken from what the
	// tail still holds would hand out 1 again and collide with a commit nobody kept.
	assert.equal(await write(3), 3);
	assert.equal(await driver.head('a'), 3);
	await driver.close();
});

test('the tail comes back as bytes of its own, not as the buffer the database handed over', async () => {
	const driver = postgresDriver(await freshPool());
	const ROOT = 'AAAAAAAAAAAAAAAA';
	const body = new Uint8Array([9, 8, 7]);
	await driver.write({
		doc: 'a', root: ROOT, rootKind: 'object', dropped: [], body,
		rows: [{ id: ROOT, kind: 'object', set: {}, unset: [] }],
	});
	const [entry] = await driver.since('a', 0);
	// A Buffer is a Uint8Array that prints and compares as something else, and the contract
	// says bytes: two drivers answering the same question must answer it with the same thing.
	assert.deepEqual(entry!.body, body);
	await driver.close();
});

test('a field already declared is filled in for a document that has no row for it', async () => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);
	const ROOT = 'AAAAAAAAAAAAAAAA';

	const first = postgresDriver(poolOn(schema));
	await first.declare({ title: ['title'] });

	// A driver that never declared anything writes a document with no projection at all, which
	// is what a document written before the field existed looks like from here. The path has not
	// changed, so nothing about the declaration says this document is behind: only the missing
	// row does.
	const bare = postgresDriver(poolOn(schema));
	await bare.write({
		doc: 'unindexed', root: ROOT, rootKind: 'object', dropped: [], body: new Uint8Array([1]),
		rows: [{ id: ROOT, kind: 'object', set: { title: 'written by a driver that declared nothing' }, unset: [] }],
	});
	assert.deepEqual((await first.find({
		where: { field: 'title', op: 'eq', value: 'written by a driver that declared nothing' },
	})).map((f) => f.doc), [], 'nothing indexed it yet');

	const third = postgresDriver(poolOn(schema));
	await third.declare({ title: ['title'] });
	assert.deepEqual((await third.find({
		where: { field: 'title', op: 'eq', value: 'written by a driver that declared nothing' },
	})).map((f) => f.doc), ['unindexed'],
	'a document with no row for a field the declaration already named stayed invisible');

	for (const driver of [first, bare, third]) await driver.close();
});

test('a create the database refuses leaves nothing behind', async () => {
	const driver = postgresDriver(await freshPool());
	await driver.declare({ title: ['title'] });

	// Too long for the primary key's index entry, and incompressible, because the index
	// compresses before it measures. The failure lands inside create's own transaction.
	const huge = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 2654435761) % 256)).toString('base64');
	await assert.rejects(() => driver.create(huge, 'AAAAAAAAAAAAAAAA', 'object'), /index row size/);
	assert.deepEqual(await driver.scan(10), [], 'a refused create left a document behind');
	await driver.close();
});

test('a zero byte is refused by name, wherever it arrives', async () => {
	const driver = postgresDriver(await freshPool());
	await driver.declare({ title: ['title'] });
	const ROOT = 'AAAAAAAAAAAAAAAA';
	const zero = 'a value with a \u0000 in it';
	const base = {
		root: ROOT, rootKind: 'object' as const, dropped: [], body: new Uint8Array([1]),
		rows: [{ id: ROOT, kind: 'object' as const, set: {}, unset: [] }],
	};
	const refused = (e: Error): boolean => (e as { reason?: string }).reason === 'zero-byte';

	// Postgres stores no text holding one, in jsonb or in a text column. Left to the database it
	// arrives as a bare driver error from inside a transaction that has already written half a
	// commit, so it is refused here, before the transaction opens.
	await assert.rejects(() => driver.write({ ...base, doc: zero }), refused, 'a document name');
	await assert.rejects(() => driver.write({
		...base, doc: 'a', rows: [{ id: ROOT, kind: 'object', set: { [zero]: 1 }, unset: [] }],
	}), refused, 'a slot name');
	await assert.rejects(() => driver.write({
		...base, doc: 'a', rows: [{ id: ROOT, kind: 'object', set: { title: zero }, unset: [] }],
	}), refused, 'a string in a slot');
	await assert.rejects(() => driver.write({ ...base, doc: 'a', project: { title: zero } }),
		refused, 'a projected string');
	await assert.rejects(() => driver.create(zero, ROOT, 'object'), refused, 'a name being created');

	assert.equal(await driver.head('a'), 0, 'a refused write left something behind');
	await driver.close();
});

test('three drivers making the tables at the same instant all come up', async () => {
	const schema = `check_${schemas++}`;
	await admin.query(`CREATE SCHEMA ${schema}`);

	// `CREATE TABLE IF NOT EXISTS` is not a no-op while another process is inside its own: the
	// two collide in the catalogue on pg_type. Three processes booting together on one schema is
	// the ordinary shape of a deploy, and without the install's advisory lock this is a duplicate
	// key error out of `declare`.
	const drivers = [postgresDriver(poolOn(schema)), postgresDriver(poolOn(schema)), postgresDriver(poolOn(schema))];
	await Promise.all(drivers.map((driver) => driver.declare({ title: ['title'] })));

	const ROOT = 'AAAAAAAAAAAAAAAA';
	for (const [i, driver] of drivers.entries()) {
		assert.equal(await driver.write({
			doc: `d${i}`, root: ROOT, rootKind: 'object', dropped: [], body: new Uint8Array([i]),
			rows: [{ id: ROOT, kind: 'object', set: { title: `d${i}` }, unset: [] }],
			project: { title: `d${i}` },
		}), 1, `driver ${i} came up with tables it could not write to`);
	}
	assert.deepEqual((await drivers[0]!.scan(10)).map((f) => f.doc), ['d0', 'd1', 'd2']);
	for (const driver of drivers) await driver.close();
});

test('a closed driver refuses everything, and leaves the pool to its owner', async () => {
	const pool = await freshPool();
	const driver = postgresDriver(pool);
	await driver.declare({});
	await driver.close();
	await driver.close();

	const calls: [string, () => Promise<unknown>][] = [
		['declare', () => driver.declare({})],
		['find', () => driver.find({ where: { field: 'title', op: 'eq', value: 'x' } })],
		['scan', () => driver.scan(1)],
		['write', () => driver.write({
			doc: 'a', root: 'r', rootKind: 'object', rows: [], dropped: [], body: new Uint8Array(),
		})],
		['create', () => driver.create('a', 'r', 'object')],
		['read', () => driver.read('a')],
		['since', () => driver.since('a', 0)],
		['head', () => driver.head('a')],
		['truncate', () => driver.truncate('a', 1)],
		['forget', () => driver.forget('a', ['x'])],
		['remove', () => driver.remove('a')],
	];
	for (const [name, call] of calls) {
		await assert.rejects(call, (e: Error) => (e as { reason?: string }).reason === 'driver-closed',
			`${name} answered after the driver was closed`);
	}

	const still = await pool.query('SELECT 1 AS alive');
	assert.equal((still.rows[0] as { alive: number }).alive, 1,
		'closing the driver ended a pool it did not make');
});

test('a write naming a root the document does not have is refused and changes nothing', async () => {
	const driver = postgresDriver(await freshPool());
	await driver.declare({});
	assert.equal(await driver.create('a', 'AAAAAAAAAAAAAAAA', 'object'), true);
	await assert.rejects(
		() => driver.write({
			doc: 'a', root: 'BBBBBBBBBBBBBBBB', rootKind: 'object', dropped: [],
			body: new Uint8Array([1]), rows: [{ id: 'BBBBBBBBBBBBBBBB', kind: 'object', set: {}, unset: [] }],
		}),
		(e: Error) => (e as { reason?: string }).reason === 'root-conflict',
	);
	assert.equal(await driver.head('a'), 0, 'the refused write left a sequence behind');
	assert.deepEqual((await driver.read('a'))!.rows, [], 'and left a row behind');
	await driver.close();
});

test('any slot a document can hold survives the round trip, over seeded random documents', async () => {
	const store = createStore({ driver: postgresDriver(await freshPool()) });
	const seed = 20260907;
	const next = randomFrom(seed);

	// Every kind of value a slot may hold. The unicode is here because jsonb is text and an
	// encoder that mangles it is a corruption nothing else in the suite would see.
	const primitive = (): unknown => {
		const roll = randomBelow(next, 6);
		if (roll === 0) {
			return ['plain', 'héllo wörld', 'ヒラガナ', '😀 astral', 'quote " and \\ and \n'][randomBelow(next, 5)];
		}
		if (roll === 1) return randomBelow(next, 2000) - 1000;
		if (roll === 2) return (randomBelow(next, 2000) - 1000) / 7;
		if (roll === 3) return randomBelow(next, 2) === 1;
		if (roll === 4) return null;
		return new Uint8Array(Array.from({ length: randomBelow(next, 20) }, () => randomBelow(next, 256)));
	};

	const held: Record<string, unknown> = {};
	const referenced: Record<string, number> = {};
	const handle = await store.open('random');
	const root = handle.root as Doc;
	for (let i = 0; i < 60; i++) {
		const slot = `slot${randomBelow(next, 20)}`;
		delete held[slot];
		delete referenced[slot];
		if (randomBelow(next, 5) === 0) {
			const n = randomBelow(next, 1000);
			referenced[slot] = n;
			root[slot] = createObject<Doc>({ n });
		} else {
			const value = primitive();
			held[slot] = value;
			root[slot] = value;
		}
	}
	await store.settled(handle);
	await store.close(handle);

	const again = (await store.open('random')).root as Doc;
	for (const [slot, value] of Object.entries(held)) {
		assert.deepEqual(again[slot], value, `slot ${slot} came back changed, from seed ${String(seed)}`);
	}
	for (const [slot, n] of Object.entries(referenced)) {
		assert.equal((again[slot] as Doc | undefined)?.n, n,
			`the observable in slot ${slot} came back changed, from seed ${String(seed)}`);
	}
	assert.ok(Object.keys(referenced).length > 0, 'the run drew no references at all');
	await store.stop();
});
