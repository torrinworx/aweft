// Array positions, exercised through the array rather than reached into.
//
// A position is chosen, never derived, so the property that matters is not which bytes come
// out but that there is always room between two of them and that the order they compare in is
// the order the array reads in. That is a property test, seeded so a failure is repeatable.

import test from 'node:test';
import assert from 'node:assert/strict';

import { compareBytes } from '@aweftjs/codec';
import { randomFrom } from '@aweftjs/testing';

import { createArray, insertAt, positionsOf } from '../src/index.ts';

const hex = (bytes: Uint8Array): string =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

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

	// A position is four-byte levels: a digit and three random bytes. Inserting at one spot
	// halves the digit's room, so it costs a level every eight inserts and then steps a digit
	// at a time down the next one. Measured: 500 inserts between one pair reach 20 bytes,
	// against 64 for the byte-per-level chooser this replaced. This bound is here so a change
	// to the chooser has to say what it did to that rate.
	const longest = Math.max(...positions.map((p) => p.length));
	assert.ok(longest <= 24, `a position grew to ${longest} bytes over 500 inserts at one place`);
	assert.ok(longest >= 16, `a position reached ${longest} bytes, so the chooser changed`);
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

// The reason a position carries randomness at all. Two replicas hold two copies of one array,
// with the same keys in it, and each inserts at the same place. A chooser that is a pure
// function of the neighbours names one slot twice, and whichever commit reaches the host
// second is refused: two people adding to a list at the same moment lose one of the two.
// Design 040.

/** A second array holding exactly the keys the first one holds, the way a replica does. */
const replicaOf = (list: number[]): number[] => {
	const copy = createArray<number>();
	const keys = positionsOf(list);
	for (let i = 0; i < keys.length; i++) insertAt(copy, keys[i]!, list[i]!);
	assert.deepEqual(positionsOf(copy).map(hex), keys.map(hex), 'the replica holds the same keys');
	return copy;
};

test('two replicas inserting at the same place choose two different slots', () => {
	const cases: [string, (list: number[]) => void][] = [
		['append', (list) => { list.push(1); }],
		['prepend', (list) => { list.unshift(1); }],
		['insert between', (list) => { list.splice(1, 0, 1); }],
	];

	for (const [what, edit] of cases) {
		const source = createArray<number>([0, 9]);
		const before = positionsOf(source).map(hex);
		const chosen = new Set<string>();

		for (let replica = 0; replica < 200; replica++) {
			const copy = replicaOf(source);
			edit(copy);
			const added = positionsOf(copy).map(hex).filter((key) => !before.includes(key));
			assert.equal(added.length, 1, `${what}: one slot was added`);
			chosen.add(added[0]!);
		}

		assert.equal(chosen.size, 200, `${what}: 200 replicas of one array chose 200 slots`);
	}
});

test('two replicas inserting at the same place still agree on the order', () => {
	// Whichever way the two keys compare, both sides compare them the same way, so both end
	// with the same list. Distinct, and consistently ordered, is the whole guarantee.
	for (let round = 0; round < 100; round++) {
		const source = createArray<number>([0, 9]);
		const bounds = positionsOf(source);

		const one = replicaOf(source);
		const two = replicaOf(source);
		one.splice(1, 0, 1);
		two.splice(1, 0, 2);

		const a = positionsOf(one)[1]!;
		const b = positionsOf(two)[1]!;
		assert.notEqual(hex(a), hex(b), 'two chosen slots differ');
		assert.equal(compareBytes(bounds[0]!, a), -1, 'and both sit inside the gap');
		assert.equal(compareBytes(a, bounds[1]!), -1);
		assert.equal(compareBytes(bounds[0]!, b), -1);
		assert.equal(compareBytes(b, bounds[1]!), -1);
	}
});

// The pathological shapes, run long enough that a chooser which quietly runs out of room
// shows it. Each of these was a real failure while the level chooser was being built.
test('a position keeps finding room at either end and in the middle', () => {
	const shapes: [string, (list: number[]) => void][] = [
		['appending', (list) => { list.push(0); }],
		['prepending', (list) => { list.unshift(0); }],
		['inserting at one place', (list) => { list.splice(1, 0, 0); }],
		['inserting second from the end', (list) => { list.splice(Math.max(0, list.length - 1), 0, 0); }],
	];

	for (const [what, edit] of shapes) {
		const list = createArray<number>([0, 9]);
		for (let i = 0; i < 800; i++) edit(list);
		assert.equal(list.length, 802, `${what}: every insert took`);

		const positions = positionsOf(list);
		for (let i = 1; i < positions.length; i++) {
			assert.equal(compareBytes(positions[i - 1]!, positions[i]!), -1, `${what}: still ordered`);
		}
		for (const position of positions) {
			assert.notEqual(position[position.length - 1], 0, `${what}: never ends in a zero byte`);
		}
	}
});
