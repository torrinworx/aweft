// Documents in one SQLite file, beside a table of the application's own: a process that dies
// mid-edit, four processes opening one name at once, and a path declared after the data was
// already there.
//
// Real child processes, because each of these is about what survives something the writer did
// not agree to. The application opens the file and sets its pragmas; the driver only uses the
// handle it is given.
//
// Run: node recipes/documents-on-sqlite/main.ts

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { atomic, createArray, createObject } from '@aweftjs/core';
import { createStore } from '@aweftjs/store';
import { sqliteDriver } from '@aweftjs/store/sqlite';

type Doc = Record<string, unknown>;
const here = fileURLToPath(import.meta.url);

const check = (ok: boolean, what: string): void => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) process.exitCode = 1;
};

// The application's handle, the same in every process: write-ahead logging so readers do not
// wait on a writer, and a busy timeout so a second writer waits for the lock rather than failing.
const openFile = (path: string): DatabaseSync => {
	const db = new DatabaseSync(path);
	db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000');
	db.exec('CREATE TABLE IF NOT EXISTS visits (at text NOT NULL, page text NOT NULL)');
	return db;
};

// --- the child that writes a document and then dies without being told to stop ----------------
if (process.argv[2] === 'write') {
	const db = openFile(process.argv[3]!);
	const store = createStore({ driver: sqliteDriver(db), declare: { title: ['title'] } });
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
	db.prepare('INSERT INTO visits (at, page) VALUES (?, ?)').run('2026-10-31T12:00:00Z', '/board');
	await store.settled(board);

	// Nothing is closed, the handle is never released, and the next line is fatal.
	process.kill(process.pid, 'SIGKILL');
}

// --- one of four children opening the same name at the same moment ----------------------------
if (process.argv[2] === 'contend') {
	const db = openFile(process.argv[3]!);
	const mine = Number(process.argv[4]);
	const store = createStore({ driver: sqliteDriver(db) });
	const handle = await store.open('contended');
	(handle.root as Doc)[`w${mine}`] = mine;
	await store.settled(handle);
	await store.stop();
	db.close();
	process.exit(0);
}

// --- the parent -------------------------------------------------------------------------------
const directory = mkdtempSync(join(tmpdir(), 'aweft-sqlite-'));
const path = join(directory, 'app.db');
// A child's only output on stderr is node's notice that `node:sqlite` is experimental, so it is
// kept and shown only when the child fails.
const quiet = { stdio: ['ignore', 'inherit', 'pipe'] as ['ignore', 'inherit', 'pipe'], encoding: 'utf8' as const };

try {
	console.log('write into a file, kill the process, reopen');
	const child = spawnSync(process.execPath, [here, 'write', path], quiet);
	check(child.signal === 'SIGKILL', `the writer was killed, not shut down (signal ${String(child.signal)})`);
	if (child.signal !== 'SIGKILL') console.error(child.stderr);

	const db = openFile(path);
	const store = createStore({ driver: sqliteDriver(db), declare: { title: ['title'] } });
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
	const visits = db.prepare('SELECT page FROM visits').all() as { page: string }[];
	check(visits.length === 1 && visits[0]!.page === '/board',
		'the application\'s own table in the same file kept its row');

	console.log('\nfour processes open one name at the same moment');
	const racers = Array.from({ length: 4 }, (_, i) => new Promise<{ code: number; stderr: string }>((resolve) => {
		let stderr = '';
		const racer = spawn(process.execPath, [here, 'contend', path, String(i)], { stdio: quiet.stdio });
		racer.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
		racer.on('exit', (code) => resolve({ code: code ?? 1, stderr }));
	}));
	const finished = await Promise.all(racers);
	check(finished.every((f) => f.code === 0), `every writer finished (${finished.map((f) => f.code).join(', ')})`);
	for (const f of finished) if (f.code !== 0) console.error(f.stderr);

	const contended = await store.open('contended');
	const held = contended.root as Doc;
	let survived = 0;
	for (let i = 0; i < 4; i++) if (held[`w${i}`] === i) survived++;
	check(survived === 4, `every process wrote into one document (${survived} of 4 slots)`);
	check(await store.head('contended') === 4, 'and each of their commits took a sequence of its own');

	console.log('\na path declared after the documents were written');
	const later = createStore({
		driver: sqliteDriver(db),
		declare: { title: ['title'], author: ['meta', 'authorId'] },
	});
	const byAuthor = await later.find({ where: [{ field: 'author', op: 'eq', value: 'u_7' }] });
	check(byAuthor[0]?.doc === 'board', 'a path nobody had declared finds the document the dead process wrote');
	check((await later.find({ where: [{ field: 'author', op: 'eq', value: null }] }))[0]?.doc === 'contended',
		'and one whose path holds nothing answers for null rather than being invisible');

	await later.stop();
	await store.stop();
	check(db.isOpen, 'stopping the store left the handle open for the application');
	db.close();

	console.log('\nwhat this does not do for you');
	console.log('  the handle is yours. Journal mode, the busy timeout, how durable a commit is and');
	console.log('  when the file closes are set where you open it; the driver changes none of them.');
	console.log('  every write takes the whole file\'s write lock, so writers to different documents');
	console.log('  take turns. A process that waits past its busy timeout is refused with SQLITE_BUSY.');
	console.log('  nothing is told that a document changed. Live updates go through sync, and one');
	console.log('  end decides a document\'s commits.');

	console.log(process.exitCode ? '\nFAILED' : '\nall of it holds');
} finally {
	rmSync(directory, { recursive: true, force: true });
}
