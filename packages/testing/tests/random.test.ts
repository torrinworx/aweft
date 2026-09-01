// The seeded generator every property test in the stack draws from.

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '../src/random.ts';

test('one seed gives one stream, so a failure can be run again', () => {
	const a = randomFrom(20260901);
	const b = randomFrom(20260901);

	const first = Array.from({ length: 50 }, () => a());
	const second = Array.from({ length: 50 }, () => b());

	assert.deepEqual(first, second);
	assert.notDeepEqual(first, Array.from({ length: 50 }, randomFrom(20260902)));
});

test('the stream stays in range and does not settle on one value', () => {
	const next = randomFrom(7);
	const seen = new Set<number>();

	for (let i = 0; i < 5000; i++) {
		const v = next();
		assert.ok(v >= 0 && v < 1, `${v} is outside [0, 1)`);
		seen.add(v);
	}

	// A shift register that reaches zero stays there, which is the failure this guards.
	assert.ok(seen.size > 4900, `only ${seen.size} distinct values in 5000 draws`);
});

test('a zero seed still produces a stream rather than a stuck one', () => {
	const next = randomFrom(0);
	const values = new Set(Array.from({ length: 100 }, () => next()));
	assert.ok(values.size > 90, 'a zero seed collapsed the stream');
});

test('bounded draws cover their range and never reach the bound', () => {
	const next = randomFrom(20260901);
	const counts = new Array<number>(6).fill(0);

	for (let i = 0; i < 6000; i++) {
		const v = randomBelow(next, 6);
		assert.ok(Number.isInteger(v) && v >= 0 && v < 6, `${v} is not an index below 6`);
		counts[v]! += 1;
	}

	assert.ok(counts.every((c) => c > 0), `some value never came up: ${counts.join(',')}`);
});
