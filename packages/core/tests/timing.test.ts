// Rate limiting on the value surface (design 026).

import test from 'node:test';
import assert from 'node:assert/strict';

import { mutable } from '../src/index.ts';

test('throttle delivers the first change now and the last at the window end', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const cell = mutable(0);
	const seen: number[] = [];
	const stop = cell.throttle(100).watch((v) => seen.push(v));

	cell.set(1);
	assert.deepEqual(seen, [1]);

	cell.set(2);
	cell.set(3);
	assert.deepEqual(seen, [1]);

	t.mock.timers.tick(100);
	assert.deepEqual(seen, [1, 3]);
	stop();
});

test('throttle under continuous change still delivers once per window', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const cell = mutable(0);
	const seen: number[] = [];
	const stop = cell.throttle(100).watch((v) => seen.push(v));

	// A change every 40ms for 400ms. A sliding window would starve and deliver nothing.
	for (let i = 1; i <= 10; i++) {
		cell.set(i);
		t.mock.timers.tick(40);
	}

	assert.equal(seen[0], 1);
	assert.ok(seen.length >= 4, `expected roughly one delivery per window, saw ${seen.length}`);
	stop();
});

test('wait delivers once, after the changes stop', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const cell = mutable('');
	const seen: string[] = [];
	const stop = cell.wait(100).watch((v) => seen.push(v));

	cell.set('a');
	t.mock.timers.tick(50);
	cell.set('ab');
	t.mock.timers.tick(50);
	cell.set('abc');
	assert.deepEqual(seen, []);

	t.mock.timers.tick(100);
	assert.deepEqual(seen, ['abc']);
	stop();
});

test('reads are never delayed, only delivery', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const cell = mutable(1);
	const throttled = cell.throttle(1000);
	const waited = cell.wait(1000);

	cell.set(2);
	assert.equal(throttled.get(), 2);
	assert.equal(waited.get(), 2);
});

test('unsubscribing clears the pending timer', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const cell = mutable(0);
	const seen: number[] = [];
	const stop = cell.wait(100).watch((v) => seen.push(v));

	cell.set(1);
	stop();
	t.mock.timers.tick(500);
	assert.deepEqual(seen, []);
});

test('two watchers of one throttled chain are gated independently', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });

	const cell = mutable(0);
	const throttled = cell.throttle(100);
	const first: number[] = [];
	const second: number[] = [];

	const stopFirst = throttled.watch((v) => first.push(v));
	cell.set(1);

	// The second watcher arrives mid-window and still gets its own leading delivery.
	const stopSecond = throttled.watch((v) => second.push(v));
	cell.set(2);

	assert.deepEqual(first, [1]);
	assert.deepEqual(second, [2]);
	stopFirst();
	stopSecond();
});
