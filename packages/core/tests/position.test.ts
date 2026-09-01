// Array positions, exercised through the array rather than reached into.
//
// A position is chosen, never derived, so the property that matters is not which bytes come
// out but that there is always room between two of them and that the order they compare in is
// the order the array reads in. That is a property test, seeded so a failure is repeatable.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compareBytes } from '@aweftjs/codec';
import { randomFrom } from '@aweftjs/testing';

import { createArray, positionsOf } from '../src/index.ts';

const check = (list: number[], mirror: number[], seed: number, step: number): void => {
	const positions = positionsOf(list);

	for (const position of positions) {
		assert.ok(position.length > 0, `seed ${seed} step ${step}: a position is never empty`);
		assert.notEqual(
			position[position.length - 1], 0,
			`seed ${seed} step ${step}: a position never ends in a zero byte`,
		);
	}

	for (let i = 1; i < positions.length; i++) {
		assert.equal(
			compareBytes(positions[i - 1]!, positions[i]!), -1,
			`seed ${seed} step ${step}: positions are strictly ascending`,
		);
	}

	assert.deepEqual([...list], mirror, `seed ${seed} step ${step}: the array reads in position order`);
};

for (const seed of [1, 20260831, 0x5f3759df]) {
	test(`positions hold their order under random editing, seed ${seed}`, () => {
		const next = randomFrom(seed);
		const list = createArray<number>();
		const mirror: number[] = [];

		for (let step = 0; step < 200; step++) {
			const at = mirror.length === 0 ? 0 : Math.floor(next() * (mirror.length + 1));
			const roll = next();

			if (roll < 0.55 || mirror.length === 0) {
				list.splice(at, 0, step);
				mirror.splice(at, 0, step);
			} else if (roll < 0.85) {
				const from = Math.min(at, mirror.length - 1);
				list.splice(from, 1);
				mirror.splice(from, 1);
			} else {
				const from = Math.min(at, mirror.length - 1);
				list[from] = step;
				mirror[from] = step;
			}

			check(list, mirror, seed, step);
		}

		assert.ok(mirror.length > 10, `seed ${seed}: the run should leave something behind`);
	});
}

test('inserting between the same pair over and over keeps working', () => {
	const list = createArray<number>([0, 1]);

	// The rule that a position never ends in a zero byte is what keeps this from running out of
	// room: without it there is a pair with nothing between them, and the array stops growing.
	for (let i = 0; i < 500; i++) list.splice(1, 0, i);

	const positions = positionsOf(list);
	for (let i = 1; i < positions.length; i++) {
		assert.equal(compareBytes(positions[i - 1]!, positions[i]!), -1);
	}

	assert.equal(list.length, 502);
	assert.equal(list[0], 0);
	assert.equal(list[501], 1);

	// Choosing the middle of a gap costs a byte of key every eight inserts at one spot, in
	// either direction. Measured: 500 inserts between one pair reach 64 bytes. Appending is far
	// cheaper, a byte every 127. This bound is here so a change to the chooser has to say what
	// it did to that rate.
	const longest = Math.max(...positions.map((p) => p.length));
	assert.ok(longest <= 64, `a position grew to ${longest} bytes over 500 inserts at one place`);
	assert.ok(longest >= 60, `a position reached ${longest} bytes, so the chooser changed`);
});

const valid = (list: number[], what: string): void => {
	const positions = positionsOf(list);

	for (const position of positions) {
		assert.ok(position.length > 0, `${what}: a position is never empty`);
		assert.notEqual(position[position.length - 1], 0, `${what}: a position never ends in a zero byte`);
	}
	for (let i = 1; i < positions.length; i++) {
		assert.equal(compareBytes(positions[i - 1]!, positions[i]!), -1, `${what}: still ascending`);
	}
};

test('appending past the end of a digit keeps the keys valid and ordered', () => {
	const list = createArray<number>();

	// Appending walks the last byte upward, so somewhere past 127 pushes it runs out of digit
	// and has to go deeper. That is the case where a careless choice ends a key in a zero byte,
	// which would leave a pair of elements with no room between them.
	for (let i = 0; i < 400; i++) list.push(i);

	valid(list, 'after 400 appends');
	assert.deepEqual([...list], Array.from({ length: 400 }, (_, i) => i));

	list.splice(200, 0, -1);
	valid(list, 'after inserting into the middle of them');
	assert.equal(list[200], -1);
});

test('inserting at the front over and over keeps the keys valid and ordered', () => {
	const list = createArray<number>([0]);

	for (let i = 0; i < 400; i++) list.unshift(i);

	valid(list, 'after 400 inserts at the front');
	assert.equal(list[0], 399);
	assert.equal(list[400], 0);
});
