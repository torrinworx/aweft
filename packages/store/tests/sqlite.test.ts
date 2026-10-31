// The SQLite driver, against `node:sqlite`.
//
// The suite in `@aweftjs/testing` is the contract, run against a fresh in-memory database per
// check. What is here is what the suite cannot see: a file reopened by another handle, writers on
// other threads taking turns at the file's write lock, the version guard, the order the index
// pages in, and what a rolled back write leaves behind.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import { compare, createStore, memoryDriver, type Indexable } from '../src/index.ts';
import { sqliteDriver } from '../src/sqlite.ts';
import { createArray, createObject, type SnapshotValue } from '@aweftjs/core';
import { driverChecks, randomBelow, randomFrom } from '@aweftjs/testing';

import { DECLARE, oracle } from './oracle.ts';

type Doc = Record<string, unknown>;
const ROOT = 'AAAAAAAAAAAAAAAA';

const directory = mkdtempSync(join(tmpdir(), 'aweft-sqlite-'));
let files = 0;
const freshFile = (): string => join(directory, `check-${String(files++)}.db`);

const handles: DatabaseSync[] = [];
const handle = (path = ':memory:', options: ConstructorParameters<typeof DatabaseSync>[1] = {}): DatabaseSync => {
	const db = new DatabaseSync(path, options);
	handles.push(db);
	return db;
};

after(() => {
	for (const db of handles) if (db.isOpen) db.close();
	rmSync(directory, { recursive: true, force: true });
});

const bare = (doc: string, n: number, set: Record<string, SnapshotValue> = {}, project?: Record<string, Indexable>) => ({
	doc, root: ROOT, rootKind: 'object' as const, dropped: [], body: new Uint8Array([n]),
	rows: [{ id: ROOT, kind: 'object' as const, set, unset: [] as string[] }],
	...(project === undefined ? {} : { project }),
});

const checks = driverChecks();
assert.equal(checks.length, 33, 'the suite this file claims to run changed size');
for (const check of checks) {
	test(`[sqlite] ${check.name}`, () => check.run(() => sqliteDriver(handle())));
}

test('a file written through one handle reads back whole through another', async () => {
	const path = freshFile();
	const first = handle(path);
	const store = createStore({ driver: sqliteDriver(first), declare: { title: ['title'] } });
	const board = await store.open('board');
	const root = board.root as Doc;
	root.title = 'the board';
	root.tasks = createArray<Doc>([createObject<Doc>({ title: 'one' }), createObject<Doc>({ title: 'two' })]);
	root.blob = new Uint8Array([0, 255, 7]);
	await store.settled(board);
	const head = await store.head('board');
	await store.stop();
	first.close();

	const again = createStore({ driver: sqliteDriver(handle(path)), declare: { title: ['title'] } });
	const reopened = (await again.open('board')).root as Doc;
	assert.equal(reopened.title, 'the board');
	assert.deepEqual((reopened.tasks as Doc[]).map((t) => t.title), ['one', 'two']);
	assert.deepEqual(reopened.blob, new Uint8Array([0, 255, 7]));
	assert.equal(await again.head('board'), head, 'the head did not survive the reopen');
	assert.equal((await again.since('board', 0)).length, head, 'the tail did not survive the reopen');
	assert.deepEqual(
		(await again.find({ where: [{ field: 'title', op: 'eq', value: 'the board' }] })).map((f) => f.doc), ['board']);
	await again.stop();
});

test('two stores on two handles keep their open copies, and both writes are in the file', async () => {
	const path = freshFile();
	const one = createStore({ driver: sqliteDriver(handle(path)) });
	const two = createStore({ driver: sqliteDriver(handle(path)) });
	const mine = await one.open('board');
	const theirs = await two.open('board');
	(mine.root as Doc).a = 'from one';
	await one.settled(mine);
	(theirs.root as Doc).b = 'from two';
	await two.settled(theirs);

	assert.equal((mine.root as Doc).b, undefined, 'one\'s open copy took a write it was never told of');
	assert.equal((theirs.root as Doc).a, undefined, 'two\'s open copy took a write it was never told of');
	await one.close(mine);
	const reopened = (await one.open('board')).root as Doc;
	assert.deepEqual([reopened.a, reopened.b], ['from one', 'from two']);
	await one.stop();
	await two.stop();
});

