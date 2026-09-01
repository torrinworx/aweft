// Positions, section 6.6 of the format.
//
// A position is a byte string, and the two rules on it are what guarantee an array can always
// grow between any two of its elements.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex } from '../src/index.ts';
import { type CodecError } from '../src/index.ts';
import { assertPosition, comparePositions, isValidPosition } from '../src/index.ts';

const pos = (hex: string): Uint8Array => bytesFromHex(hex);

test('a position is non-empty and does not end in a zero byte', () => {
	assert.equal(isValidPosition(pos('80')), true);
	assert.equal(isValidPosition(pos('8000000001')), true, 'a zero inside is fine');

	assert.equal(isValidPosition(new Uint8Array(0)), false, 'empty');
	assert.equal(isValidPosition(pos('8000')), false, 'ends in a zero byte');
	assert.equal(isValidPosition(pos('00')), false, 'a single zero is both');
});

test('asserting a position names the rule it broke', () => {
	const good = pos('80');
	assert.equal(assertPosition(good), good, 'a legal position is handed straight back');

	const thrown = (p: Uint8Array): string => {
		try {
			assertPosition(p);
			return 'accepted';
		} catch (error) {
			return (error as CodecError).reason;
		}
	};

	assert.equal(thrown(new Uint8Array(0)), 'invalid-position');
	assert.equal(thrown(pos('8000')), 'invalid-position');
});

test('positions order as unsigned byte strings, and a prefix sorts first', () => {
	// The whole point of the ordering is that a receiver can sort an array without asking any
	// other observable anything, so the comparison has to be the byte one and nothing cleverer.
	assert.ok(comparePositions(pos('80'), pos('81')) < 0);
	assert.ok(comparePositions(pos('81'), pos('80')) > 0);
	assert.equal(comparePositions(pos('80'), pos('80')), 0);

	// Unsigned. A signed read would put 0x80 before 0x7f and reverse half the array.
	assert.ok(comparePositions(pos('7f'), pos('80')) < 0);
	assert.ok(comparePositions(pos('01'), pos('ff')) < 0);

	// A prefix sorts before what extends it, which is what leaves room to insert after a key.
	assert.ok(comparePositions(pos('80'), pos('8001')) < 0);
	assert.ok(comparePositions(pos('8001'), pos('81')) < 0);
});

test('there is always room between two positions, which is what the two rules buy', () => {
	// Given any two valid neighbours, a key exists that sorts strictly between them. Walking a
	// worst case by hand: subdividing the same gap repeatedly always has somewhere to go,
	// because the lower key may be extended and the extension may not end in zero.
	let low = pos('80');
	const high = pos('81');

	for (let i = 0; i < 64; i++) {
		const next = new Uint8Array(low.length + 1);
		next.set(low);
		next[low.length] = 0x80;

		assert.ok(isValidPosition(next), 'the key produced is itself a legal position');
		assert.ok(comparePositions(low, next) < 0, 'above the one below it');
		assert.ok(comparePositions(next, high) < 0, 'below the one above it');
		low = next;
	}
});
