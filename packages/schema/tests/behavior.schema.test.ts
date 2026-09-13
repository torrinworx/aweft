// The behavioral corpus for schema.
//
// Each case is a requirement this package must meet, taken from a class of failure that
// validating live state is known to contain: a rule that runs on a keystroke, a rule that
// answers differently depending on when it is asked, a subtree judged where it was built
// rather than where it landed, and a half-refused change left in the document. The corpus is
// append-only. Removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	RefusedError, alias, apply, atomic, createArray, createMap, createObject, fromSnapshot, mutable,
	observer, snapshot, textIdOf,
} from '@aweftjs/core';
import type { Change } from '@aweftjs/core';

import { check, guard, list, shape, table } from '../src/index.ts';
import type { Commit, Refusal, Shape } from '../src/index.ts';
import { flag, later, optional, text } from './validators.ts';

interface Person extends Record<string, unknown> {
	email?: string;
	nickname?: string;
}

interface Task extends Record<string, unknown> {
	title?: string;
	done?: boolean;
}

interface Board extends Record<string, unknown> {
	title?: string;
	tasks?: Task[];
	people?: unknown;
}

const email = text({ min: 3, max: 60 });
const Board: Shape = shape({
	title: text({ min: 1 }),
	tasks: list(shape({ title: text({ min: 1 }), done: flag() })),
	people: table(shape({ email, nickname: optional(text({ min: 1 })) })),
});

const board = (): Board => createObject<Board>({
	title: 'plan',
	tasks: createArray<Task>(),
	people: createMap(),
});

const commitFrom = (doc: object, run: () => void): Commit => {
	let out: Commit | undefined;
	const stop = observer(doc).watch((change) => {
		out = { deltas: [...change.deltas] };
	});

	run();
	stop();

	assert.ok(out !== undefined, 'the mutation produced no commit');
	return out;
};

test('a guarded field refuses a half-written value, so a draft is held outside the document', () => {
	// The oldest way to make a validator useless is to run it on every keystroke: an email
	// address is invalid for every character but the last one, so the field either refuses
	// what the person is typing or the rule is turned off where it was needed. The rule here
	// is not softened. The draft lives in a cell instead (design 024) and reaches the
	// document once, on submit.
	const doc = board();
	const person = createObject<Person>({ email: 'someone@example.com' });
	(doc.people as { add(v: object): void }).add(person);

	const stop = guard(doc, Board);
	const draft = mutable('');

	for (const character of 'ab@c.d') {
		draft.set(draft.get() + character);
		assert.equal(person.email, 'someone@example.com', 'nothing typed has touched the document');
	}

	assert.throws(() => { person.email = 'a'; }, RefusedError, 'and a partial value is still refused');
	person.email = draft.get();
	assert.equal(person.email, 'ab@c.d');
	stop();
});

test('one commit gets one answer, whether it has been applied or not', () => {
	// The same function serves a node deciding whether to apply an arriving commit, where
	// nothing has landed, and a guard on the document, where everything has. Two answers for
	// one commit means a node refuses what its own guard would have accepted, and the two ends
	// of a link disagree about what the document is allowed to hold.
	const doc = board();
	const before = fromSnapshot(snapshot(doc));

	const good = commitFrom(doc, () => {
		doc.tasks!.push(createObject<Task>({ title: 'ship', done: false }));
	});
	assert.deepEqual(check(Board, before, good), check(Board, doc, good));
	assert.deepEqual(check(Board, doc, good), []);

	const after = fromSnapshot(snapshot(doc));
	const bad = commitFrom(doc, () => { doc.tasks![0]!.title = ''; });
	assert.deepEqual(check(Board, after, bad), check(Board, doc, bad));
	assert.equal(check(Board, doc, bad).length, 1);
});

test('a subtree is judged where it lands, not where it was built', () => {
	// An observable is built detached and attached in the same commit, so at the moment the
	// commit is judged it has no path of its own to be judged at. Reading it where it was
	// built means reading it against no description at all, and every constructed subtree
	// walks past the rule.
	const doc = board();
	const stop = guard(doc, Board);

	assert.throws(
		() => atomic(() => { doc.tasks!.push(createObject<Task>({ title: '', done: false })); }),
		RefusedError,
	);
	assert.equal(doc.tasks!.length, 0);

	doc.tasks!.push(createObject<Task>({ title: 'ship', done: false }));
	assert.equal(doc.tasks!.length, 1);
	stop();
});

