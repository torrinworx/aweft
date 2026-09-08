// The chooser, reached directly, for the one thing the array cannot show it.
//
// `createArray` only ever hands `between` two neighbours in order, so the guard that refuses
// a pair which is not a gap is unreachable through the public surface. It is still a stated
// guarantee, and a stated guarantee lands with the check that fails when it stops holding.

import test from 'node:test';
import assert from 'node:assert/strict';

import { type Position, assertPosition, compareBytes } from '@aweftjs/codec';

import { between, run } from '../src/position.ts';

const reason = (name: string) => (e: Error & { reason?: string }): boolean => e.reason === name;

test('two positions that are not a gap are refused', () => {
	const low = between(null, null);
	const high = between(low, null);

	assert.throws(() => between(high, low), reason('invalid-position'), 'the wrong way round');
	assert.throws(() => between(low, low), reason('invalid-position'), 'the same position twice');
	assert.throws(
		() => between(assertPosition(Uint8Array.from(low)), low), reason('invalid-position'),
		'equal by value, not only by identity',
	);
});

test('an open end is never a gap that fails', () => {
	const one = between(null, null);
	assert.ok(between(one, null).length > 0, 'after the last');
	assert.ok(between(null, one).length > 0, 'before the first');
	assert.ok(between(null, null).length > 0, 'into nothing at all');
});

// An array whose integer part passes 2^53 is unreachable through the surface: it would take
// 254^6 elements to get there. The BigInt path that covers it is still a stated guarantee
// (design 155), so it is checked here, on keys written by hand.

/** A key with a seven-digit integer part, which is past what a Number holds exactly. */
const wideKey = (digits: readonly number[]): Position => {
	assert.equal(digits.length, 7, 'seven digits is the first width past 2^53');
	return assertPosition(Uint8Array.from([digits.length, ...digits, 1, 1, 1]));
};

/** The digits of a key's integer part, which is what the arithmetic has to get right. */
const digitsOf = (key: Uint8Array): number[] => [...key.subarray(1, 1 + key[0]!)];

test('past 2^53 the next key counts up exactly, one digit at a time', () => {
	// The last digit is one below the top of the range, so the answer changes that digit alone.
	const from = wideKey([254, 254, 254, 254, 254, 254, 253]);
	const next = between(from, null);

	assert.deepEqual(digitsOf(next), [254, 254, 254, 254, 254, 254, 254],
		'a Number here would round and answer the same key it was given');
	assert.ok(compareBytes(from, next) < 0);
});

test('past 2^53 a carry still carries', () => {
	const from = wideKey([254, 1, 254, 254, 254, 254, 254]);
	const next = between(from, null);

	assert.deepEqual(digitsOf(next), [254, 2, 1, 1, 1, 1, 1], 'the top digit picked up the carry');
	assert.ok(compareBytes(from, next) < 0);
});

test('past 2^53 a run of keys is the same count-up, and every key is a slot of its own', () => {
	const from = wideKey([254, 254, 254, 254, 254, 254, 250]);
	const keys = run(from, 3);

	assert.equal(keys.length, 3);
	assert.deepEqual(keys.map(digitsOf), [
		[254, 254, 254, 254, 254, 254, 251],
		[254, 254, 254, 254, 254, 254, 252],
		[254, 254, 254, 254, 254, 254, 253],
	]);
	assert.ok(compareBytes(from, keys[0]!) < 0);
	for (let i = 1; i < keys.length; i++) assert.ok(compareBytes(keys[i - 1]!, keys[i]!) < 0);
});

test('a run of none is no keys at all', () => {
	assert.deepEqual(run(null, 0), []);
	assert.deepEqual(run(between(null, null), 0), []);
});

test('past 2^53 a run after a key nobody minted goes back through between', () => {
	// Seven digits reads as a wide key, and seven ones decode to zero, so the next integer takes
	// one digit and sorts below the key the run started from. The wide path checks the same way.
	const hand = assertPosition(Uint8Array.from([7, 1, 1, 1, 1, 1, 1, 1, 255, 255, 255]));
	assert.throws(() => run(hand, 3), reason('invalid-position'));
});
