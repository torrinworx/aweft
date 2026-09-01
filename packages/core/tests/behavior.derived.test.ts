// The behavioral corpus for the value surface.
//
// Each case is a requirement this stack must meet, taken from a class of failure this problem
// domain is known to contain: transforms that throw, transforms that write, watchers that
// throw during a delivery, and chains that re-target what they follow. The corpus is
// append-only. Removing a case needs a design note, because each one is here for a
// reason someone paid for.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, mutable, observer } from '../src/index.ts';

interface Doc extends Record<string, unknown> {
	title?: string;
	n?: number;
}

test('a throwing transform poisons nothing: every read recomputes and rethrows', () => {
	const cell = mutable(1);
	let runs = 0;
	const risky = cell.map((v) => {
		runs += 1;
		if (v === 13) throw new Error('unlucky');
		return v * 2;
	});

	cell.set(13);
	assert.throws(() => risky.get(), /unlucky/);
	const after = runs;
	// The failure was not cached as if it were a value: the next read computes again.
	assert.throws(() => risky.get(), /unlucky/);
	assert.equal(runs, after + 1);

	cell.set(4);
	assert.equal(risky.get(), 8);
});

test('a transform throwing during delivery leaves the chain consistent after', () => {
	const cell = mutable(1);
	const seen: number[] = [];
	const risky = cell.map((v) => {
		if (v === 13) throw new Error('unlucky');
		return v * 2;
	});

	const stop = risky.watch((v) => seen.push(v));

	// The error reaches whoever made the write, once delivery has finished.
	assert.throws(() => cell.set(13), /unlucky/);

	// A read after the failure tries again and rethrows. Serving the value from before the
	// failure here would be a silently stale cache wearing a cache's clothes.
	assert.throws(() => risky.get(), /unlucky/);

	// The failed recompute was not recorded as done: the next change recomputes and delivers.
	cell.set(5);
	assert.deepEqual(seen, [10]);
	stop();
});

test('one watcher throwing does not decide whether the others hear the value', () => {
	const cell = mutable(1);
	const seen: number[] = [];
	const doubled = cell.map((v) => v * 2);

	const stopA = doubled.watch(() => {
		throw new Error('bad watcher');
	});
	const stopB = doubled.watch((v) => seen.push(v));

	assert.throws(() => cell.set(2), /bad watcher/);
	assert.deepEqual(seen, [4]);
	stopA();
	stopB();
});

test('a transform that writes its own source converges instead of recursing', () => {
	const doc = createObject<Doc>({ n: 5 });
	const scope = observer(doc).path('n');
	const seen: number[] = [];

	// Clamping is the honest version of this pattern: the transform pushes the source toward
	// a fixed point, and the fixed point ends the cascade.
	const clamped = scope.map((v) => {
		const n = Number(v);
		if (n > 10) scope.set(10);
		return Math.min(n, 10);
	});

	const stop = clamped.watch((v) => seen.push(v as number));
	doc.n = 50;

	assert.equal(doc.n, 10);
	assert.equal(clamped.get(), 10);
	stop();
});

test('unwrap lets go of the inner chain when the outer value stops being one', () => {
	const inner = mutable('a');
	const outer = mutable<unknown>(inner);
	const seen: unknown[] = [];

	const stop = outer.unwrap().watch((v) => seen.push(v));

	outer.set('plain');
	assert.deepEqual(seen, ['plain']);

	// The released inner chain no longer reaches this watcher.
	inner.set('b');
	assert.deepEqual(seen, ['plain']);
	stop();
});

test('a selection watcher throwing does not corrupt which key is selected', () => {
	const active = mutable<string | undefined>('a');
	const select = active.selector();
	const bSeen: boolean[] = [];

	const stopA = select('a').watch(() => {
		throw new Error('bad selection watcher');
	});
	const stopB = select('b').watch((v) => bSeen.push(v));

	assert.throws(() => active.set('b'), /bad selection watcher/);
	assert.deepEqual(bSeen, [true]);
	stopA();

	// The selector's own bookkeeping moved exactly once: the next move still flips this key.
	active.set('a');
	assert.deepEqual(bSeen, [true, false]);
	stopB();
});

test('an effect whose first call throws leaves no subscription behind', () => {
	const cell = mutable(1);
	const seen: number[] = [];

	assert.throws(() => cell.effect(() => {
		throw new Error('first call refuses');
	}), /first call refuses/);

	// The failed effect held no handle anyone could stop; the subscription must be gone.
	cell.watch((v) => seen.push(v));
	cell.set(2);
	assert.deepEqual(seen, [2]);

	const doc = createObject<Doc>({ title: 'a' });
	const scope = observer(doc).path('title');
	assert.throws(() => scope.effect(() => {
		throw new Error('scope first call refuses');
	}), /scope first call refuses/);

	let heard = 0;
	const stop = scope.watch(() => heard += 1);
	doc.title = 'b';
	stop();
	assert.equal(heard, 1, 'the leaked scope listener would make delivery run twice');
});

test('an effect that writes its scope during its initial call still unsubscribes cleanly', () => {
	const doc = createObject<Doc>({ title: 'raw' });
	const scope = observer(doc).path('title');
	const seen: unknown[] = [];

	const stop = scope.map((v) => v).effect((v) => {
		seen.push(v);
		if (v === 'raw') scope.set('cooked');
	});

	assert.deepEqual(seen, ['raw', 'cooked']);
	stop();

	doc.title = 'later';
	assert.deepEqual(seen, ['raw', 'cooked']);
});
