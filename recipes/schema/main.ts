// A task board that two nodes share, and neither of them will hold wrongly.
//
// The job is an ordinary one: a board with columns and tasks, edited here and mirrored on a
// second node. What makes it a proof is where the description is enforced. The board carries
// a guard, so a bad edit written here never lands and never reaches the mirror. The mirror
// carries no guard and asks `check` at its own door instead, because a node that did not make
// a commit still has to decide whether to take it. The same description answers both.
//
// Run: node recipes/schema/main.ts

import {
	RefusedError, apply, atomic, createArray, createMap, createObject, fromSnapshot, observer,
	snapshot, textIdOf,
} from '@aweftjs/core';
import type { Change, Commit, ObservableMap } from '@aweftjs/core';
import { check, guard, list, shape, table } from '@aweftjs/schema';
import type { Refusal, StandardSchema } from '@aweftjs/schema';

// --- the validators, written here against the interface ----------------------------------

const rule = (test: (value: unknown) => string | undefined): StandardSchema => ({
	'~standard': {
		version: 1,
		vendor: 'task-board',
		validate: (value) => {
			const problem = test(value);
			return problem === undefined ? { value } : { issues: [{ message: problem }] };
		},
	},
});

const words = (min: number, max: number): StandardSchema =>
	rule((value) => {
		if (typeof value !== 'string') return 'expected some text';
		if (value.trim().length < min) return `expected at least ${min} characters of text`;
		if (value.length > max) return `expected at most ${max} characters`;
		return undefined;
	});

const count = (min: number, max: number): StandardSchema =>
	rule((value) => {
		if (typeof value !== 'number' || !Number.isInteger(value)) return 'expected a whole number';
		return value < min || value > max ? `expected a number between ${min} and ${max}` : undefined;
	});

const flag = rule((value) => (typeof value === 'boolean' ? undefined : 'expected true or false'));

const maybe = (inner: StandardSchema): StandardSchema => ({
	'~standard': {
		version: 1,
		vendor: 'task-board',
		validate: (value) => (value === undefined ? { value } : inner['~standard'].validate(value)),
	},
});

// --- the description ---------------------------------------------------------------------

const Board = shape({
	title: words(1, 60),
	columns: list(shape({ name: words(1, 24), limit: count(1, 20) })),
	tasks: table(shape({ title: words(1, 80), done: flag, notes: maybe(words(1, 400)) })),
});

// --- the application -----------------------------------------------------------------------

interface Column extends Record<string, unknown> {
	name: string;
	limit: number;
}

interface Task extends Record<string, unknown> {
	title: string;
	done: boolean;
	notes?: string;
}

interface BoardDoc extends Record<string, unknown> {
	title: string;
	columns: Column[];
	tasks: ObservableMap<Task>;
}

const newBoard = (title: string): BoardDoc => createObject<BoardDoc>({
	title,
	columns: createArray<Column>(),
	tasks: createMap<Task>(),
});

const addColumn = (board: BoardDoc, name: string, limit: number): void => {
	board.columns.push(createObject<Column>({ name, limit }));
};

const addTask = (board: BoardDoc, title: string): string => {
	const task = createObject<Task>({ title, done: false });
	board.tasks.add(task);
	return textIdOf(task);
};

// --- the checks ----------------------------------------------------------------------------

let checks = 0;

const ok = (passed: boolean, what: string): void => {
	checks += 1;
	if (!passed) {
		console.error(`FAIL: ${what}`);
		process.exit(1);
	}
};

const refused = (run: () => void): readonly Refusal[] => {
	try {
		run();
	} catch (error) {
		if (error instanceof RefusedError) return error.refusals;
		console.error(`FAIL: expected a refusal, got ${String(error)}`);
		process.exit(1);
	}

	console.error('FAIL: expected a refusal, the change went through');
	return process.exit(1);
};

/** Deep equality, because a snapshot's slots are a plain object and their order is not the
 * document: two nodes that applied the same commits in a different order still hold one board. */
const same = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => key in right && same(left[key], right[key]));
};

// --- the run ---------------------------------------------------------------------------------

const board = newBoard('release 1');
const stopGuard = guard(board, Board);

// The second node. It starts as a copy of the board, so the two agree about every id, and it
// takes commits at its own door, where nothing has been applied yet: a commit it turns away
// costs it nothing at all.
const mirror = fromSnapshot(snapshot(board)) as BoardDoc;
let arrived = 0;
let turnedAway = 0;

const receive = (commit: Commit): boolean => {
	const problems = check(Board, mirror, commit);
	if (problems.length > 0) {
		turnedAway += 1;
		return false;
	}

	apply(mirror, commit);
	arrived += 1;
	return true;
};

const outbound: Commit[] = [];
observer(board).watch((change: Change) => outbound.push({ deltas: [...change.deltas] }));
const flush = (): void => {
	while (outbound.length > 0) receive(outbound.shift()!);
};

