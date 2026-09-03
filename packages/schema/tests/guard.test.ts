// A guarded document: what a bad change costs, wherever it comes from.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	RefusedError, apply, atomic, createArray, createObject, fromSnapshot, observer, snapshot,
} from '@aweftjs/core';
import type { Change } from '@aweftjs/core';

import { guard, list, shape } from '../src/index.ts';
import type { Commit, Shape } from '../src/index.ts';
import { flag, text } from './validators.ts';

interface Task extends Record<string, unknown> {
	title?: string;
	done?: boolean;
}

interface Board extends Record<string, unknown> {
	title?: string;
	tasks?: Task[];
}

const Board: Shape = shape({
	title: text({ min: 1, max: 40 }),
	tasks: list(shape({ title: text({ min: 1 }), done: flag() })),
});

const board = (): Board => createObject<Board>({ title: 'plan', tasks: createArray<Task>() });

/** A commit addressed to this document's ids, made on a copy so the original never saw it. */
const arriving = (doc: object, run: (copy: Board) => void): Commit => {
	const copy = fromSnapshot(snapshot(doc)) as Board;
	let out: Commit | undefined;
	const stop = observer(copy).watch((change) => {
		out = { deltas: [...change.deltas] };
	});

	run(copy);
	stop();

	assert.ok(out !== undefined, 'the mutation produced no commit');
	return out;
};

test('a guard lets a good local write through', () => {
	const doc = board();
	const stop = guard(doc, Board);

	doc.title = 'plan b';
	doc.tasks!.push(createObject<Task>({ title: 'ship', done: false }));

	assert.equal(doc.title, 'plan b');
	assert.equal(doc.tasks!.length, 1);
	stop();
});

test('a guard throws on a bad local write and leaves the document alone', () => {
	const doc = board();
	const before = snapshot(doc);
	const stop = guard(doc, Board);

	try {
		doc.title = '';
		assert.fail('the write should have been refused');
	} catch (error) {
		assert.ok(error instanceof RefusedError);
		assert.equal(error.refusals.length, 1);
		assert.equal(error.refusals[0]!.code, 'invalid');
		assert.deepEqual(error.refusals[0]!.path, ['title']);
	}

	assert.equal(doc.title, 'plan');
	assert.deepEqual(snapshot(doc), before);
	stop();
});

test('a block is refused whole, however much of it was good', () => {
	const doc = board();
	const before = snapshot(doc);
	const stop = guard(doc, Board);

	assert.throws(
		() => atomic(() => {
			doc.title = 'a good title';
			doc.tasks!.push(createObject<Task>({ title: '', done: false }));
		}),
		RefusedError,
	);

	assert.deepEqual(snapshot(doc), before, 'the good half went back too');
	stop();
});

test('a guard refuses an arriving commit before anything lands', () => {
	const doc = board();
	const before = snapshot(doc);
	const heard: Change[] = [];
	observer(doc).watch((change) => heard.push(change));

	const stop = guard(doc, Board);
	const bad = arriving(doc, (copy) => { copy.title = ''; });

	assert.throws(() => apply(doc, bad), RefusedError);
	assert.deepEqual(snapshot(doc), before);
	assert.equal(heard.length, 0, 'nothing was delivered');

	const good = arriving(doc, (copy) => { copy.title = 'from elsewhere'; });
	apply(doc, good);

	assert.equal(doc.title, 'from elsewhere');
	assert.equal(heard.length, 1, 'and a good one arrives normally');
	stop();
});

test('a guard refuses a whole subtree arriving with a bad slot in it', () => {
	const doc = board();
	const before = snapshot(doc);
	const stop = guard(doc, Board);

	const bad = arriving(doc, (copy) => {
		copy.tasks!.push(createObject<Task>({ title: 'fine', done: 'maybe' as unknown as boolean }));
	});

	assert.throws(() => apply(doc, bad), RefusedError);
	assert.deepEqual(snapshot(doc), before);
	stop();
});

test('stopping the guard stops the checking', () => {
	const doc = board();
	const stop = guard(doc, Board);

	assert.throws(() => { doc.title = ''; }, RefusedError);
	stop();

	doc.title = '';
	assert.equal(doc.title, '');
});

test('a guard covers the document, not the subtree it was attached at', () => {
	const doc = board();
	const stop = guard(doc.tasks!, Board);

	assert.throws(() => { doc.title = ''; }, RefusedError);
	stop();
});

test('two guards on one document both answer', () => {
	const doc = board();
	const stopOne = guard(doc, Board);
	const stopTwo = guard(doc, shape({ title: text({ min: 2 }), tasks: list(shape({})) }));

	try {
		doc.title = '';
		assert.fail('the write should have been refused');
	} catch (error) {
		assert.ok(error instanceof RefusedError);
		assert.equal(error.refusals.length, 2, 'one refusal from each description');
	}

	stopOne();
	stopTwo();
});