test('a subtree that arrives incomplete is refused, though no delta is wrong on its own', () => {
	// Every delta of this commit is fine where it lands. What is wrong is what is missing, and
	// a rule that only reads deltas cannot see a field that has none. A guard that lets this
	// through cannot claim the document keeps its shape.
	const doc = board();
	const stop = guard(doc, Board);

	assert.throws(
		() => { doc.tasks!.push(createObject<Task>({ title: 'no flag on this one' })); },
		RefusedError,
	);
	assert.equal(doc.tasks!.length, 0);
	stop();
});

test('a refused commit leaves nothing behind and tells nobody', () => {
	// A rule that runs after delivery is a repair job, not a rule: the deltas are already out,
	// and everything that recorded them has to be told to forget. Refusing has to cost the
	// document nothing and reach no watcher.
	const doc = board();
	const before = snapshot(doc);
	const heard: Change[] = [];
	observer(doc).watch((change) => heard.push(change));

	const stop = guard(doc, Board);

	assert.throws(() => atomic(() => {
		doc.title = 'a good title';
		doc.tasks!.push(createObject<Task>({ title: '', done: false }));
	}), RefusedError);

	assert.deepEqual(snapshot(doc), before);
	assert.deepEqual(heard, []);
	stop();
});

test('a commit that arrives is refused the same way one written here is', () => {
	// A rule that only covers local writes guards the one path an application controls anyway.
	// The commit that has to be refused is the one that came from somewhere else.
	const doc = board();
	const stop = guard(doc, Board);

	const copy = fromSnapshot(snapshot(doc)) as Board;
	const arriving = commitFrom(copy, () => { copy.title = ''; });

	const local = (() => {
		try { doc.title = ''; return undefined; } catch (error) { return error as RefusedError; }
	})();
	const remote = (() => {
		try { apply(doc, arriving); return undefined; } catch (error) { return error as RefusedError; }
	})();

	assert.ok(local instanceof RefusedError);
	assert.ok(remote instanceof RefusedError);
	assert.deepEqual(local.refusals, remote.refusals, 'one document, one rule, one message');
	assert.equal(doc.title, 'plan');
	stop();
});

test('a named field is required and an entry is not', () => {
	// Requiredness is a property of the description, not of the document: an object says which
	// slots it has and therefore which ones may go missing, while an array and a map say what
	// an element is and never how many there are. Treating the three alike makes removing the
	// last element of a list a refusal, which no application means.
	const doc = board();
	const person = createObject<Person>({ email: 'someone@example.com', nickname: 'sam' });
	(doc.people as { add(v: object): void }).add(person);
	doc.tasks!.push(createObject<Task>({ title: 'ship', done: false }));

	const stop = guard(doc, Board);

	delete person.nickname;
	assert.equal(person.nickname, undefined, 'a leaf that accepts nothing being there may go');

	assert.throws(() => { delete person.email; }, RefusedError, 'one that does not, may not');

	doc.tasks!.splice(0, 1);
	assert.equal(doc.tasks!.length, 0, 'and a list empties without complaint');

	(doc.people as { delete(k: string): boolean }).delete(textIdOf(person));
	stop();
});

test('a validator that answers later cannot decide a commit', () => {
	// A commit closes now. A rule that returns a promise would have to let the commit close and
	// refuse it afterwards, which is a rollback of something watchers have already seen. Saying
	// so by name at the first slot that does it beats discovering it as an accepted bad value.
	const doc = createObject<Record<string, unknown>>();
	const stop = guard(doc, shape({ title: later() }));

	assert.throws(
		() => { doc.title = 'anything'; },
		(error: Error & { reason?: string }) => error.reason === 'async-validator',
	);
	assert.equal(doc.title, undefined);
	stop();
});

/** The answer on the document before and after the commit has landed, which must agree. */
const judged = (form: Shape, doc: object, run: () => void): readonly Refusal[] => {
	const before = fromSnapshot(snapshot(doc));
	const commit = commitFrom(doc, run);
	const after = check(form, doc, commit);
	assert.deepEqual(check(form, before, commit), after, 'the answer must not depend on whether the commit has landed');
	return after;
};

