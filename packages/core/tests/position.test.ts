// Array positions, exercised through the array rather than reached into.
//
// A position is chosen, never derived, so the property that matters is not which bytes come
// out but that there is always room between two of them and that the order they compare in is
// the order the array reads in. That is a property test, seeded so a failure is repeatable.

import test from 'node:test';
import assert from 'node:assert/strict';

import { assertPosition, compareBytes } from '@aweftjs/codec';
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

	// A position is an integer part (five bytes for a one-digit integer) and four-byte
	// fractional levels: a digit and three random bytes. Inserting at one spot halves the
	// digit's room, so it costs a level every eight inserts and then steps a digit at a time
	// down the next one. Measured: 500 inserts between one pair reach 21 bytes, against 64
	// for the byte-per-level chooser before design 040. This bound is here so a change to
	// the chooser has to say what it did to that rate.
	const longest = Math.max(...positions.map((p) => p.length));
	assert.ok(longest <= 24, `a position grew to ${longest} bytes over 500 inserts at one place`);
	assert.ok(longest >= 17, `a position reached ${longest} bytes, so the chooser changed`);
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

		// Three random bytes per choice: 200 draws share a value about once in 800 runs, which
		// is how this read red on a green tree. A chooser that is a function of the neighbours
		// alone names one slot, so the bound that matters is far from 1, not exactly 200.
		assert.ok(chosen.size >= 198, `${what}: 200 replicas of one array chose ${chosen.size} slots`);
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

// Design 082: the integer part. Appending counts up, so a key does not grow with the list.
test('ten thousand appends keep every key at six bytes', () => {
	const list = createArray<number>();
	for (let i = 0; i < 10000; i++) list.push(i);

	const positions = positionsOf(list);
	const longest = Math.max(...positions.map((p) => p.length));
	assert.equal(longest, 6, `the longest key after 10,000 appends is ${longest} bytes`);
	assert.equal(positions[0]!.length, 5, 'the first key is a one-digit integer');
	for (let i = 1; i < positions.length; i++) {
		assert.equal(compareBytes(positions[i - 1]!, positions[i]!), -1);
	}
});

test('the integer part is a count byte and base 254 digits, starting at 128', () => {
	const list = createArray<number>();
	for (let i = 0; i < 300; i++) list.push(i);
	const positions = positionsOf(list);

	// Value 128 is digit byte 129 under a count of one.
	assert.deepEqual([...positions[0]!.slice(0, 2)], [1, 129]);
	// The 127th append is value 254, the first two-digit integer: count 2, digits [1, 0].
	assert.deepEqual([...positions[126]!.slice(0, 3)], [2, 2, 1]);
	assert.deepEqual([...positions[125]!.slice(0, 2)], [1, 254]);
	assert.notEqual(positions[299]![positions[299]!.length - 1], 0);
});

test('prepending counts down to zero and then goes under it, still ordered', () => {
	const list = createArray<number>([0]);
	for (let i = 0; i < 300; i++) list.unshift(i);

	const positions = positionsOf(list);
	assert.deepEqual([...positions[positions.length - 1]!.slice(0, 2)], [1, 129], 'the original first element');
	assert.deepEqual([...positions[172]!.slice(0, 2)], [1, 1], 'the 128th prepend reached zero');
	assert.ok(positions[0]!.length > 5, 'past zero the key grows a fractional level');
	for (let i = 1; i < positions.length; i++) {
		assert.equal(compareBytes(positions[i - 1]!, positions[i]!), -1);
	}
});

test('an insert between two adjacent integers goes under the lower one', () => {
	const list = createArray<number>([0, 1]);
	list.splice(1, 0, 5);

	const [a, mid, b] = positionsOf(list);
	assert.equal(mid!.length, a!.length + 4, 'one fractional level under the lower neighbour');
	assert.deepEqual([...mid!.slice(0, a!.length)], [...a!]);
	assert.equal(compareBytes(a!, mid!), -1);
	assert.equal(compareBytes(mid!, b!), -1);
});

// A run of tail positions is minted in one pass (design 155). It must produce the keys the
// one-at-a-time path produced: distinct, in order, and the same width.

const widths = (list: object): number[] => positionsOf(list).map((key) => key.length);

test('a pushed run gives keys that are distinct, ordered, and valid', () => {
	const run = createArray<number>();
	run.push(...Array.from({ length: 2000 }, (_, i) => i));

	const keys = positionsOf(run);
	assert.equal(keys.length, 2000);
	assert.equal(new Set(keys.map(hex)).size, 2000, 'every key in the run is its own slot');
	for (let i = 1; i < keys.length; i++) {
		assert.ok(compareBytes(keys[i - 1]!, keys[i]!) < 0, `key ${i} sorts after the one before it`);
	}
	// Read back through the codec's own judgment, which is what a receiver applies.
	for (const key of keys) assert.doesNotThrow(() => insertAt(createArray(), key, 1));
});

test('a run of tail keys is the width the one-at-a-time path produced', () => {
	const one = createArray<number>();
	for (let i = 0; i < 2000; i++) one.push(i);

	const run = createArray<number>();
	run.push(...Array.from({ length: 2000 }, (_, i) => i));

	assert.deepEqual(widths(run), widths(one), 'the run counts up exactly as the loop did');
});

test('a run onto a filled array carries on above what is there', () => {
	const list = createArray<number>();
	list.push(1, 2, 3);
	const before = positionsOf(list);
	list.push(4, 5, 6);
	const after = positionsOf(list);

	assert.deepEqual(after.slice(0, 3).map(hex), before.map(hex), 'the keys already there are untouched');
	for (let i = 1; i < after.length; i++) {
		assert.ok(compareBytes(after[i - 1]!, after[i]!) < 0, 'the second run sits above the first');
	}
	assert.deepEqual([...list], [1, 2, 3, 4, 5, 6]);
});

test('a run after a tail key nobody minted is refused, not minted underneath it', () => {
	// A valid key with a wider count byte sorts above every one-digit key, and its digits still
	// decode to a small integer, so counting up from it lands below it. `between` is where that
	// case is decided and it refuses; the run has to give the same answer rather than a key in
	// the wrong place.
	const list = createArray<number>();
	list.push(1);
	const hand = assertPosition(Uint8Array.from([2, 1, 1, 255, 255, 255]));
	assert.ok(compareBytes(positionsOf(list)[0]!, hand) < 0, 'the hand-written key is the tail');
	insertAt(list, hand, 99);

	assert.throws(() => list.push(7), (e: Error & { reason?: string }) => e.reason === 'invalid-position');
	assert.deepEqual([...list], [1, 99], 'and nothing was added');

	// A run after a key the array minted is what it always was.
	const ordinary = createArray<number>();
	ordinary.push(1, 2, 3);
	ordinary.push(4, 5);
	const keys = positionsOf(ordinary);
	assert.deepEqual([...ordinary], [1, 2, 3, 4, 5]);
	for (let i = 1; i < keys.length; i++) {
		assert.ok(compareBytes(keys[i - 1]!, keys[i]!) < 0, `key ${i} sorts after the one before it`);
	}
});

test('a splice in the middle still places one key at a time, between its neighbours', () => {
	const list = createArray<number>();
	list.push(1, 2, 3, 4);
	list.splice(2, 0, 10, 11);

	assert.deepEqual([...list], [1, 2, 10, 11, 3, 4]);
	const keys = positionsOf(list);
	for (let i = 1; i < keys.length; i++) {
		assert.ok(compareBytes(keys[i - 1]!, keys[i]!) < 0, `key ${i} sorts after the one before it`);
	}
});
