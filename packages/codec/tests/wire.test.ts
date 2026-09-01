import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex, bytesToHex } from '../src/index.ts';
import {
	type WireValue, type CodecError,
	codecError, decodeValue, encodeValue, MAX_INT, MIN_INT,
} from '../src/index.ts';

const roundTrip = (v: WireValue): void => {
	const bytes = encodeValue(v);
	assert.deepEqual(decodeValue(bytes), v, `decoding ${bytesToHex(bytes)}`);
	assert.deepEqual(encodeValue(decodeValue(bytes)), bytes, 're-encoding is not byte equal');
};

const rejects = (hex: string, reason: string): void => {
	assert.throws(
		() => decodeValue(bytesFromHex(hex)),
		(e: CodecError) => e.reason === reason,
		`${hex} should be rejected as ${reason}`,
	);
};

test('every representable value survives a round trip', () => {
	const values: WireValue[] = [
		null, true, false,
		0, 1, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296,
		Number.MAX_SAFE_INTEGER,
		-1, -24, -25, -256, -65536, -4294967297, -Number.MAX_SAFE_INTEGER - 1,
		0.5, -0.5, 1e-7, Math.PI, 1e300, 2 ** 53 * 2,
		'', 'title', 'a longer string with spaces', 'ünïcödé', '🧵 emoji', 'é combining',
		new Uint8Array(0), Uint8Array.of(0), Uint8Array.of(1, 2, 3, 255),
		[], [1, 'two', null], [[1], [2, [3]]],
	];

	for (const v of values) roundTrip(v);
});

test('integers use the shortest head that holds them', () => {
	assert.equal(bytesToHex(encodeValue(0)), '00');
	assert.equal(bytesToHex(encodeValue(23)), '17');
	assert.equal(bytesToHex(encodeValue(24)), '1818');
	assert.equal(bytesToHex(encodeValue(256)), '190100');
	assert.equal(bytesToHex(encodeValue(65536)), '1a00010000');
	assert.equal(bytesToHex(encodeValue(4294967296)), '1b0000000100000000');
	assert.equal(bytesToHex(encodeValue(-1)), '20');
});

test('a wider head than the value needs is rejected', () => {
	rejects('1800', 'non-canonical-integer');
	rejects('190017', 'non-canonical-integer');
	rejects('1a00000100', 'non-canonical-integer');
	rejects('1b0000000000010000', 'non-canonical-integer');
});

test('a whole number never arrives as a float', () => {
	// 3.0, and negative zero, both of which have an integer spelling.
	rejects('fb4008000000000000', 'non-canonical-float');
	rejects('fb8000000000000000', 'non-canonical-float');
});

test('negative zero encodes as zero, because nothing in the model distinguishes them', () => {
	assert.equal(bytesToHex(encodeValue(-0)), '00');
});

test('a number too large to be exact as an integer is written as a float', () => {
	const big = 2 ** 53 * 4;
	assert.equal(bytesToHex(encodeValue(big)), 'fb4360000000000000');
	assert.equal(decodeValue(encodeValue(big)), big);
	// A magnitude that really is past the exact range, arriving as an integer, is refused.
	rejects('1b0020000000000001', 'integer-out-of-range');
});

test('the integer range is the exact one, and it is the same on both sides', () => {
	// Section 6.2 draws the line at what a double holds exactly, so the last integer is 2^53
	// on each side. The safe integer range is one narrower on the positive side, and reaching
	// for it here refuses a whole number another implementation legitimately wrote.
	// Through the published constants, so a consumer sizing a check from them agrees with what
	// the encoder does.
	assert.equal(MAX_INT, 2 ** 53);
	assert.equal(MIN_INT, -(2 ** 53));
	assert.equal(bytesToHex(encodeValue(MAX_INT)), '1b0020000000000000');
	assert.equal(bytesToHex(encodeValue(MIN_INT)), '3b001fffffffffffff');
	assert.equal(decodeValue(encodeValue(MAX_INT)), MAX_INT);
	assert.equal(decodeValue(encodeValue(MIN_INT)), MIN_INT);

	// One past the line, on both sides. Both halves of the argument are checked before they
	// are added, because adding them first rounds the value back into range and the decoder
	// then answers with a number the bytes did not say.
	rejects('1b0020000000000001', 'integer-out-of-range');
	rejects('3b0020000000000000', 'integer-out-of-range');
	rejects('1bffffffffffffffff', 'integer-out-of-range');
	rejects('3bffffffffffffffff', 'integer-out-of-range');

	// And the float spelling of a whole number inside the range stays refused.
	rejects('fb4340000000000000', 'non-canonical-float');
});

test('what is not part of the format is refused by name', () => {
	rejects('a0', 'unsupported-major');
	rejects('c000', 'unsupported-major');
	rejects('f7', 'unsupported-simple');
	rejects('f90000', 'unsupported-simple');
	rejects('9f00ff', 'indefinite-length');
	rejects('5f40ff', 'indefinite-length');
	rejects('1c', 'malformed-head');
	rejects('fb7ff8000000000000', 'non-finite-float');
	rejects('fb7ff0000000000000', 'non-finite-float');
});

test('bytes that are not a whole value are refused', () => {
	rejects('61', 'truncated');
	rejects('0000', 'trailing-bytes');
	rejects('62c3', 'truncated');
	rejects('61ff', 'invalid-utf8');
	// An array claiming more items than there are bytes left never gets allocated for.
	rejects('9bffffffffffff0000', 'integer-out-of-range');
	rejects('9a0001000000', 'truncated');
});

test('a string with an unpaired surrogate has no encoding', () => {
	assert.throws(
		() => encodeValue('\ud800'),
		(e: CodecError) => e.reason === 'lone-surrogate',
	);
	assert.throws(
		() => encodeValue('a\udc00b'),
		(e: CodecError) => e.reason === 'lone-surrogate',
	);
	// A real pair is fine.
	roundTrip('🧵');
});

test('nesting past the guard is refused rather than recursed', () => {
	rejects('81818181818181818100', 'nesting-too-deep');
});


test('a refusal carries a reason a caller can branch on, not just a message', () => {
	// Every consumer of this package tells one refusal from another by `reason`, and the
	// conformance fixtures name the reason each invalid input must be refused for. A thrown
	// Error without it would still read fine in a log and be useless to a caller.
	const error = codecError('invalid-position', 'a position is non-empty');

	assert.ok(error instanceof Error);
	assert.equal(error.reason, 'invalid-position');
	assert.equal(error.message, 'invalid-position: a position is non-empty');
});

test('heads at and past the one-byte boundary, derived by hand from the specification', () => {
	// A 30-character text: major 3, length 30 needs the one-byte argument form, so the head
	// is 0x78 0x1e followed by the UTF-8 bytes.
	const text30 = 'abcdefghijklmnopqrstuvwxyz0123';
	assert.equal(
		bytesToHex(encodeValue(text30)),
		'781e' + Buffer.from(text30, 'utf8').toString('hex'),
	);

	// A 300-byte string: major 2, length 300 needs the two-byte argument form, so the head is
	// 0x59 0x01 0x2c.
	const bytes300 = new Uint8Array(300).fill(0xab);
	assert.equal(
		bytesToHex(encodeValue(bytes300)),
		'59012c' + 'ab'.repeat(300),
	);

	// An array of 25 nulls: major 4, count 25 needs the one-byte argument form, so the head
	// is 0x98 0x19, and null is 0xf6.
	assert.equal(
		bytesToHex(encodeValue(new Array(25).fill(null) as never)),
		'9819' + 'f6'.repeat(25),
	);
});
