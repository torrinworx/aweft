// What `check` says about one commit, for every delta type and every observable kind.
//
// Every case runs the same commit twice, against the document before it landed and against
// the document after, because a boundary calls this with nothing applied and a guard calls it
// with everything applied, and one answer has to serve both.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesToHex } from '@aweftjs/codec';
import {
	alias, atomic, createArray, createMap, createObject, fromSnapshot, observer, positionsOf, snapshot,
	textIdOf,
} from '@aweftjs/core';
import type { ObservableMap } from '@aweftjs/core';

import { check, list, shape, table } from '../src/index.ts';
import type { Commit, Refusal, Shape } from '../src/index.ts';
import { flag, later, number, optional, text } from './validators.ts';

const commitFrom = (doc: object, run: () => void): Commit => {
	let out: Commit | undefined;
	const stop = observer(doc).watch((change) => {
		out = { deltas: [...change.deltas] };
	});

	run();
	stop();

	assert.ok(out !== undefined, 'the mutation produced no commit to check');
	return out;
};

/**
 * Make the change, then ask about it from both sides of it: the copy taken before it landed
 * and the document it landed in. The two answers have to match.
 */
const problems = (form: Shape, doc: object, run: () => void): readonly Refusal[] => {
	const before = fromSnapshot(snapshot(doc));
	const commit = commitFrom(doc, run);

	const after = check(form, doc, commit);
	assert.deepEqual(
		check(form, before, commit),
		after,
		'the answer must not depend on whether the commit has been applied yet',
	);
	return after;
};

const codes = (found: readonly Refusal[]): string[] => found.map((r) => r.code);

interface Task extends Record<string, unknown> {
	title?: string;
	done?: boolean;
	note?: string;
}

interface Board extends Record<string, unknown> {
	title?: string;
	tasks?: Task[];
	people?: ObservableMap<Record<string, unknown>>;
	settings?: Record<string, unknown>;
}

const Task: Shape = shape({ title: text({ min: 1, max: 40 }), done: flag(), note: optional(text()) });
const Board: Shape = shape({
	title: text({ min: 1 }),
	tasks: list(Task),
	people: table(shape({ name: text({ min: 1 }) })),
});

const board = (): Board => createObject<Board>({
	title: 'plan',
	tasks: createArray<Task>(),
	people: createMap(),
});

test('a value the leaf accepts is no problem', () => {
	const doc = board();
	assert.deepEqual(problems(Board, doc, () => { doc.title = 'plan b'; }), []);
});

test('a value the leaf refuses is one refusal carrying the validator message and the path', () => {
	const doc = board();
	const found = problems(Board, doc, () => { doc.title = ''; });

	assert.equal(found.length, 1);
	assert.equal(found[0]!.code, 'invalid');
	assert.deepEqual(found[0]!.path, ['title']);
	assert.match(found[0]!.message, /at least 1 characters/);
});

test('an added slot the shape does not name is unexpected', () => {
	const doc = board();
	const found = problems(Board, doc, () => { doc.colour = 'red'; });

	assert.deepEqual(codes(found), ['unexpected']);
	assert.deepEqual(found[0]!.path, ['colour']);
});

test('removing a field the shape requires is refused, and an optional one is not', () => {
	const doc = createObject<Task>({ title: 'write', done: false, note: 'later' });

	assert.deepEqual(problems(Task, doc, () => { delete doc.note; }), [],
		'a leaf that accepts nothing being there is what optional means');

	const found = problems(Task, doc, () => { delete doc.done; });
	assert.deepEqual(codes(found), ['invalid']);
	assert.deepEqual(found[0]!.path, ['done']);
	assert.match(found[0]!.message, /expected true or false/);
});

test('an observable where the shape has a value is a kind refusal', () => {
	const doc = board();
	const found = problems(Board, doc, () => { doc.title = createObject({}) as unknown as string; });

	assert.deepEqual(codes(found), ['kind']);
	assert.match(found[0]!.message, /where the shape has a value/);
});

test('a value where the shape has a list is a kind refusal', () => {
	const doc = board();
	const found = problems(Board, doc, () => { doc.tasks = 'none' as unknown as Task[]; });

	assert.deepEqual(codes(found), ['kind']);
	assert.match(found[0]!.message, /where the shape has a list/);
});