test('writers on four threads, each with its own handle on one file, all land in sequence', async () => {
	const path = freshFile();
	const setup = handle(path);
	setup.exec('PRAGMA journal_mode = WAL');
	await sqliteDriver(setup).declare({});

	// Every thread reads the head and then writes, against the same document. A transaction that
	// took the write lock only at its first write would let two of them read the same head, and
	// SQLite refuses the second upgrade outright rather than waiting.
	const writers = 4;
	const writes = 40;
	const gate = new SharedArrayBuffer(8);
	const barrier = new Int32Array(gate);
	const results = Promise.all(Array.from({ length: writers }, (_, writer) => new Promise<{ seqs: number[]; error?: string }>((resolve, reject) => {
		const worker = new Worker(new URL('./sqlite-writer.ts', import.meta.url), {
			workerData: { path, writer, writes, gate, root: ROOT },
		});
		worker.once('message', resolve);
		worker.once('error', reject);
	})));
	while (Atomics.load(barrier, 0) < writers) await new Promise((r) => setTimeout(r, 5));
	Atomics.store(barrier, 1, 1);
	Atomics.notify(barrier, 1);

	const answers = await results;
	for (const [writer, answer] of answers.entries()) {
		assert.equal(answer.error, undefined, `writer ${String(writer)} was refused: ${String(answer.error)}`);
	}
	const seqs = answers.flatMap((a) => a.seqs).sort((a, b) => a - b);
	assert.deepEqual(seqs, Array.from({ length: writers * writes }, (_, i) => i + 1),
		'the sequences are not contiguous, or two writes were given one');

	const driver = sqliteDriver(setup);
	assert.equal(await driver.head('shared'), writers * writes);
	const slots = (await driver.read('shared'))!.rows.find((r) => r.id === ROOT)!.slots;
	for (let writer = 0; writer < writers; writer++) {
		assert.equal(slots[`w${String(writer)}`], writes - 1, `writer ${String(writer)}'s last write was lost`);
	}
});

test('a write that fails leaves the rows, the tail and the head as they were', async () => {
	const db = handle();
	const driver = sqliteDriver(db);
	await driver.declare({ title: ['title'] });
	await driver.write(bare('a', 1, { title: 'first' }, { title: 'first' }));

	// The next write's tail entry is already taken, so the insert fails after this write's rows
	// are merged inside the transaction. All of it has to go back.
	db.prepare('INSERT INTO aweft_tail (doc, seq, body) VALUES (?, ?, ?)').run('a', 2, new Uint8Array([0]));
	await assert.rejects(() => driver.write(bare('a', 2, { title: 'second' }, { title: 'second' })), /UNIQUE/);

	assert.equal(await driver.head('a'), 1, 'the head moved for a write that did not land');
	assert.deepEqual((await driver.read('a'))!.rows.find((r) => r.id === ROOT)?.slots, { title: 'first' },
		'the rows kept a change the transaction rolled back');
	assert.deepEqual(
		(await driver.find({ where: { field: 'title', op: 'eq', value: 'first' } })).map((f) => f.doc), ['a'],
		'the projection kept a change the transaction rolled back');
	assert.equal(db.isTransaction, false, 'the failed write left a transaction open on the handle');
	await driver.close();
});

test('a driver that finds tables it does not know refuses before it reads anything', async () => {
	const db = handle();
	db.exec('CREATE TABLE aweft_version (one integer PRIMARY KEY, version integer NOT NULL)');
	db.exec('INSERT INTO aweft_version (one, version) VALUES (1, 9)');
	await assert.rejects(
		() => sqliteDriver(db).declare({}),
		(e: Error) => {
			assert.equal((e as { reason?: string }).reason, 'unknown-version');
			assert.match(e.message, /version 9 and this driver writes version 1/);
			return true;
		},
	);
	assert.equal(db.isTransaction, false);
});

