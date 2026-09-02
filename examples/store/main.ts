// A document that outlives the process that wrote it, and a name two openers cannot both take.
//
// The two things `docs/architecture.md` says this proof has to demonstrate: write, kill the
// process, reopen, verify; and find-or-create under concurrent open. The kill is a real
// SIGKILL of a real child, not a close and reopen, because a clean shutdown is exactly the
// case a store gets right by accident.
//
// Run: node examples/store/main.ts

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomic, createArray, createObject } from '@aweftjs/core';
import { createStore } from '@aweftjs/store';

import { fileDriver } from './driver-file.ts';

type Doc = Record<string, unknown>;
const here = fileURLToPath(import.meta.url);

const check = (ok: boolean, what: string): void => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) process.exitCode = 1;
};

// --- the child: writes, then dies without ever being told to stop ----------------------------
if (process.argv[2] === 'write') {
	const store = createStore({ driver: fileDriver(process.argv[3]!) });
	const board = await store.open('board');
	const root = board.root as Doc;
	const tasks = createArray<Doc>();
	atomic(() => { root.title = 'the board'; root.tasks = tasks; });
	for (let i = 0; i < 5; i++) tasks.push(createObject<Doc>({ title: `task ${i}`, done: i % 2 === 0 }));
	(tasks[2] as Doc).title = 'task two, renamed';
	await store.settled(board);

	// Nothing is closed, nothing is flushed, and the next line is fatal.
	process.kill(process.pid, 'SIGKILL');
}

// --- the parent -------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'aweft-store-'));
try {
	console.log('write, kill the process, reopen');
	const child = spawnSync(process.execPath, [here, 'write', dir], { encoding: 'utf8' });
	check(child.signal === 'SIGKILL', `the writer was killed, not shut down (signal ${child.signal})`);

	const store = createStore({ driver: fileDriver(dir) });
	const board = await store.open('board');
	const root = board.root as Doc;
	const tasks = root.tasks as Doc[];

	check(root.title === 'the board', 'the document came back');
	check(tasks?.length === 5, `every task came back (${tasks?.length ?? 0} of 5)`);
	check(tasks?.[2]?.title === 'task two, renamed', 'the last write before the kill survived it');
	check(tasks?.[3]?.done === false, 'a value nothing touched is still what it was');

	const history = await store.since('board', 0);
	check(history.length === board.seq, `the history is complete (${history.length} commits)`);
	check(history.every((h, i) => h.seq === i + 1), 'and its sequences have no holes');

	// the reopened document is live: it keeps writing where the dead one left off
	(tasks[0] as Doc).done = true;
	await store.settled(board);
	const after = await createStore({ driver: fileDriver(dir) }).open('board');
	check(((after.root as Doc).tasks as Doc[])[0]!.done === true, 'and it carries on being written to');

	console.log('\nfind-or-create under concurrent open');
	const racers = Array.from({ length: 8 }, () => createStore({ driver: fileDriver(dir) }));
	const opened = await Promise.all(racers.map((s) => s.open('contended')));
	const roots = new Set<string>();
	for (const [i, handle] of opened.entries()) {
		(handle.root as Doc)[`w${i}`] = i;
		await racers[i]!.settled(handle);
		roots.add(JSON.stringify((await racers[i]!.since('contended', 0)).length > 0));
	}
	const settled = await createStore({ driver: fileDriver(dir) }).open('contended');
	const held = settled.root as Doc;

	check((await createStore({ driver: fileDriver(dir) }).open('contended')) !== undefined, 'the name resolves');
	let survived = 0;
	for (let i = 0; i < 8; i++) if (held[`w${i}`] === i) survived++;
	check(survived === 8, `every opener's write survived (${survived} of 8), so they all got one document`);

	await store.stop();
	for (const s of racers) await s.stop();
	void roots;

	console.log(process.exitCode ? '\nFAILED' : '\nall of it holds');
} finally {
	rmSync(dir, { recursive: true, force: true });
}
