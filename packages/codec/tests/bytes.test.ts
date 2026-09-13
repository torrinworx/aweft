import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex, bytesToHex, compareBytes, equalBytes } from '../src/index.ts';

test('byte strings order as unsigned bytes', () => {
	assert.equal(compareBytes(Uint8Array.of(1), Uint8Array.of(2)), -1);
	assert.equal(compareBytes(Uint8Array.of(2), Uint8Array.of(1)), 1);
	assert.equal(compareBytes(Uint8Array.of(0x7f), Uint8Array.of(0x80)), -1, 'the high bit is not a sign');
	assert.equal(compareBytes(Uint8Array.of(1, 2), Uint8Array.of(1, 2)), 0);
});

test('a prefix sorts before what extends it', () => {
	assert.equal(compareBytes(Uint8Array.of(1), Uint8Array.of(1, 0)), -1);
	assert.equal(compareBytes(Uint8Array.of(1, 0), Uint8Array.of(1)), 1);
	assert.equal(compareBytes(new Uint8Array(0), Uint8Array.of(0)), -1);
	assert.ok(equalBytes(Uint8Array.of(9), Uint8Array.of(9)));
	assert.ok(!equalBytes(Uint8Array.of(9), Uint8Array.of(9, 9)));
});

test('hex round trips, and malformed hex is refused', () => {
	assert.equal(bytesToHex(Uint8Array.of(0, 15, 16, 255)), '000f10ff');
	assert.deepEqual(bytesFromHex('000f10ff'), Uint8Array.of(0, 15, 16, 255));
	assert.equal(bytesToHex(new Uint8Array(0)), '');
	assert.deepEqual(bytesFromHex(''), new Uint8Array(0));

	assert.throws(() => bytesFromHex('abc'), /odd length/);
	assert.throws(() => bytesFromHex('zz'), /not a hex byte/);
	// Each half of a byte is read separately, so each half has to be checked.
	assert.throws(() => bytesFromHex('0z'), /not a hex byte/);
	assert.throws(() => bytesFromHex('z0'), /not a hex byte/);
	assert.throws(() => bytesFromHex('0\u00e9'), /not a hex byte/, 'outside the ASCII table');
	assert.deepEqual(bytesFromHex('0A1B'), Uint8Array.of(0x0a, 0x1b), 'upper case reads the same');
});

test('malformed hex is refused by name, so a caller can tell it from a bad position', () => {
	const reason = (fn: () => unknown, r: string): void =>
		assert.throws(fn, (e: { reason: string }) => e.reason === r);

	reason(() => bytesFromHex('abc'), 'invalid-hex');
	reason(() => bytesFromHex('zz'), 'invalid-hex');
	reason(() => bytesFromHex('0g'), 'invalid-hex');
	reason(() => bytesFromHex('0'), 'invalid-hex');
});
