// A mutable array: a list outside the document (design 081).

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '@aweftjs/testing';

import {
	type ArrayChange, createArray, createObject, immutable, isMutableArray, mutableArray,
} from '../src/index.ts';

const reason = (name: string) => (e: Error & { reason?: string }): boolean => e.reason === name;

/** Apply a change list to a plain array, the way a consumer would. */
const applyAll = <T>(mirror: T[], changes: readonly ArrayChange<T>[]): void => {
	for (const change of changes) {
		if (change.type === 'add') mirror.splice(change.at, 0, change.value);
		else if (change.type === 'replace') mirror[change.at] = change.value;
		else mirror.splice(change.at, 1);
	}
};

test('it reads as an array and holds anything', () => {
	const fn = () => 1;
	const node = { tag: 'div' };
	const list = mutableArray<unknown>(['a', fn, node]);

	assert.ok(Array.isArray(list));
	assert.equal(list.length, 3);
	assert.equal(list[1], fn);
	assert.deepEqual([...list], ['a', fn, node]);
	assert.deepEqual(list.map((x) => typeof x), ['string', 'function', 'object']);
	assert.equal(list.indexOf(node), 2);
});

test('every mutator delivers the changes of that one call, in order', () => {
	const list = mutableArray<number>([1, 2, 3]);
	const seen: (readonly ArrayChange<number>[])[] = [];
	list.watch((changes) => seen.push(changes));

	list.push(4, 5);
	assert.deepEqual(seen.pop(), [{ type: 'add', at: 3, value: 4 }, { type: 'add', at: 4, value: 5 }]);

	assert.equal(list.pop(), 5);
	assert.deepEqual(seen.pop(), [{ type: 'remove', at: 4 }]);

	assert.equal(list.shift(), 1);
	assert.deepEqual(seen.pop(), [{ type: 'remove', at: 0 }]);

	list.unshift(0);
	assert.deepEqual(seen.pop(), [{ type: 'add', at: 0, value: 0 }]);

	// [0, 2, 3, 4]: a splice says its removes and then its adds, at the indices they land on.
	assert.deepEqual(list.splice(1, 3, 7, 8), [2, 3, 4]);
	assert.deepEqual(seen.pop(), [
		{ type: 'remove', at: 1 }, { type: 'remove', at: 1 }, { type: 'remove', at: 1 },
		{ type: 'add', at: 1, value: 7 }, { type: 'add', at: 2, value: 8 },
	]);
	assert.deepEqual([...list], [0, 7, 8]);
	assert.deepEqual(list.splice(1, 1, 9), [7]);
	assert.deepEqual(seen.pop(), [{ type: 'replace', at: 1, value: 9 }], 'one for one is a replace');
	list.splice(1, 1, 8);
	seen.pop();

	list[1] = 9;
	assert.deepEqual(seen.pop(), [{ type: 'replace', at: 1, value: 9 }]);

	list[3] = 10;
	assert.deepEqual(seen.pop(), [{ type: 'add', at: 3, value: 10 }]);

	list.length = 1;
	assert.deepEqual(seen.pop(), [{ type: 'remove', at: 1 }, { type: 'remove', at: 1 }, { type: 'remove', at: 1 }]);
	assert.deepEqual([...list], [0]);
	assert.equal(seen.length, 0, 'every call delivered exactly once');
});

test('a mirror applying the changes stays equal to the list under random editing', () => {
	for (const seed of [7, 20260904]) {
		const next = randomFrom(seed);
		const list = mutableArray<number>();
		const mirror: number[] = [];
		list.watch((changes) => applyAll(mirror, changes));

		for (let step = 0; step < 300; step++) {
			const roll = randomBelow(next, 6);
			const at = list.length === 0 ? 0 : randomBelow(next, list.length + 1);
			if (roll === 0 || list.length === 0) list.push(step);
			else if (roll === 1) list.splice(at, 0, step);
			else if (roll === 2) list.splice(Math.min(at, list.length - 1), randomBelow(next, 3), step, step + 1);
			else if (roll === 3) list[Math.min(at, list.length - 1)] = step;
			else if (roll === 4) list.pop();
			else list.unshift(step);

			assert.deepEqual(mirror, [...list], `seed ${seed} step ${step}`);
		}
	}
});

test('an equal value assigned changes nothing and delivers nothing', () => {
	const list = mutableArray<number>([1]);
	let calls = 0;
	list.watch(() => { calls += 1; });

	list[0] = 1;
	list.splice(0, 1, 1);
	assert.equal(calls, 0);
});

test('gaps, growth by length and deletion are refused, as on a document array', () => {
	const list = mutableArray<number>([1]);
	assert.throws(() => { list[5] = 1; }, reason('invalid-write'));
	assert.throws(() => { list.length = 4; }, reason('invalid-write'));
	assert.throws(() => { delete list[0]; }, reason('invalid-write'));
	assert.throws(() => { (list as unknown as Record<string, unknown>)['x'] = 1; }, reason('invalid-key'));
	assert.throws(() => list.sort(), reason('unsupported'));
	assert.throws(() => list.reverse(), reason('unsupported'));
	assert.throws(() => list.fill(0), reason('unsupported'));
	assert.throws(() => list.copyWithin(0, 0), reason('unsupported'));
	assert.deepEqual([...list], [1]);
});

test('watch returns its unsubscribe, and a second watcher hears too', () => {
	const list = mutableArray<number>();
	let a = 0;
	let b = 0;
	const stop = list.watch(() => { a += 1; });
	list.watch(() => { b += 1; });

	list.push(1);
	stop();
	stop();
	list.push(2);

	assert.equal(a, 1);
	assert.equal(b, 2);
});

test('a watcher that throws does not stop the others, and the error reaches the caller', () => {
	const list = mutableArray<number>();
	let heard = 0;
	list.watch(() => { throw new Error('first'); });
	list.watch(() => { heard += 1; });

	assert.throws(() => list.push(1), /first/);
	assert.equal(heard, 1);
	assert.deepEqual([...list], [1], 'the edit itself stands');
});

test('an edit made from inside a watcher is delivered after the current one, never nested', () => {
	const list = mutableArray<number>();
	const order: string[] = [];
	list.watch((changes) => {
		order.push(`saw ${changes.map((c) => c.type).join(',')} at ${list.length}`);
		if (list.length === 1) list.push(2);
		order.push('done');
	});

	list.push(1);
	assert.deepEqual(order, ['saw add at 1', 'done', 'saw add at 2', 'done']);
});

test('it is a cell: refused in a document, readable through immutable', () => {
	const list = mutableArray<number>([1]);
	const doc = createObject<Record<string, unknown>>();
	assert.throws(() => { doc.items = list; }, reason('cell-in-document'));

	const view = immutable(list);
	assert.equal(view.get(), list);
	assert.equal(view.isImmutable(), true);
});

test('isMutableArray tells it apart from a document array and a plain array', () => {
	assert.equal(isMutableArray(mutableArray()), true);
	assert.equal(isMutableArray(createArray()), false);
	assert.equal(isMutableArray([]), false);
	assert.equal(isMutableArray(null), false);
	assert.equal(isMutableArray('list'), false);
});