test('an observable of the wrong kind is a kind refusal', () => {
	const doc = board();
	const found = problems(Board, doc, () => { doc.tasks = createMap() as unknown as Task[]; });

	assert.deepEqual(codes(found), ['kind']);
	assert.match(found[0]!.message, /a table where the shape has a list/);
});

test('an array element is checked against the item description, at its position in hex', () => {
	const doc = board();
	assert.deepEqual(
		problems(Board, doc, () => { doc.tasks!.push(createObject<Task>({ title: 'write', done: false })); }),
		[],
	);

	const found = problems(Board, doc, () => { doc.tasks![0]!.title = ''; });
	const position = bytesToHex(positionsOf(doc.tasks!)[0]!);

	assert.deepEqual(codes(found), ['invalid']);
	assert.deepEqual(found[0]!.path, ['tasks', position, 'title']);
});

test('removing an array element is always fine', () => {
	const doc = board();
	doc.tasks!.push(createObject<Task>({ title: 'write', done: false }));

	assert.deepEqual(problems(Board, doc, () => { doc.tasks!.splice(0, 1); }), []);
});

test('a map entry is checked against the value description, at its id in text form', () => {
	const doc = board();
	const person = createObject({ name: 'rita' });

	assert.deepEqual(problems(Board, doc, () => { doc.people!.add(person); }), []);

	const found = problems(Board, doc, () => { doc.people!.get(textIdOf(person))!.name = ''; });
	assert.deepEqual(codes(found), ['invalid']);
	assert.deepEqual(found[0]!.path, ['people', textIdOf(person), 'name']);
});

test('removing a map entry is always fine', () => {
	const doc = board();
	const person = createObject({ name: 'rita' });
	doc.people!.add(person);

	assert.deepEqual(problems(Board, doc, () => { doc.people!.delete(textIdOf(person)); }), []);
});

test('a subtree built and attached in one commit is checked at the path it lands on', () => {
	const doc = board();

	assert.deepEqual(
		problems(Board, doc, () => {
			doc.tasks!.push(createObject<Task>({ title: 'ship it', done: false }));
		}),
		[],
	);

	const found = problems(Board, doc, () => {
		doc.tasks!.push(createObject<Task>({ title: '', done: 'yes' as unknown as boolean }));
	});

	assert.deepEqual(codes(found).sort(), ['invalid', 'invalid']);
	const position = bytesToHex(positionsOf(doc.tasks!)[1]!);
	assert.deepEqual(
		found.map((r) => r.path!.join('/')).sort(),
		[`tasks/${position}/done`, `tasks/${position}/title`],
	);
});

test('a subtree that arrives without a field the shape names is refused', () => {
	const doc = board();
	const found = problems(Board, doc, () => {
		doc.tasks!.push(createObject<Task>({ title: 'no done flag' }));
	});

	assert.deepEqual(codes(found), ['invalid']);
	assert.match(found[0]!.message, /expected true or false/);
	assert.equal(found[0]!.path!.at(-1), 'done');
});

test('a subtree that arrives with a slot the shape does not name is refused', () => {
	const doc = board();
	const found = problems(Board, doc, () => {
		doc.tasks!.push(createObject<Task>({ title: 'ok', done: true, colour: 'red' }));
	});

	assert.deepEqual(codes(found), ['unexpected']);
	assert.equal(found[0]!.path!.at(-1), 'colour');
});

test('a write below a slot the shape does not name is unexpected', () => {
	const doc = board();
	const stray = createObject<Record<string, unknown>>({ n: 1 });
	doc.settings = stray;

	const found = problems(Board, doc, () => { stray.n = 2; });
	assert.deepEqual(codes(found), ['unexpected']);
	assert.deepEqual(found[0]!.path, ['settings', 'n']);
});

test('a write below a slot the shape has as a value is a kind refusal', () => {
	const Held: Shape = shape({ title: text() });
	const doc = createObject<Record<string, unknown>>({ title: 'a' });
	const inside = createObject<Record<string, unknown>>({ n: 1 });
	doc.title = inside;

	const found = problems(Held, doc, () => { inside.n = 2; });
	assert.deepEqual(codes(found), ['kind']);
	assert.deepEqual(found[0]!.path, ['title', 'n']);
});

