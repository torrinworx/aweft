// The behavioral corpus for core.
//
// Each case is a requirement this stack must meet, taken from a class of failure this problem
// domain is known to contain: reentrancy during delivery, listeners that change the listener
// set while it is being walked, removing the same thing twice, and reading state from inside a
// callback. The corpus is append-only. Removing a case needs a design note, because each
// one is here for a reason someone paid for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createArray, createObject, observer, snapshot } from '../src/index.ts';
import type { Change } from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	a?: number;
	b?: number;
	held?: Record<string, unknown>;
	list?: number[];
}

test('a listener that mutates does not reenter the delivery it is inside', () => {
	const doc = createObject<Doc>();
	const order: string[] = [];

	observer(doc).watch((change) => {
		order.push(`first ${change.deltas.length}`);
		if (doc.b === undefined) doc.b = 1;
	});
	observer(doc).watch(() => order.push('second'));

	doc.a = 1;

	assert.deepEqual(order, ['first 1', 'second', 'first 1', 'second'],
		'both listeners hear the first commit before either hears the one made inside it');
});

test('a listener added during delivery does not hear the commit already in flight', () => {
	const doc = createObject<Doc>();
	const late: Change[] = [];

	observer(doc).watch(() => {
		observer(doc).watch((change) => late.push(change));
	});

	doc.a = 1;
	assert.equal(late.length, 0);

	doc.b = 2;
	assert.ok(late.length >= 1, 'and hears the next one');
});

test('a listener removed during delivery stops, and the one in flight still completes', () => {
	const doc = createObject<Doc>();
	const seen: string[] = [];

	const stop = observer(doc).watch(() => seen.push('second'));
	observer(doc).watch(() => {
		seen.push('first');
		stop();
	});

	doc.a = 1;
	doc.b = 2;

	assert.deepEqual(seen, ['second', 'first', 'first'],
		'the removed listener heard the commit that was already being delivered, and no later one');
});

test('a listener that throws does not decide whether the others hear the commit', () => {
	const doc = createObject<Doc>();
	const seen: string[] = [];

	observer(doc).watch(() => { throw new Error('listener'); });
	observer(doc).watch(() => seen.push('heard'));

	assert.throws(() => { doc.a = 1; }, /listener/);
	assert.deepEqual(seen, ['heard']);
	assert.equal(doc.a, 1, 'the mutation itself stands; only the listener failed');
});

test('a listener reads the state the commit produced, not the one before it', () => {
	const doc = createObject<Doc>({ a: 1 });
	const read: unknown[] = [];

	observer(doc).watch(() => read.push(doc.a));
	doc.a = 2;

	assert.deepEqual(read, [2]);
});

test('removing the same thing twice is not an error and is not a second commit', () => {
	const doc = createObject<Doc>({ a: 1, list: createArray<number>([1]) });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));

	delete doc.a;
	delete doc.a;
	assert.equal(seen.length, 1);

	assert.equal(doc.list!.pop(), 1);
	assert.equal(doc.list!.pop(), undefined);
	assert.equal(doc.list!.shift(), undefined);
	assert.deepEqual(doc.list!.splice(3, 2), []);
	assert.equal(seen.length, 2, 'only the pop that removed something was a commit');
});

test('a watcher hears the removal of the subtree it was watching', () => {
	const doc = createObject<Doc>({ held: createObject<Record<string, unknown>>({ x: 1 }) });
	const seen: Change[] = [];
	observer(doc).path('held').watch((change) => seen.push(change));

	delete doc.held;

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas[0]!.type, 'remove');
});

test('a delta written into a subtree being detached still reaches the root', () => {
	const doc = createObject<Doc>({ held: createObject<Record<string, unknown>>({ x: 1 }) });
	const seen: Change[] = [];
	observer(doc).watch((change) => seen.push(change));
	const held = doc.held!;

	// The format allows writing into a subtree in the same commit that detaches it, so a
	// receiver will apply both deltas. A watcher on the root that heard only the detach would
	// send half the commit, and the two documents would drift apart with nothing to notice it.
	atomic(() => {
		delete held.x;
		delete doc.held;
	});

	assert.equal(seen.length, 1);
	assert.equal(seen[0]!.deltas.length, 2, 'the removed slot and the removed edge');
	assert.equal(seen[0]!.inverse().deltas.length, 2, 'and both come back on undo');
});

test('a commit is delivered whole, so no listener sees half of it', () => {
	const doc = createObject<Doc>({ a: 1, b: 1 });
	const torn: string[] = [];

	// The invariant is that a and b are equal. A listener that sees the state mid-commit would
	// catch them apart, which is what commit delivery exists to prevent.
	observer(doc).watch(() => {
		if (doc.a !== doc.b) torn.push(`${String(doc.a)} ${String(doc.b)}`);
	});

	atomic(() => {
		doc.a = 2;
		doc.b = 2;
	});

	assert.deepEqual(torn, []);
});

test('the same invariant breaks without a block, which is the honest reading of two commits', () => {
	const doc = createObject<Doc>({ a: 1, b: 1 });
	const torn: string[] = [];

	observer(doc).watch(() => {
		if (doc.a !== doc.b) torn.push(`${String(doc.a)} ${String(doc.b)}`);
	});

	doc.a = 2;
	doc.b = 2;

	assert.deepEqual(torn, ['2 1'], 'two assignments outside a block are two commits');
});

test('a document that was never watched still reads back as itself', () => {
	const doc = createObject<Doc>({ a: 1 });
	doc.b = 2;
	doc.list = createArray<number>([1, 2]);
	doc.list.push(3);

	assert.deepEqual(snapshot(doc).observables[snapshot(doc).root]?.slots.b, 2);
	assert.deepEqual([...doc.list], [1, 2, 3]);
});