test('an observable filed by alias is judged whole under the filing path, what it attaches included', () => {
	// The whole of it means its attached children too. Judging those where they live would
	// refuse a valid filing whenever the observable lives under a slot the shape does not
	// name, and would report a path the commit never touched.
	const Person = shape({ name: text({ min: 1 }), friend: shape({ name: text({ min: 1 }) }) });
	const Everything = shape({ people: table(Person) });
	const file = (friendName: string): readonly Refusal[] => {
		const friend = createObject<Record<string, unknown>>({ name: friendName });
		const person = createObject<Record<string, unknown>>({ name: 'ada', friend });
		const doc = createObject<Record<string, unknown>>({ people: createMap(), aside: person });
		return judged(Everything, doc, () => {
			(doc['people'] as ReturnType<typeof createMap<object>>).set(textIdOf(person), alias(person));
		});
	};

	assert.deepEqual(file('ok'), [], 'a valid person is filed though it lives under a slot the shape does not name');

	const refused = file('');
	assert.equal(refused.length, 1);
	assert.equal(refused[0]?.code, 'invalid');
	assert.deepEqual(refused[0]?.path?.slice(0, 1), ['people'], 'reported at the filing path');
	assert.deepEqual(refused[0]?.path?.slice(2), ['friend', 'name']);
});

test('an object landing with an alias inside it has the aliased thing judged under the landing path', () => {
	const Person = shape({ name: text({ min: 1 }), friend: shape({ name: text({ min: 1 }) }) });
	const Everything = shape({ people: table(Person) });
	const other = createObject<Record<string, unknown>>({ name: '' });
	const doc = createObject<Record<string, unknown>>({ people: createMap(), other });
	const person = createObject<Record<string, unknown>>({ name: 'bob', friend: alias(other) });

	const refused = judged(Everything, doc, () => {
		(doc['people'] as ReturnType<typeof createMap<object>>).set(textIdOf(person), person);
	});
	assert.equal(refused.length, 1);
	assert.equal(refused[0]?.code, 'invalid');
	assert.deepEqual(refused[0]?.path?.slice(2), ['friend', 'name'], 'under people, not at other');
	assert.equal(refused[0]?.path?.[0], 'people');
});

test('a list or a table landing whole has each element judged, so an invalid element refuses the landing', () => {
	const doc = board();
	const bad = createArray<Task>([{ title: 'fine', done: false }, { title: '', done: true }].map((t) => createObject<Task>(t)));

	const refused = judged(Board, doc, () => { doc.tasks = bad; });
	assert.equal(refused.length, 1, JSON.stringify(refused));
	assert.equal(refused[0]?.code, 'invalid');
	assert.equal(refused[0]?.path?.at(-1), 'title');

	const people = createMap<object>();
	people.set(textIdOf(createObject()), createObject({ email: 'no' }));
	const fresh = board();
	const wrong = judged(Board, fresh, () => { fresh.people = people; });
	assert.equal(wrong.length, 1, JSON.stringify(wrong));
	assert.equal(wrong[0]?.path?.at(-1), 'email');
});

test('a kind mismatch on what lands is answered the same whether or not the commit has landed', () => {
	// Before the commit lands the new observable is not in the document, so its kind can only
	// come from the commit; after, it can come from either. One answer, from the same source.
	const doc = board();
	const refused = judged(Board, doc, () => {
		doc.people = createArray([createObject({ email: 'a@b.c' })]);
	});
	assert.equal(refused.length, 2, JSON.stringify(refused));
	assert.ok(refused.every((r) => r.code === 'kind'));
	assert.deepEqual(refused.map((r) => r.path?.[0]), ['people', 'people']);
	assert.deepEqual(refused.map((r) => r.path?.length).sort(), [1, 2], 'the slot, and the element inside it');
});

test('an object moved to a new home takes the alias it holds with it, judged under the new path', () => {
	// The alias slot is not in the commit: it is a live row of the moved object, and the walk
	// over what lands has to read it as the alias it is, or the aliased thing is judged at
	// the path it lives at instead of the one the object is landing at.
	const Person = shape({ name: text({ min: 1 }), friend: shape({ name: text({ min: 1 }) }) });
	// The aliased thing lives under a slot of the same name at the root, where any name is fine,
	// so an alias mistaken for an attach edge by its slot name alone would be judged there.
	const Everything = shape({ drafts: table(Person), people: table(Person), friend: shape({ name: text() }) });
	const other = createObject<Record<string, unknown>>({ name: '' });
	const person = createObject<Record<string, unknown>>({ name: 'cy', friend: alias(other) });
	const drafts = createMap<object>();
	drafts.set(textIdOf(person), person);
	const doc = createObject<Record<string, unknown>>({ drafts, people: createMap(), friend: other });

	const refused = judged(Everything, doc, () => {
		atomic(() => {
			drafts.delete(textIdOf(person));
			(doc['people'] as ReturnType<typeof createMap<object>>).set(textIdOf(person), person);
		});
	});
	assert.equal(refused.length, 1, JSON.stringify(refused));
	assert.deepEqual(refused[0]?.path, ['people', textIdOf(person), 'friend', 'name']);
});
