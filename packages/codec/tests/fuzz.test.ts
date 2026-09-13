// decodeCommit and decodeValue parse bytes an attacker controls, and everything above them
// trusts what comes back. Two things have to hold for any input: the decoder either answers
// or refuses in the package's own shape (a reason and a fix, never a bare TypeError or
// RangeError, never undefined), and whatever it answers with re-encodes to the exact bytes
// it was given. Every case here comes from one seeded generator, so a failure prints its
// seed, its generator and its input as hex, and that input becomes a named case here.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	type WireValue, bytesFromHex, bytesToHex, decodeCommit, decodeValue, encodeCommit,
	encodeValue, equalBytes, MAX_INT, MIN_INT,
} from '@aweftjs/codec';
import { loadFixtures, randomBelow, randomFrom } from '@aweftjs/testing';

// A failing seed here is committed as its own named case rather than left to this loop.
const SEED = 20260913;

const FIXTURES_DIR = new URL('../../../spec/fixtures/', import.meta.url);

/** Every commit the format's own conformance corpus states, as hex. */
const COMMIT_BYTES: readonly string[] = loadFixtures(FIXTURES_DIR)
	.flatMap((fixture) => fixture.commits.map((commit) => commit.bytes));

/** One of each shape a value can take, including both edges of the integer range. */
const SAMPLE_VALUES: readonly WireValue[] = [
	null, true, false,
	0, 1, -1, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296,
	MIN_INT, MAX_INT,
	0.5, -0.5, Math.PI, -1e300, 2 ** 53 * 3,
	'', 'plain text', 'ünïcödé', '🧵 emoji', 'a'.repeat(300),
	new Uint8Array(0), Uint8Array.of(0), Uint8Array.of(1, 2, 3, 255), new Uint8Array(300).fill(0xab),
	[], [1, 'two', null], [[1], [2, [3]]],
];

const VALUE_BYTES: readonly string[] = SAMPLE_VALUES.map((v) => bytesToHex(encodeValue(v)));

const randomBytes = (random: () => number, length: number): Uint8Array => {
	const out = new Uint8Array(length);
	for (let i = 0; i < length; i++) out[i] = randomBelow(random, 256);
	return out;
};

const flipOneByte = (random: () => number, bytes: Uint8Array): Uint8Array => {
	const out = bytes.slice();
	const at = randomBelow(random, out.length);
	const was = out[at]!;
	let value = randomBelow(random, 255);
	if (value >= was) value += 1;
	out[at] = value;
	return out;
};

const insertOneByte = (random: () => number, bytes: Uint8Array): Uint8Array => {
	const at = randomBelow(random, bytes.length + 1);
	const out = new Uint8Array(bytes.length + 1);
	out.set(bytes.subarray(0, at));
	out[at] = randomBelow(random, 256);
	out.set(bytes.subarray(at), at + 1);
	return out;
};

const deleteOneByte = (random: () => number, bytes: Uint8Array): Uint8Array => {
	const at = randomBelow(random, bytes.length);
	const out = new Uint8Array(bytes.length - 1);
	out.set(bytes.subarray(0, at));
	out.set(bytes.subarray(at + 1), at);
	return out;
};

const truncate = (random: () => number, bytes: Uint8Array): Uint8Array =>
	bytes.slice(0, randomBelow(random, bytes.length));

/** One flip, insert, delete or truncation. Insert is the only one defined on empty bytes. */
const mutateOnce = (random: () => number, bytes: Uint8Array): Uint8Array => {
	if (bytes.length === 0) return insertOneByte(random, bytes);
	const roll = randomBelow(random, 4);
	if (roll === 0) return flipOneByte(random, bytes);
	if (roll === 1) return insertOneByte(random, bytes);
	if (roll === 2) return deleteOneByte(random, bytes);
	return truncate(random, bytes);
};

/**
 * Either the decoder answers or it refuses in the package's own shape; it never throws
 * anything else and never answers with undefined. Whatever it answers with re-encodes to
 * the bytes it was given.
 */
const checkDecoder = <T>(
	decode: (bytes: Uint8Array) => T,
	encode: (value: T) => Uint8Array,
	name: string,
	generator: string,
	iteration: number,
	bytes: Uint8Array,
): void => {
	const where = `${name}: seed ${SEED} generator "${generator}" iteration ${iteration} input ${bytesToHex(bytes)}`;

	let value: T;
	try {
		value = decode(bytes);
	} catch (error) {
		assert.ok(!(error instanceof TypeError), `${where}: threw a TypeError instead of a refusal`);
		assert.ok(!(error instanceof RangeError), `${where}: threw a RangeError instead of a refusal`);
		const reason = (error as { reason?: unknown }).reason;
		const fix = (error as { fix?: unknown }).fix;
		assert.equal(typeof reason, 'string', `${where}: refusal has no string reason`);
		assert.ok(typeof reason === 'string' && reason.length > 0, `${where}: refusal reason is empty`);
		assert.equal(typeof fix, 'string', `${where}: refusal has no string fix`);
		assert.ok(typeof fix === 'string' && fix.length > 0, `${where}: refusal fix is empty`);
		return;
	}

	assert.notEqual(value, undefined, `${where}: decoded to undefined`);
	assert.ok(equalBytes(encode(value), bytes), `${where}: re-encoding did not reproduce the input`);
};

const RANDOM_ITERATIONS = 2000;
const MUTATIONS_PER_FIXTURE = 100;

test('decodeCommit answers or refuses safely, and reproduces its bytes', () => {
	const random = randomFrom(SEED);

	for (let i = 0; i < RANDOM_ITERATIONS; i++) {
		const bytes = randomBytes(random, randomBelow(random, 65));
		checkDecoder(decodeCommit, encodeCommit, 'decodeCommit', 'random bytes', i, bytes);
	}

	let i = 0;
	for (const hex of COMMIT_BYTES) {
		const valid = bytesFromHex(hex);
		for (let m = 0; m < MUTATIONS_PER_FIXTURE; m++) {
			checkDecoder(decodeCommit, encodeCommit, 'decodeCommit', 'mutated fixture', i++, mutateOnce(random, valid));
		}
	}
});

test('decodeValue answers or refuses safely, and reproduces its bytes', () => {
	const random = randomFrom(SEED);

	for (let i = 0; i < RANDOM_ITERATIONS; i++) {
		const bytes = randomBytes(random, randomBelow(random, 65));
		checkDecoder(decodeValue, encodeValue as (v: WireValue) => Uint8Array, 'decodeValue', 'random bytes', i, bytes);
	}

	let i = 0;
	for (const hex of VALUE_BYTES) {
		const valid = bytesFromHex(hex);
		for (let m = 0; m < MUTATIONS_PER_FIXTURE; m++) {
			checkDecoder(
				decodeValue, encodeValue as (v: WireValue) => Uint8Array, 'decodeValue', 'mutated value', i++,
				mutateOnce(random, valid),
			);
		}
	}
});
