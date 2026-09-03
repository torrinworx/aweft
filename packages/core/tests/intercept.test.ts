// The seam a rule refuses a commit through: what it sees, and what a refusal costs.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	RefusedError, apply, atomic, createObject, idOf, intercept, observer, snapshot,
} from '../src/index.ts';
import type { Change, Commit, Refusal } from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	title?: string;
	width?: number;
	height?: number;
	child?: Record<string, unknown>;
}

const NO_REFUSAL: readonly Refusal[] = [];

const refusal = (message: string): readonly Refusal[] => [{ code: 'test', message }];

/** A commit addressed to a document by id, so `apply` has something real to land. */
const addTitle = (target: object, title: string): Commit => ({
	deltas: [{ type: 'add', id: idOf(target), ref: { kind: 'object', key: 'title' }, value: title }],
});

test('a rule sees a plain assignment, with nothing watching', () => {
	const doc = createObject<Doc>();
	const seen: Commit[] = [];

	intercept(doc, (commit) => {
		seen.push(commit);
		return NO_REFUSAL;
	});

	doc.title = 'a';

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 1);
	assert.equal(seen[0]!.deltas[0]!.type, 'add');
	assert.equal(seen[0]!.deltas[0]!.value, 'a');
});

test('a rule sees a block once, with everything it wrote', () => {
	const doc = createObject<Doc>({ title: 'a' });
	const seen: Commit[] = [];

	intercept(doc, (commit) => {
		seen.push(commit);
		return NO_REFUSAL;
	});

	atomic(() => {
		doc.width = 3;
		doc.height = 4;
		doc.title = 'b';
	});

	assert.equal(seen.length, 1, 'a block is one commit at the seam too');
	assert.equal(seen[0]!.deltas.length, 3);
});

test('a rule sees a commit that arrived through apply', () => {
	const doc = createObject<Doc>();
	const seen: Commit[] = [];

	intercept(doc, (commit) => {
		seen.push(commit);
		return NO_REFUSAL;
	});

	apply(doc, addTitle(doc, 'landed'));

	assert.equal(seen.length, 1);
	assert.equal(doc.title, 'landed');
	assert.equal(seen[0]!.deltas[0]!.value, 'landed');
});

test('a refusal throws a RefusedError carrying the refusals', () => {
	const doc = createObject<Doc>();
	intercept(doc, () => refusal('a title cannot be empty'));

	try {
		doc.title = '';
		assert.fail('the assignment should have thrown');
	} catch (error) {
		assert.ok(error instanceof RefusedError);
		assert.deepEqual(error.refusals, [{ code: 'test', message: 'a title cannot be empty' }]);
		assert.match(error.message, /a title cannot be empty/);
	}
});

test('a refusal leaves the document exactly as it was', () => {
	const doc = createObject<Doc>({ title: 'kept', child: createObject({ n: 1 }) });
	const before = snapshot(doc);

	intercept(doc, () => refusal('no'));

	assert.throws(() => { doc.title = 'lost'; }, RefusedError);
	assert.throws(() => {
		atomic(() => {
			doc.width = 3;
			doc.child = createObject({ n: 2 });
		});
	}, RefusedError);

	assert.equal(doc.title, 'kept');
	assert.equal(doc.width, undefined);
	assert.deepEqual(snapshot(doc), before, 'the whole document is back where it started');
});

test('a refusal delivers nothing to a watcher', () => {
	const doc = createObject<Doc>();
	const heard: Change[] = [];
	observer(doc).watch((change) => heard.push(change));

	const stop = intercept(doc, () => refusal('no'));

	assert.throws(() => { doc.title = 'a'; }, RefusedError);
	assert.equal(heard.length, 0, 'nothing may reach a watcher before the commit is allowed to close');

	stop();
	doc.title = 'a';
	assert.equal(heard.length, 1, 'and the next commit is delivered normally');
});

test('a refused commit that arrived through apply lands nothing', () => {
	const doc = createObject<Doc>();
	const heard: Change[] = [];
	observer(doc).watch((change) => heard.push(change));

	intercept(doc, () => refusal('no'));

	assert.throws(() => apply(doc, addTitle(doc, 'landed')), RefusedError);
	assert.equal(doc.title, undefined);
	assert.equal(heard.length, 0);
});

test('the unsubscribe stops the rule', () => {
	const doc = createObject<Doc>();
	let runs = 0;
	const stop = intercept(doc, () => {
		runs += 1;
		return NO_REFUSAL;
	});

	doc.title = 'a';
	stop();
	doc.title = 'b';

	assert.equal(runs, 1);
});

