// Per-key selection (design 028).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, mutable, observer } from '../src/index.ts';

test('a selection change flips exactly the two keys it moved between', () => {
	const active = mutable<string | undefined>('a');
	const select = active.selector();

	const heard = new Map<string, boolean[]>();
	const stops: Array<() => void> = [];
	for (const key of ['a', 'b', 'c', 'd']) {
		const seen: boolean[] = [];
		heard.set(key, seen);
		stops.push(select(key).watch((v) => seen.push(v)));
	}

	active.set('c');

	assert.deepEqual(heard.get('a'), [false]);
	assert.deepEqual(heard.get('c'), [true]);
	// The keys the selection did not move between hear nothing at all.
	assert.deepEqual(heard.get('b'), []);
	assert.deepEqual(heard.get('d'), []);

	for (const stop of stops) stop();
});

test('a key the selection did not move between is not even recomputed', () => {
	const active = mutable<string | undefined>('a');
	const select = active.selector();
	let runs = 0;

	const stops = [
		select('a').watch(() => undefined),
		select('b').watch(() => undefined),
		select('d').map((v) => {
			runs += 1;
			return v;
		}).watch(() => undefined),
	];
	const warm = runs;

	active.set('b');
	assert.equal(runs, warm, 'the unflipped key was poked into recomputing');
	for (const stop of stops) stop();
});

test('reading asks whether this key is the selected one', () => {
	const active = mutable<string | undefined>('x');
	const select = active.selector();

	assert.equal(select('x').get(), true);
	assert.equal(select('y').get(), false);
});

test('set(true) selects the key; set(false) clears only the selected one', () => {
	const active = mutable<string | undefined>('a');
	const select = active.selector();

	select('b').set(true);
	assert.equal(active.get(), 'b');

	// Clearing a key that is not selected does nothing.
	select('a').set(false);
	assert.equal(active.get(), 'b');

	select('b').set(false);
	assert.equal(active.get(), undefined);
});

test('a selector over a read-only chain is read-only', () => {
	const active = mutable('a');
	const select = active.map((v) => v).selector();

	assert.equal(select('a').get(), true);
	assert.equal(select('a').isImmutable(), true);
	assert.throws(() => select('a').set(true), /read-only/);
});

test('a selector works over a document scope', () => {
	const doc = createObject<{ chosen?: string }>({ chosen: 'one' });
	const select = observer(doc).path('chosen').selector();

	const seen: boolean[] = [];
	const stop = select('two').watch((v) => seen.push(v));

	doc.chosen = 'two';
	assert.deepEqual(seen, [true]);

	select('one').set(true);
	assert.equal(doc.chosen, 'one');
	assert.deepEqual(seen, [true, false]);
	stop();
});

test('a custom comparison decides what selected means', () => {
	const active = mutable({ id: 7 });
	const select = active.selector((value, key) => (value as { id: number }).id === key);

	assert.equal(select(7).get(), true);
	assert.equal(select(8).get(), false);
});

test('the last key letting go releases the one upstream subscription', () => {
	const active = mutable('a');
	const select = active.selector();

	const stop = select('a').watch(() => undefined);
	stop();
	stop();

	// A fresh subscription still works after everything was released.
	const seen: boolean[] = [];
	const again = select('b').watch((v) => seen.push(v));
	active.set('b');
	assert.deepEqual(seen, [true]);
	again();
});