// The good changes. A column and three tasks, each one a whole subtree built and attached in
// one commit, so the description is met at the place it lands rather than where it was made.
addColumn(board, 'doing', 5);
const first = addTask(board, 'write the proof');
addTask(board, 'run the gate');
atomic(() => {
	addColumn(board, 'done', 20);
	addTask(board, 'read it back');
});
board.tasks.get(first)!.done = true;
flush();

ok(board.columns.length === 2, 'the columns did not land');
ok(board.tasks.size === 3, 'the tasks did not land');
ok(board.tasks.get(first)!.done, 'the task was not marked done');
ok(same(snapshot(mirror), snapshot(board)), 'the mirror does not hold the same board');

const settled = snapshot(board);

// A bad local write. The guard refuses it, the document is untouched, and because nothing was
// delivered the mirror never hears about it either.
const emptyTitle = refused(() => { board.title = ''; });
ok(emptyTitle.length === 1, 'an empty title should be one refusal');
ok(emptyTitle[0]!.code === 'invalid', `expected an invalid refusal, got ${String(emptyTitle[0]!.code)}`);
ok(same(emptyTitle[0]!.path, ['title']), 'the refusal did not name the title');
ok(board.title === 'release 1', 'the refused title landed anyway');

// A bad subtree, attached in one commit. Every delta in it is about a slot the description
// names; what is wrong is the value in one of them, and the limit that is missing entirely.
const badColumn = refused(() => { board.columns.push(createObject({ name: '' } as Column)); });
ok(badColumn.length === 2, `a nameless column with no limit should be two refusals, got ${badColumn.length}`);
ok(board.columns.length === 2, 'the refused column landed anyway');

// A block is one commit, so a good change and a bad one in the same block go back together.
refused(() => atomic(() => {
	board.title = 'release 2';
	addTask(board, '');
}));
ok(board.title === 'release 1', 'the good half of a refused block stayed');
ok(board.tasks.size === 3, 'the refused task landed anyway');

flush();
ok(same(snapshot(board), settled), 'the board moved during the refusals');
ok(same(snapshot(mirror), settled), 'a refused commit reached the mirror');

// A commit arriving from somewhere the guard does not cover. It is built on a scratch copy of
// the board, which nothing guards, and handed to the mirror's door, which is where a node
// decides. `check` answers there with nothing applied.
const scratch = fromSnapshot(snapshot(board)) as BoardDoc;
const scratchCommits: Commit[] = [];
const stopScratch = observer(scratch).watch((change: Change) => {
	scratchCommits.push({ deltas: [...change.deltas] });
});

scratch.columns[0]!.limit = 999;
addTask(scratch, 'a fine task from elsewhere');
stopScratch();

const [tooBig, fine] = scratchCommits;
ok(receive(tooBig!) === false, 'the mirror took a commit that breaks the description');
ok(mirror.columns[0]!.limit === 5, 'the refused commit landed on the mirror anyway');
ok(receive(fine!) === true, 'the mirror turned away a good commit');
ok(mirror.tasks.size === 4, 'the good commit did not land on the mirror');

// The same commit at the other end: the guarded board refuses it inside `apply`, before any
// watcher hears anything, so the two nodes agree about what the document may hold.
const heardBefore = outbound.length;
const overTheLimit = refused(() => apply(board, tooBig!));
ok(overTheLimit[0]!.code === 'invalid', 'the guard refused the arriving commit for the wrong reason');
ok(board.columns[0]!.limit === 5, 'the arriving commit landed on the board anyway');
ok(outbound.length === heardBefore, 'a refused arriving commit was delivered to a watcher');

// The board catches up with the task the mirror already has, so both nodes end up holding one
// document that fits the description from both directions.
apply(board, fine!);
// That commit came from the mirror, so handing it straight back is an echo. Suppressing one is
// a link's job and not this program's; here there is simply nothing left to send.
outbound.length = 0;
ok(board.tasks.size === 4, 'the board did not take the good commit');
ok(same(snapshot(board), snapshot(mirror)), 'the two nodes disagree about the board');

// Standalone, with no guard anywhere: the description alone answers for a whole document.
const audit = fromSnapshot(snapshot(board)) as BoardDoc;
const auditCommits: Commit[] = [];
const stopAudit = observer(audit).watch((change: Change) => {
	auditCommits.push({ deltas: [...change.deltas] });
});
audit.tasks.get(first)!.notes = 'the notes field is allowed to be missing, and allowed to be here';
stopAudit();
ok(check(Board, audit, auditCommits[0]!).length === 0, 'an optional field was refused when it was filled');

stopGuard();
board.title = '';
ok(board.title === '', 'the guard kept refusing after it was stopped');

console.log(
	`schema proof: ${checks} checks, ${board.columns.length} columns and ${board.tasks.size} tasks, ` +
	`${arrived} commits taken and ${turnedAway} turned away at the door, ` +
	'every refusal rolled back before any watcher saw it',
);