test('two rules both run, and their refusals concatenate in order', () => {
	const doc = createObject<Doc>();
	intercept(doc, () => refusal('first'));
	intercept(doc, () => refusal('second'));

	try {
		doc.title = 'a';
		assert.fail('the assignment should have thrown');
	} catch (error) {
		assert.ok(error instanceof RefusedError);
		assert.deepEqual(error.refusals.map((r) => r.message), ['first', 'second'],
			'the second rule runs even though the first already refused');
	}
});

test('one rule refusing and one accepting still refuses', () => {
	const doc = createObject<Doc>();
	let accepting = 0;
	intercept(doc, () => refusal('no'));
	intercept(doc, () => {
		accepting += 1;
		return NO_REFUSAL;
	});

	assert.throws(() => { doc.title = 'a'; }, RefusedError);
	assert.equal(accepting, 1);
});

test('a rule registered on a nested observable covers the whole document', () => {
	const child = createObject<Record<string, unknown>>({ n: 1 });
	const doc = createObject<Doc>({ child });

	const paths: string[] = [];
	intercept(child, (commit) => {
		for (const delta of commit.deltas) paths.push(String(delta.ref.key));
		return NO_REFUSAL;
	});

	doc.title = 'at the root';
	child.n = 2;

	assert.deepEqual(paths, ['title', 'n'], 'a rule is about a document, not about a subtree');
});

test('a rule on another document does not see this one', () => {
	const doc = createObject<Doc>();
	const other = createObject<Doc>();
	let runs = 0;

	intercept(other, () => {
		runs += 1;
		return NO_REFUSAL;
	});

	doc.title = 'a';
	assert.equal(runs, 0);

	other.title = 'a';
	assert.equal(runs, 1);
});

test('a rule that throws rolls the commit back, the way a refusal does', () => {
	const doc = createObject<Doc>({ title: 'kept' });
	const heard: Change[] = [];
	observer(doc).watch((change) => heard.push(change));

	intercept(doc, () => { throw new Error('the rule broke'); });

	assert.throws(() => { doc.title = 'lost'; }, /the rule broke/);
	assert.equal(doc.title, 'kept');
	assert.equal(heard.length, 0);
});

test('a write from inside a rule is refused', () => {
	const doc = createObject<Doc>();
	intercept(doc, () => {
		doc.width = 1;
		return NO_REFUSAL;
	});

	assert.throws(() => { doc.title = 'a'; }, /sealed/);
	assert.equal(doc.title, undefined);
	assert.equal(doc.width, undefined);

	// The seal lifts with the commit that raised it: an ordinary write still works afterwards.
	const other = createObject<Doc>();
	other.title = 'a';
	assert.equal(other.title, 'a');
});

test('intercept takes an observable', () => {
	assert.throws(() => intercept({}, () => NO_REFUSAL), /not-observable/);
});

test('a commit that changes nothing never reaches a rule', () => {
	const doc = createObject<Doc>({ title: 'a' });
	let runs = 0;
	intercept(doc, () => {
		runs += 1;
		return NO_REFUSAL;
	});

	doc.title = 'a';
	assert.equal(runs, 0, 'no delta, no commit, nothing to answer for');
});

test('a rule may register or remove rules while it runs, and the commit is judged by the rules that stood', () => {
	const doc = createObject<Doc>();
	const ran: string[] = [];
	let stopLate: (() => void) | undefined;

	// The first rule removes itself and registers another. The set it lives in changes under
	// the walk; neither the removed rule nor the new one may be run twice or skipped wrongly.
	let stopFirst: () => void = () => {};
	stopFirst = intercept(doc, () => {
		ran.push('first');
		stopFirst();
		stopLate = intercept(doc, () => { ran.push('late'); return NO_REFUSAL; });
		return NO_REFUSAL;
	});
	const stopSecond = intercept(doc, () => { ran.push('second'); return NO_REFUSAL; });

	doc.title = 'one';
	assert.deepEqual(ran, ['first', 'second'], 'the rule added during the walk waits for the next commit');

	ran.length = 0;
	doc.title = 'two';
	assert.deepEqual(ran, ['second', 'late'], 'the removed rule is gone and the added one runs now');

	stopSecond();
	stopLate?.();
	ran.length = 0;
	doc.title = 'three';
	assert.deepEqual(ran, []);
});
