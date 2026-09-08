// Documents in Postgres: a process that dies mid-edit, eight processes opening one name at
// once, and a path declared after the data was already there.
//
// A real server and real child processes, because all three of these are about what survives
// something the writer did not agree to. A close and reopen inside one process is the case a
// store gets right by accident.
//
// Run: node recipes/documents-on-postgres/main.ts

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

import { atomic, createArray, createObject } from '@aweftjs/core';
import { createStore } from '@aweftjs/store';
import { postgresDriver } from '@aweftjs/store/postgres';

type Doc = Record<string, unknown>;
const here = fileURLToPath(import.meta.url);
const DATABASE = 'documents';

const check = (ok: boolean, what: string): void => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) process.exitCode = 1;
};

// The pool is the application's, here and in every child: the driver borrows connections from
// it and never ends it, so ending it is this program's job.
const poolOn = (port: number): pg.Pool => new pg.Pool({
	host: 'localhost', port, user: 'postgres', password: 'password', database: DATABASE, max: 4,
});

// --- the child that writes a document and then dies without being told to stop ----------------
if (process.argv[2] === 'write') {
	const pool = poolOn(Number(process.argv[3]));
	const store = createStore({ driver: postgresDriver(pool), declare: { title: ['title'] } });
	const board = await store.open('board');
	const root = board.root as Doc;
	const tasks = createArray<Doc>();
	atomic(() => {
		root.title = 'the board';
		root.tasks = tasks;
		root.meta = createObject<Doc>({ authorId: 'u_7' });
	});
	for (let i = 0; i < 5; i++) tasks.push(createObject<Doc>({ title: `task ${i}`, done: i % 2 === 0 }));
	(tasks[2] as Doc).title = 'task two, renamed';
	await store.settled(board);

	// Nothing is closed, no connection is returned, and the next line is fatal.
	process.kill(process.pid, 'SIGKILL');
}

// --- one of eight children opening the same name at the same moment ---------------------------
if (process.argv[2] === 'contend') {
	const pool = poolOn(Number(process.argv[3]));
	const mine = Number(process.argv[4]);
	const store = createStore({ driver: postgresDriver(pool) });
	const handle = await store.open('contended');
	(handle.root as Doc)[`w${mine}`] = mine;
	await store.settled(handle);
	await store.stop();
	await pool.end();
	process.exit(0);
}

// --- the parent -------------------------------------------------------------------------------
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

const pool = poolOn(port);
try {
	console.log('write into postgres, kill the process, reopen');
	const child = spawnSync(process.execPath, [here, 'write', String(port)], { encoding: 'utf8' });
	check(child.signal === 'SIGKILL', `the writer was killed, not shut down (signal ${String(child.signal)})`);

	const store = createStore({ driver: postgresDriver(pool), declare: { title: ['title'] } });
	const board = await store.open('board');
	const root = board.root as Doc;
	const tasks = root.tasks as Doc[];

	check(root.title === 'the board', 'the document came back');
	check(tasks?.length === 5, `every task came back (${tasks?.length ?? 0} of 5)`);
	check(tasks?.[2]?.title === 'task two, renamed', 'the last write before the kill survived it');
	check((root.meta as Doc)?.authorId === 'u_7', 'and so did the nested observable');

	const history = await store.since('board', 0);
	check(history.length === board.seq, `the history is complete (${history.length} commits)`);
	check(history.every((h, i) => h.seq === i + 1), 'and its sequences have no holes');

	console.log('\neight processes open one name at the same moment');
	const racers = Array.from({ length: 8 }, (_, i) => new Promise<number>((resolve) => {
		spawn(process.execPath, [here, 'contend', String(port), String(i)], { stdio: 'inherit' })
			.on('exit', (code) => resolve(code ?? 1));
	}));
	const codes = await Promise.all(racers);
	check(codes.every((code) => code === 0), `every writer finished (${codes.join(', ')})`);

	const contended = await store.open('contended');
	const held = contended.root as Doc;
	let survived = 0;
	for (let i = 0; i < 8; i++) if (held[`w${i}`] === i) survived++;
	check(survived === 8, `every process wrote into one document (${survived} of 8 slots)`);
	check(await store.head('contended') === 8, 'and each of their commits took a sequence of its own');

	console.log('\na path declared after the documents were written');
	const later = createStore({
		driver: postgresDriver(pool),
		declare: { title: ['title'], author: ['meta', 'authorId'] },
	});
	const byAuthor = await later.find({ where: [{ field: 'author', op: 'eq', value: 'u_7' }] });
	check(byAuthor[0]?.doc === 'board',
		'a path nobody had declared finds the document the dead process wrote');
	check((await later.find({ where: [{ field: 'author', op: 'eq', value: null }] }))[0]?.doc === 'contended',
		'and one whose path holds nothing answers for null rather than being invisible');

	await later.stop();
	await store.stop();

	console.log('\nwhat this does not do for you');
	console.log('  nothing is told that a document changed: no notification, no LISTEN. Live');
	console.log('  updates go through sync, and one end decides a document\'s commits.');
	console.log('  the pool is yours. The driver borrows connections and never ends it, so how');
	console.log('  many there are, how it authenticates and which schema it lands in are yours,');
	console.log('  and so is ending it.');
	console.log('  declaring a new path reads every stored document once, at startup, before the');
	console.log('  store answers anything.');

	console.log(process.exitCode ? '\nFAILED' : '\nall of it holds');
} finally {
	await pool.end();
	await server.stop();
	rmSync(directory, { recursive: true, force: true });
}
