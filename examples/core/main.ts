// A headless issue tracker, built on core, that checks itself.
//
// The job is an ordinary one: tasks with a status, a running count per status kept beside
// them, an undo stack, and a second copy of the document kept in step over the wire. What
// makes it a proof rather than a demo is that the invariant tying the counts to the tasks is
// checked from inside a watcher, on every commit, while a burst of edits runs. If a commit
// ever reached a watcher half applied, the count would disagree with the tasks and this
// program would exit nonzero.
//
// Run: node examples/core/main.ts

import { decodeCommit, encodeCommit } from '@aweftjs/codec';
import { randomFrom } from '@aweftjs/testing';
import type { Commit } from '@aweftjs/codec';
import { apply, atomic, createArray, createObject, idOf, observer, snapshot } from '@aweftjs/core';
import type { Change } from '@aweftjs/core';

// --- the application -------------------------------------------------------------------

interface Task {
	title: string;
	status: 'open' | 'done';
}

interface Counts {
	open: number;
	done: number;
}

// The slots arrive with the first commit rather than with the constructor, because the second
// copy of this document is built from commits and can only hold what a commit described.
interface Board {
	tasks?: Task[];
	counts?: Counts;
}

const install = (board: Board): void => {
	atomic(() => {
		board.tasks = createArray<Task>();
		board.counts = createObject<Counts>({ open: 0, done: 0 });
	});
};

/** Add a task and move the count with it, so the two are never apart between commits. */
const addTask = (board: Board, title: string): void => {
	const { tasks, counts } = board;
	if (tasks === undefined || counts === undefined) return;

	atomic(() => {
		tasks.push(createObject<Task>({ title, status: 'open' }));
		counts.open += 1;
	});
};

const setStatus = (board: Board, at: number, status: Task['status']): void => {
	const { tasks, counts } = board;
	const task = tasks?.[at];
	if (task === undefined || counts === undefined || task.status === status) return;

	atomic(() => {
		task.status = status;
		counts.open += status === 'open' ? 1 : -1;
		counts.done += status === 'done' ? 1 : -1;
	});
};

const removeTask = (board: Board, at: number): void => {
	const { tasks, counts } = board;
	const task = tasks?.[at];
	if (task === undefined || tasks === undefined || counts === undefined) return;

	atomic(() => {
		const was = task.status;
		tasks.splice(at, 1);
		counts[was] -= 1;
	});
};

const renameTask = (board: Board, at: number, title: string): void => {
	const task = board.tasks?.[at];
	if (task !== undefined) task.title = title;
};

// --- the checks ------------------------------------------------------------------------

let checks = 0;

const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) {
		console.error(`FAIL: ${what}`);
		process.exit(1);
	}
};

/** Two documents match when they say the same thing, whatever order they were built in. */
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

const canonical = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
		.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
		.join(',')}}`;
};

/** The cross-field invariant. Nothing outside a commit boundary may ever see this false. */
const consistent = (board: Board): boolean => {
	const { tasks, counts } = board;
	if (tasks === undefined || counts === undefined) return tasks === counts;

	const open = tasks.filter((t) => t.status === 'open').length;
	const done = tasks.filter((t) => t.status === 'done').length;
	return counts.open === open && counts.done === done;
};

// --- the run ---------------------------------------------------------------------------

const seed = Number(process.env.SEED ?? 20260831);
const random = randomFrom(seed);

const board = createObject<Board>();
const replica = createObject<Board>(undefined, idOf(board));
const start = snapshot(board);

// A watcher that checks the invariant every time a commit lands. This is the atomicity claim
// under test: the counts and the tasks are written in the same block, so a watcher must never
// catch them apart, however many mutations the block made.
let torn = 0;
observer(board).watch(() => {
	if (!consistent(board)) torn += 1;
});

// A second document, fed the same commits through the encoder. Nothing is shared but bytes.
observer(board).watch((change) => {
	apply(replica, decodeCommit(encodeCommit({ deltas: [...change.deltas] })));
});

// An undo stack, built from the inverse every change hands back.
const undoable: Commit[] = [];
const redoable: Commit[] = [];
let recording: 'edit' | 'undo' | 'redo' = 'edit';

observer(board).watch((change) => {
	const inverse = change.inverse();
	if (recording === 'edit') {
		undoable.push(inverse);
		redoable.length = 0;
	} else if (recording === 'undo') {
		redoable.push(inverse);
	} else {
		undoable.push(inverse);
	}
});

const replay = (from: Commit[], mode: 'undo' | 'redo'): boolean => {
	const commit = from.pop();
	if (commit === undefined) return false;

	recording = mode;
	apply(board, commit);
	recording = 'edit';
	return true;
};

// A scoped watcher, to prove a scope narrows delivery rather than merely filtering afterwards.
let titleChanges = 0;
observer(board).path('tasks').ignore('counts').watch((change) => {
	titleChanges += change.deltas.filter((d) => d.ref.key === 'title').length;
});

install(board);

// A burst. Every operation keeps the invariant, and every one is a commit.
for (let step = 0; step < 400; step++) {
	const roll = random();
	const held = board.tasks!.length;
	const at = Math.floor(random() * Math.max(held, 1));

	if (roll < 0.4 || held === 0) addTask(board, `task ${step}`);
	else if (roll < 0.6) setStatus(board, at, 'done');
	else if (roll < 0.7) setStatus(board, at, 'open');
	else if (roll < 0.85) renameTask(board, at, `renamed ${step}`);
	else removeTask(board, at);
}

check(torn === 0, `a watcher saw a half applied commit ${torn} times`);
check(consistent(board), 'the board is inconsistent after the burst');
check(board.tasks!.length > 20, `the burst left only ${String(board.tasks?.length)} tasks, seed ${seed}`);
check(titleChanges > 0, 'the scoped watcher never saw a title change');

const after = snapshot(board);
check(same(snapshot(replica), after), 'the replica does not hold the same document as the board');

// Undo everything, one commit at a time, checking the invariant the whole way back.
let undone = 0;
while (replay(undoable, 'undo')) {
	undone += 1;
	check(consistent(board), `undo ${undone} left the board inconsistent`);
}

check(undone > 100, `only ${undone} commits were undone`);
check(same(snapshot(board), start), 'undoing every commit did not reach the document it started from');
check(board.tasks === undefined, 'undo did not take the document back to an empty root');

// Then redo it all, which is undoing the undo.
let redone = 0;
while (replay(redoable, 'redo')) {
	redone += 1;
	check(consistent(board), `redo ${redone} left the board inconsistent`);
}

check(redone === undone, `${redone} commits were redone against ${undone} undone`);
check(same(snapshot(board), after), 'redoing every commit did not reach the document undo started from');
check(torn === 0, 'a watcher saw a half applied commit during undo or redo');
check(same(snapshot(replica), after), 'the replica did not follow the undo and redo');

console.log(
	`core proof: ${checks} checks, seed ${seed}, ${String(board.tasks?.length)} tasks, ` +
	`${undone} commits undone and redone, replica in step`,
);