test('a path declared after the documents were written is filled in, a changed one recomputed, a dropped one gone', async () => {
	const db = handle();
	const first = createStore({ driver: sqliteDriver(db), declare: { title: ['title'] } });
	const urgent = await first.open('urgent');
	(urgent.root as Doc).title = 'the urgent one';
	(urgent.root as Doc).label = 'from the other path';
	(urgent.root as Doc).meta = createObject<Doc>({ tag: 'now' });
	const quiet = await first.open('quiet');
	(quiet.root as Doc).title = 'the quiet one';
	await first.settled(urgent);
	await first.settled(quiet);
	await first.stop();

	const second = createStore({ driver: sqliteDriver(db), declare: { title: ['title'], tag: ['meta', 'tag'] } });
	assert.deepEqual(
		(await second.find({ where: [{ field: 'tag', op: 'eq', value: 'now' }] })).map((f) => f.doc), ['urgent'],
		'a document written before the path was declared is invisible until the driver fills it in');
	assert.deepEqual(
		(await second.find({ where: [{ field: 'tag', op: 'eq', value: null }] })).map((f) => f.doc), ['quiet']);
	await second.stop();

	// Same name, another path: answering from the old one would be silent and wrong.
	const third = createStore({ driver: sqliteDriver(db), declare: { tag: ['label'] } });
	assert.deepEqual(
		(await third.find({ where: [{ field: 'tag', op: 'eq', value: 'from the other path' }] })).map((f) => f.doc),
		['urgent']);
	assert.deepEqual((await third.scan(10)).map((f) => f.fields), [{ tag: null }, { tag: 'from the other path' }],
		'a field nobody declares any more is still in the projection');
	await third.stop();
});

test('a field already declared is filled in for a document that has no row for it', async () => {
	const db = handle();
	await sqliteDriver(db).declare({ title: ['title'] });
	// A driver that declared nothing writes a document with no projection: what a document
	// written before the field existed looks like, while the path itself has not changed.
	await sqliteDriver(db).write(bare('unindexed', 1, { title: 'nobody indexed this' }));
	const third = sqliteDriver(db);
	await third.declare({ title: ['title'] });
	assert.deepEqual(
		(await third.find({ where: { field: 'title', op: 'eq', value: 'nobody indexed this' } })).map((f) => f.doc),
		['unindexed']);
});

test('a declaration that did not change walks no document, and a write projects only what is declared', async () => {
	const db = handle();
	const first = sqliteDriver(db);
	await first.declare({ title: ['title'] });
	// The projection is handed in with the write rather than read off the rows, so here it says
	// something the rows do not. A driver that walked every document again on an unchanged
	// declaration would overwrite it from the rows; one that kept what was handed in did not walk.
	await first.write(bare('a', 1, { title: 'in the rows' }, { title: 'handed in', other: 'not declared' }));
	assert.deepEqual((await first.scan(10)).map((f) => f.fields), [{ title: 'handed in' }],
		'a write projected a field nobody declared');

	const second = sqliteDriver(db);
	await second.declare({ title: ['title'] });
	assert.deepEqual(
		(await second.find({ where: { field: 'title', op: 'eq', value: 'handed in' } })).map((f) => f.doc), ['a'],
		'declaring the same paths again recomputed every document');
});

test('a path into an array is refused when the backfill walks into one, and the index is left alone', async () => {
	const db = handle();
	const first = createStore({ driver: sqliteDriver(db) });
	const board = await first.open('board');
	(board.root as Doc).tasks = createArray<Doc>([createObject<Doc>({ title: 'one' })]);
	await first.settled(board);
	await first.stop();

	const second = createStore({ driver: sqliteDriver(db), declare: { first: ['tasks', '0'] } });
	await assert.rejects(() => second.scan(10), (e: Error) => (e as { reason?: string }).reason === 'array-in-path');
	assert.equal(db.isTransaction, false);
	assert.deepEqual(db.prepare('SELECT field FROM aweft_declared').all(), [], 'a refused backfill recorded its path');
});

