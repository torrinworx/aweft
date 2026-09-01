// Cells: reactive values outside the document (design 024).

import test from 'node:test';
import assert from 'node:assert/strict';

import { fromEvent, immutable, mutable, timer } from '../src/index.ts';

test('a cell reads, writes, and delivers synchronously outside a commit', () => {
	const cell = mutable(1);
	const seen: number[] = [];

	const stop = cell.watch((v) => seen.push(v));
	cell.set(2);
	assert.deepEqual(seen, [2]);
	assert.equal(cell.get(), 2);
	stop();
});

test('writing an equal value changes nothing and notifies nobody', () => {
	const cell = mutable(5);
	const seen: number[] = [];
	cell.watch((v) => seen.push(v));

	cell.set(5);
	assert.deepEqual(seen, []);
});

test('immutable wraps a constant that never delivers', () => {
	const label = immutable('fixed');
	const seen: unknown[] = [];

	assert.equal(label.get(), 'fixed');
	assert.equal(label.isImmutable(), true);
	assert.throws(() => label.set('other'), /read-only/);

	const stop = label.effect((v) => seen.push(v));
	assert.deepEqual(seen, ['fixed']);
	stop();
});

test('immutable over a cell keeps changes flowing and blocks writes', () => {
	const cell = mutable(1);
	const view = immutable(cell);
	const seen: number[] = [];

	view.watch((v) => seen.push(v));
	cell.set(2);

	assert.deepEqual(seen, [2]);
	assert.throws(() => view.set(3), /read-only/);
	assert.equal(cell.get(), 2);
});

test('timer ticks while observed and holds no interval when abandoned', (t) => {
	t.mock.timers.enable({ apis: ['setInterval'] });

	const ticks = timer(50);
	assert.equal(ticks.get(), 0);

	const seen: number[] = [];
	const stop = ticks.watch((v) => seen.push(v));
	t.mock.timers.tick(120);
	assert.deepEqual(seen, [1, 2]);

	stop();
	t.mock.timers.tick(200);
	assert.deepEqual(seen, [1, 2]);
});

test('fromEvent holds the last event and listens only while observed', () => {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	const target = {
		addEventListener: (type: string, fn: (event: unknown) => void) => {
			let set = listeners.get(type);
			if (set === undefined) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(fn);
		},
		removeEventListener: (type: string, fn: (event: unknown) => void) => {
			listeners.get(type)?.delete(fn);
		},
	};
	const fire = (type: string, event: unknown): void => {
		for (const fn of listeners.get(type) ?? []) fn(event);
	};

	const clicks = fromEvent(target, 'click');
	assert.equal(clicks.get(), undefined);
	assert.equal(listeners.get('click')?.size ?? 0, 0);

	const seen: unknown[] = [];
	const stop = clicks.watch((v) => seen.push(v));
	assert.equal(listeners.get('click')!.size, 1);

	fire('click', { x: 1 });
	assert.deepEqual(seen, [{ x: 1 }]);
	assert.deepEqual(clicks.get(), { x: 1 });

	stop();
	assert.equal(listeners.get('click')!.size, 0);
	fire('click', { x: 2 });
	assert.deepEqual(seen, [{ x: 1 }]);
});
