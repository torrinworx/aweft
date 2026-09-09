// A mutable array: a list outside the document (design 081).

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '@aweftjs/testing';

import {
	type ArrayChange, atomic, createArray, createObject, immutable, isMutableArray, mutable,
	mutableArray, observer,
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

// --- atomic holds the deliveries (design 087) ---------------------------------------------

test('a block delivers once, with every call in it, in call order', () => {
	const rows = mutableArray(['a', 'b', 'c']);
	const heard: ArrayChange<string>[][] = [];
	rows.watch((changes) => heard.push([...changes]));

	atomic(() => {
		const t = rows[0]!;
		rows[0] = rows[2]!;
		rows[2] = t;
	});

	assert.equal(heard.length, 1, 'one delivery, not one per assignment');
	assert.deepEqual(heard[0], [
		{ type: 'replace', at: 0, value: 'c' },
		{ type: 'replace', at: 2, value: 'a' },
	]);
	assert.deepEqual([...rows], ['c', 'b', 'a']);

	// Outside a block nothing changed: one call is one delivery.
	heard.length = 0;
	rows.push('d');
	rows.push('e');
	assert.equal(heard.length, 2);
});

test('a nested block closes with the outer one, and the mirror still tracks', () => {
	const rows = mutableArray(['a', 'b']);
	const mirror = ['a', 'b'];
	const heard: ArrayChange<string>[][] = [];
	rows.watch((changes) => { heard.push([...changes]); applyAll(mirror, changes); });

	atomic(() => {
		rows.push('c');
		atomic(() => { rows.unshift('z'); });
		rows.splice(1, 1);
	});

	assert.equal(heard.length, 1);
	assert.deepEqual(mirror, [...rows], 'the changes replay in the order the calls were made');
	assert.deepEqual([...rows], ['z', 'b', 'c']);
});

test('a block that throws still tells the list what it did', () => {
	const rows = mutableArray<string>([]);
	const heard: ArrayChange<string>[][] = [];
	rows.watch((changes) => heard.push([...changes]));

	assert.throws(() => atomic(() => {
		rows.push('a');
		throw new Error('give up');
	}), /give up/);

	// Nothing rolls the list back, so a watcher that heard nothing would describe a list that
	// does not exist.
	assert.deepEqual([...rows], ['a']);
	assert.equal(heard.length, 1);
	assert.deepEqual(heard[0], [{ type: 'add', at: 0, value: 'a' }]);
});

test('a watcher that throws while a failed block tells it does not replace the block error', () => {
	const rows = mutableArray<string>([]);
	rows.watch(() => { throw new Error('watcher'); });

	assert.throws(() => atomic(() => {
		rows.push('a');
		throw new Error('give up');
	}), /give up/);
});

test('a document commit in the same block is delivered before the list changes', () => {
	const doc = createObject<Record<string, unknown>>({ title: 'a' });
	const rows = mutableArray<string>([]);
	const order: string[] = [];

	observer(doc).watch(() => order.push('commit'));
	rows.watch(() => order.push('list'));

	atomic(() => {
		rows.push('x');
		doc['title'] = 'b';
	});

	assert.deepEqual(order, ['commit', 'list']);
});

test('a plain cell notifies inside the block, so a live derived reads its own write', () => {
	const count = mutable(1);
	const doubled = count.map((v) => v * 2);
	const seen: number[] = [];
	doubled.effect((v) => seen.push(v));

	atomic(() => {
		count.set(2);
		// A cell has no delivery beside its mark, so holding the mark would make this read the
		// value the block just overwrote (design 087, and design 015's own rule).
		assert.equal(doubled.get(), 4);
	});

	assert.deepEqual(seen, [2, 4]);
});

test('two lists edited in one block are told in the order the calls were made', () => {
	const first = mutableArray<string>([]);
	const second = mutableArray<string>([]);
	const order: string[] = [];
	first.watch(() => order.push('first'));
	second.watch(() => order.push('second'));

	atomic(() => {
		second.push('1');
		first.push('2');
	});

	assert.deepEqual(order, ['second', 'first']);
});

test('a watcher that unsubscribes inside a block is not told what the block did', () => {
	const rows = mutableArray<string>([]);
	const heard: ArrayChange<string>[][] = [];
	const off = rows.watch((changes) => heard.push([...changes]));

	atomic(() => {
		rows.push('a');
		off();
		rows.push('b');
	});

	assert.deepEqual(heard, [], 'unsubscribing works inside a block as it does outside one');
});

test('a watcher that subscribes inside a block hears only what came after it', () => {
	const rows = mutableArray<string>([]);
	const heard: ArrayChange<string>[][] = [];
	// Someone is already listening, so the block starts collecting at its first change.
	rows.watch(() => {});

	atomic(() => {
		rows.push('a');
		rows.push('b');
		rows.watch((changes) => heard.push([...changes]));
		rows.push('c');
		rows.push('d');
	});

	assert.equal(heard.length, 1);
	assert.deepEqual(heard[0], [
		{ type: 'add', at: 2, value: 'c' },
		{ type: 'add', at: 3, value: 'd' },
	]);
});

test('a mirror built from a mid-block subscription matches the list at the close', () => {
	const rows = mutableArray<string>(['seed']);
	let mirror: string[] = [];
	rows.watch(() => {});

	atomic(() => {
		rows.push('a');
		// A consumer reads the list when it subscribes, so its mirror starts there and the
		// changes it is told have to carry it the rest of the way.
		mirror = [...rows];
		rows.watch((changes) => applyAll(mirror, changes));
		rows.push('b');
		rows.push('c');
	});

	assert.deepEqual(mirror, [...rows]);
	assert.deepEqual(mirror, ['seed', 'a', 'b', 'c']);
});

test('derive answers the whole list and recomputes on every kind of edit', () => {
	const rows = mutableArray<string>(['a']);
	const empty = rows.derive((items) => items.length === 0);
	const joined = rows.derive((items) => items.join(','));
	const seen: boolean[] = [];
	const stop = empty.effect((value) => seen.push(value));

	assert.equal(joined.get(), 'a');
	rows.push('b');
	assert.equal(joined.get(), 'a,b');
	rows[0] = 'z';
	assert.equal(joined.get(), 'z,b');
	rows.splice(0, 1);
	assert.equal(joined.get(), 'b');
	rows.length = 0;
	assert.equal(joined.get(), '');

	// Only the answers that changed: filling and emptying, not every edit on the way.
	assert.deepEqual(seen, [false, true]);
	stop();
	rows.push('c');
	assert.deepEqual(seen, [false, true]);
	assert.equal(empty.get(), false);
});

test('derive settles inside a block, as a cell does, while watch waits for the close', () => {
	const rows = mutableArray<string>([]);
	let runs = 0;
	const size = rows.derive((items) => { runs += 1; return items.length; });
	const seen: string[] = [];
	size.effect((value) => seen.push(`size ${value}`));
	rows.watch(() => seen.push('edits'));
	runs = 0;

	atomic(() => {
		rows.push('a');
		seen.push('mid block');
		rows.push('b');
		// The mark is not held, so a derived value inside the block reads the list as it is.
		assert.equal(size.get(), 2);
	});

	// One recompute per edit, each settled where it happened; the edit list arrives once, at the
	// close, which is design 087 and is the list's own delivery rather than this one.
	assert.deepEqual(seen, ['size 0', 'size 1', 'mid block', 'size 2', 'edits']);
	assert.equal(runs, 2);
});

test('derive with nothing watching is computed on the read, and each one hears its own answer', () => {
	const rows = mutableArray<number>([1, 2]);
	const total = rows.derive((items) => items.reduce((sum, n) => sum + n, 0));
	assert.equal(total.get(), 3);
	rows.push(4);
	assert.equal(total.get(), 7);

	const evens = rows.derive((items) => items.filter((n) => n % 2 === 0).length);
	const totals: number[] = [];
	const evenCounts: number[] = [];
	total.effect((value) => totals.push(value));
	evens.effect((value) => evenCounts.push(value));
	rows.push(3);
	assert.deepEqual(totals, [7, 10]);
	assert.deepEqual(evenCounts, [2], 'the value now, and nothing for an answer that did not change');
	assert.equal(total.isImmutable(), true);
});