test('the index pages every kind of value in the order compare puts them', async () => {
	const driver = sqliteDriver(handle());
	await driver.declare({ all: ['all'], k: ['k'] });

	const values: Indexable[] = [null, true, false, -3.5, 0, 12, 'a', 'B', 'zebra', 'apple'];
	for (const [i, value] of values.entries()) await driver.write({ ...bare(`d${String(i)}`, i), project: { all: 'yes', k: value } });
	await driver.write({ ...bare('dx', 99), project: { all: 'yes' } });

	const named: { doc: string; k: Indexable }[] = values.map((k, i) => ({ doc: `d${String(i)}`, k }));
	named.push({ doc: 'dx', k: null });
	const ordered = (sign: number): string[] => [...named]
		.sort((a, b) => compare(a.k, b.k) * sign || (a.doc < b.doc ? -1 : 1))
		.map((h) => h.doc);

	for (const direction of ['asc', 'desc'] as const) {
		const seen: string[] = [];
		let at: string | undefined;
		for (let page = 0; page < 20; page++) {
			const got = await driver.find({
				where: { field: 'all', op: 'eq', value: 'yes' },
				sort: { field: 'k', direction }, limit: 2,
				...(at === undefined ? {} : { after: at }),
			});
			if (got.length === 0) break;
			seen.push(...got.map((f) => f.doc));
			at = got.at(-1)!.cursor;
		}
		assert.deepEqual(seen, ordered(direction === 'desc' ? -1 : 1), `paging ${direction}`);
	}

	const found = async (op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte', value: Indexable): Promise<string[]> =>
		(await driver.find({ where: { field: 'k', op, value } })).map((f) => f.doc).sort();
	assert.deepEqual(await found('gt', 0), ['d5']);
	assert.deepEqual(await found('gte', 0), ['d4', 'd5']);
	assert.deepEqual(await found('lt', 0), ['d3']);
	assert.deepEqual(await found('lte', 0), ['d3', 'd4']);
	assert.deepEqual(await found('gte', 'a'), ['d6', 'd8', 'd9'], 'strings order by code point, so B is below a');
	assert.deepEqual(await found('eq', true), ['d1'], 'a boolean is found as a boolean, not as 1');
	assert.deepEqual(await found('eq', 1), [], 'and 1 is not true');
	assert.deepEqual(await found('gt', true), []);
	assert.deepEqual(await found('gt', null), [], 'a comparison against null matches nothing, not everything');
	assert.deepEqual((await driver.find({ where: { field: 'k', op: 'eq', value: false } }))[0]!.fields,
		{ all: 'yes', k: false }, 'a boolean comes back as a boolean');
	await driver.close();
});

test('a zero byte is refused by name, wherever it arrives', async () => {
	const driver = sqliteDriver(handle());
	await driver.declare({ title: ['title'] });
	const zero = 'a value with a \u0000 in it';
	const refused = (e: Error): boolean => (e as { reason?: string }).reason === 'zero-byte';

	await assert.rejects(() => driver.write(bare(zero, 1)), refused, 'a document name');
	await assert.rejects(() => driver.write(bare('a', 1, { [zero]: 1 })), refused, 'a slot name');
	await assert.rejects(() => driver.write(bare('a', 1, { title: zero })), refused, 'a string in a slot');
	await assert.rejects(() => driver.write({
		...bare('a', 1), rows: [{ id: ROOT, kind: 'object', set: {}, unset: [zero] }],
	}), refused, 'an unset slot name');
	await assert.rejects(() => driver.write(bare('a', 1, {}, { title: zero })), refused, 'a projected string');
	await assert.rejects(() => driver.create(zero, ROOT, 'object'), refused, 'a name being created');
	assert.equal(await driver.head('a'), 0, 'a refused write left something behind');
	await driver.close();
});

test('a declared field name holding a zero byte is refused, and the declaration is left as it was', async () => {
	const db = handle();
	const driver = sqliteDriver(db);
	await driver.declare({ title: ['title'] });
	await assert.rejects(() => driver.declare({ title: ['title'], 'z\u0000z': ['title'] }),
		(e: Error) => (e as { reason?: string }).reason === 'zero-byte');
	assert.equal(db.isTransaction, false);
	assert.deepEqual(db.prepare('SELECT field FROM aweft_declared').all().map((r) => (r as { field: string }).field), ['title'],
		'a field read back shorter than it was declared would answer for another name');
	await driver.close();
});

test('a write waiting on another handle\'s write lock blocks for the busy timeout, then is refused and changes nothing', async () => {
	const path = freshFile();
	const holder = handle(path);
	holder.exec('PRAGMA journal_mode = WAL');
	const db = handle(path);
	db.exec('PRAGMA busy_timeout = 300');
	const driver = sqliteDriver(db);
	assert.equal(await driver.write(bare('a', 1)), 1);

	holder.exec('BEGIN IMMEDIATE');
	// Timed around the call itself, before its promise is awaited: node:sqlite waits on the thread,
	// so the whole wait happens inside the call.
	const started = performance.now();
	const pending = driver.write(bare('a', 2));
	const blocked = performance.now() - started;
	await assert.rejects(pending, (e: Error) => {
		assert.equal((e as { errcode?: number }).errcode, 5, 'not SQLITE_BUSY');
		return true;
	});
	assert.ok(blocked >= 250, `refused after ${blocked.toFixed(0)} ms, not after the busy timeout`);
	assert.equal(db.isTransaction, false, 'the refused write left a transaction open');
	assert.equal(await driver.head('a'), 1);
	holder.exec('COMMIT');

	assert.equal(await driver.write(bare('a', 2)), 2, 'the write did not land once the lock was free');
	await driver.close();
});

test('the index pages ties, nulls, accents, kana and -0 in the order the memory driver does', async () => {
	const values: (Indexable | undefined)[] = [
		5, 5, -0, 0, 1e300, -1e300, 'é', 'e', 'ヒ', 'ひ', '', 'z', 'Z', 'ÿ', 'é', null, null, true, true, false, undefined, undefined,
	];
	const paged = async (driver: ReturnType<typeof memoryDriver>): Promise<Record<string, string[]>> => {
		await driver.declare({ all: ['all'], k: ['k'] });
		for (const [i, k] of values.entries()) {
			await driver.write({ ...bare(`d${String(i).padStart(2, '0')}`, i), project: k === undefined ? { all: 1 } : { all: 1, k } });
		}
		const out: Record<string, string[]> = {};
		for (const direction of ['asc', 'desc'] as const) {
			const seen: string[] = [];
			let at: string | undefined;
			for (let page = 0; page < values.length; page++) {
				const got = await driver.find({
					where: { field: 'all', op: 'eq', value: 1 }, sort: { field: 'k', direction }, limit: 2,
					...(at === undefined ? {} : { after: at }),
				});
				if (got.length === 0) break;
				seen.push(...got.map((f) => f.doc));
				at = got.at(-1)!.cursor;
			}
			out[direction] = seen;
		}
		await driver.close();
		return out;
	};
	const expected = await paged(memoryDriver());
	assert.equal(expected['asc']!.length, values.length);
	assert.deepEqual(await paged(sqliteDriver(handle())), expected);
});

test('a closed driver refuses everything, and leaves the handle to its owner', async () => {
	const db = handle();
	const driver = sqliteDriver(db);
	await driver.declare({});
	await driver.close();
	await driver.close();

	const calls: [string, () => Promise<unknown>][] = [
		['declare', () => driver.declare({})],
		['find', () => driver.find({ where: { field: 'title', op: 'eq', value: 'x' } })],
		['scan', () => driver.scan(1)],
		['write', () => driver.write(bare('a', 1))],
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
	assert.equal(db.isOpen, true, 'closing the driver closed a handle it did not open');
});

test('a transaction the application left open on the shared handle makes the next write fail, not join it', async () => {
	const db = handle();
	const driver = sqliteDriver(db);
	await driver.write(bare('a', 1));
	db.exec('BEGIN');
	await assert.rejects(() => driver.write(bare('a', 2)), /within a transaction/);
	db.exec('ROLLBACK');
	assert.equal(await driver.head('a'), 1);
	assert.equal(await driver.write(bare('a', 2)), 2, 'the driver did not recover once the handle was free');
	await driver.close();
});

test('a write naming a root the document does not have is refused and changes nothing', async () => {
	const driver = sqliteDriver(handle());
	await driver.declare({});
	assert.equal(await driver.create('a', ROOT, 'object'), true);
	await assert.rejects(
		() => driver.write({ ...bare('a', 1), root: 'BBBBBBBBBBBBBBBB' }),
		(e: Error) => (e as { reason?: string }).reason === 'root-conflict',
	);
	assert.equal(await driver.head('a'), 0);
	assert.deepEqual((await driver.read('a'))!.rows, []);
	await driver.close();
});

test('a handle that reads integers as bigints is used as it is', async () => {
	const db = handle(':memory:', { readBigInts: true });
	const pragmas = (): unknown[] => ['foreign_keys', 'journal_mode', 'synchronous', 'busy_timeout']
		.map((name) => db.prepare(`PRAGMA ${name}`).get());
	const before = pragmas();
	const driver = sqliteDriver(db);
	await driver.declare({ done: ['done'] });
	assert.equal(await driver.write(bare('a', 1, { done: true }, { done: true })), 1);
	assert.equal(await driver.write(bare('a', 2, { done: false }, { done: false })), 2);
	assert.equal(await driver.head('a'), 2);
	assert.deepEqual((await driver.since('a', 0)).map((e) => e.seq), [1, 2]);
	assert.deepEqual((await driver.find({ where: { field: 'done', op: 'eq', value: false } }))[0]!.fields, { done: false });
	assert.deepEqual(pragmas(), before, 'the driver changed a setting that belongs to whoever opened the handle');
	await driver.close();
});

test('a slot named like a property of every object is kept as a slot', async () => {
	const driver = sqliteDriver(handle());
	await driver.write(bare('a', 1, { ['__proto__']: 'kept', constructor: 'also' }));
	await driver.write(bare('a', 2, { other: 1 }));
	const slots = (await driver.read('a'))!.rows[0]!.slots;
	assert.equal(Object.hasOwn(slots, '__proto__'), true, 'the slot became a prototype on the merge');
	assert.equal(slots['__proto__' as keyof typeof slots], 'kept');
	assert.equal(slots['constructor'], 'also');
	await driver.close();
});

test('any slot a document can hold survives the round trip, over seeded random documents', async () => {
	const store = createStore({ driver: sqliteDriver(handle()) });
	const seed = 20261031;
	const next = randomFrom(seed);
	const primitive = (): unknown => {
		const roll = randomBelow(next, 6);
		if (roll === 0) return ['plain', 'héllo wörld', 'ヒラガナ', '😀 astral', 'quote " and \\ and \n'][randomBelow(next, 5)];
		if (roll === 1) return randomBelow(next, 2000) - 1000;
		if (roll === 2) return (randomBelow(next, 2000) - 1000) / 7;
		if (roll === 3) return randomBelow(next, 2) === 1;
		if (roll === 4) return null;
		return new Uint8Array(Array.from({ length: randomBelow(next, 20) }, () => randomBelow(next, 256)));
	};

	const held: Record<string, unknown> = {};
	const referenced: Record<string, number> = {};
	const opened = await store.open('random');
	const root = opened.root as Doc;
	for (let i = 0; i < 60; i++) {
		const slot = `slot${String(randomBelow(next, 20))}`;
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
	await store.settled(opened);
	await store.close(opened);

	const again = (await store.open('random')).root as Doc;
	for (const [slot, value] of Object.entries(held)) {
		assert.deepEqual(again[slot], value, `slot ${slot} came back changed, from seed ${String(seed)}`);
	}
	for (const [slot, n] of Object.entries(referenced)) {
		assert.equal((again[slot] as Doc | undefined)?.n, n, `slot ${slot}, from seed ${String(seed)}`);
	}
	assert.ok(Object.keys(referenced).length > 0, 'the run drew no references at all');
	await store.stop();
});

test('a value that reads as SQL is a value, whether it is written, queried for or read back', async () => {
	const store = createStore({ driver: sqliteDriver(handle()), declare: { title: ['title'] } });
	const hostile = `'; DROP TABLE aweft_rows; -- "x" \\ ?1`;
	const opened = await store.open('hostile');
	(opened.root as Doc).title = hostile;
	await store.settled(opened);
	await store.close(opened);
	assert.deepEqual((await store.find({ where: [{ field: 'title', op: 'eq', value: hostile }] })).map((f) => f.doc), ['hostile']);
	assert.equal(((await store.open('hostile')).root as Doc).title, hostile);
	await store.stop();
});

// The store's second reading, over this driver: two stores on one file through two handles, as a
// process and its restart would be.
for (const seed of [1, 2, 20260913]) {
	test(`[sqlite] the store answers as the model says over seeded random operations, seed ${String(seed)}`, async () => {
		const path = freshFile();
		const stores: ReturnType<typeof createStore>[] = [];
		const make = (): ReturnType<typeof createStore> => {
			const store = createStore({ driver: sqliteDriver(handle(path)), declare: DECLARE });
			stores.push(store);
			return store;
		};
		await oracle({ store: make(), again: make }, seed, 120);
		for (const store of stores) await store.stop();
	});
}