test('a document whose root is not the kind the shape describes is refused', () => {
	const doc = createArray<number>([1]);
	const found = problems(shape({ title: text() }), doc, () => { doc.push(2); });

	assert.deepEqual(codes(found), ['kind']);
	assert.match(found[0]!.message, /a list where the shape has a shape/);
});

test('a list of values, not of observables', () => {
	const Counts: Shape = list(number({ min: 0 }));
	const doc = createArray<number>([1, 2]);

	assert.deepEqual(problems(Counts, doc, () => { doc.push(3); }), []);
	assert.deepEqual(codes(problems(Counts, doc, () => { doc.push(-1); })), ['invalid']);
});

test('a table of values, not of observables', () => {
	const Flags: Shape = table(flag());
	const doc = createMap<unknown>();
	const key = textIdOf(createObject({}));

	assert.deepEqual(problems(Flags, doc, () => { doc.set(key, true); }), []);
	assert.deepEqual(codes(problems(Flags, doc, () => { doc.set(key, 'yes'); })), ['invalid']);
});

test('a validator that answers later cannot decide a commit, and says which path', () => {
	const Slow: Shape = shape({ title: later() });
	const doc = createObject<Record<string, unknown>>();

	assert.throws(
		() => problems(Slow, doc, () => { doc.title = 'a'; }),
		(error: Error & { reason?: string }) =>
			error.reason === 'async-validator' && /title/.test(error.message),
	);
});

test('check does not write to the document', () => {
	const doc = board();
	const commit = commitFrom(doc, () => { doc.title = ''; });
	const before = snapshot(doc);

	check(Board, doc, commit);
	assert.deepEqual(snapshot(doc), before);
});

test('a commit into a document the shape fits leaves nothing to say', () => {
	const doc = board();
	const commit = commitFrom(doc, () => {
		doc.tasks!.push(createObject<Task>({ title: 'a', done: false }));
	});

	assert.deepEqual(check(Board, doc, commit), []);
});

test('a commit that writes into a subtree while detaching it answers the same from both sides', () => {
	// Core lets one commit write into a subtree it is taking out of the document, so a delta
	// can name an observable that has a path before the commit and none after it. Resolving
	// against the document as it was would judge that write at a path it is leaving, and the
	// same commit read from the other side would find nothing to judge at all.
	const doc = board();
	const task = createObject<Task>({ title: 'ship', done: false });
	doc.tasks!.push(task);

	const found = problems(Board, doc, () => {
		atomic(() => {
			doc.tasks!.splice(0, 1);
			task.title = '';
		});
	});

	assert.deepEqual(found, [], 'what left the document is not the shape of the document');
});

test('an alias is judged where it is filed, whole, when it is filed', () => {
	const Person = shape({ name: text({ min: 1 }) });
	const Everything = shape({ tasks: list(shape({ title: text(), done: flag() })), people: table(Person) });
	const task = createObject<Record<string, unknown>>({ title: 'a task', done: false });
	const person = createObject<Record<string, unknown>>({ name: 'ada' });
	const doc = createObject<Record<string, unknown>>({ tasks: createArray([task]), people: createMap() });

	const wrong = problems(Everything, doc, () => { (doc.people as ObservableMap<object>).set(textIdOf(task), alias(task)); });
	assert.ok(wrong.some((r) => r.code === 'invalid' && r.path!.at(-1) === 'name'), `a task filed as a person is refused: ${JSON.stringify(wrong)}`);
	assert.ok(wrong.some((r) => r.code === 'unexpected'), 'and its title is not a person\'s field');

	const fresh = createObject<Record<string, unknown>>({
		tasks: createArray([createObject({ title: 'another', done: true })]), people: createMap(), aside: person,
	});
	const right = problems(Everything, fresh, () => { (fresh.people as ObservableMap<object>).set(textIdOf(person), alias(person)); });
	assert.deepEqual(right.filter((r) => r.path!.at(-1) === 'name'), [], 'a person filed as a person is fine');
});
