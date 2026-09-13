// decodeFrame parses bytes that arrive over a link, and a link has no other gate in front of
// it. Two things have to hold for any input: the decoder either answers or refuses in the
// codec's own shape (a reason and a fix, never a bare TypeError or RangeError, never
// undefined), and whatever it answers with re-encodes to the exact bytes it was given. Every
// case here comes from one seeded generator, so a failure prints its seed, its generator and
// its input as hex, and that input becomes a named case here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
	type Commit, bytesFromHex, bytesToHex, createId, equalBytes,
} from '@aweftjs/codec';
import { randomBelow, randomFrom } from '@aweftjs/testing';
import { type Frame, decodeFrame, encodeFrame } from '@aweftjs/sync';

// A failing seed here is committed as its own named case rather than left to this loop.
const SEED = 20260913;

const FRAMES_DIR = join(import.meta.dirname, '..', '..', '..', 'spec', 'frames');

/** Every frame the format's own conformance corpus states, as hex, decode fixtures excluded. */
const FIXTURE_BYTES: readonly string[] = readdirSync(FRAMES_DIR)
	.filter((name) => name.endsWith('.json') && !name.startsWith('invalid'))
	.map((name) => (JSON.parse(readFileSync(join(FRAMES_DIR, name), 'utf8')) as { bytes: string }).bytes);

const id = createId();
const other = createId();
const commit: Commit = {
	deltas: [{ type: 'add', id, ref: { kind: 'object', key: 'title' }, value: 'plan' }],
};

/** One of each frame kind, and the shapes within a kind decodeFrame treats differently. */
const SAMPLE_FRAMES: readonly Frame[] = [
	{ kind: 'open', topic: 1, name: 'board:42', root: { id, kind: 'object' }, want: false },
	{ kind: 'open', topic: 9, name: '', root: { id: other, kind: 'array' }, want: true },
	{ kind: 'open', topic: 1, name: 'x', root: null, want: true },
	{ kind: 'state', topic: 2 },
	{ kind: 'state', topic: 2, commit },
	{ kind: 'commits', topic: 2, first: 5, commits: [commit, commit] },
	{ kind: 'refused', topic: 3, seq: 4, reasons: [{ code: 'not-here', message: 'no' }] },
	{ kind: 'refused', topic: 3, seq: 4, reasons: [{ code: 'x', message: 'y', path: ['a', 'b'] }] },
	{ kind: 'leave', topic: 7 },
	{ kind: 'fault', topic: 0, reason: 'bad-frame', message: 'not a frame' },
];

const BUILT_BYTES: readonly string[] = SAMPLE_FRAMES.map((frame) => bytesToHex(encodeFrame(frame)));

const FRAME_BYTES: readonly string[] = [...FIXTURE_BYTES, ...BUILT_BYTES];

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
 * Either decodeFrame answers or it refuses in the codec's own shape; it never throws
 * anything else and never answers with undefined. Whatever it answers with re-encodes to
 * the bytes it was given.
 */
const checkDecodeFrame = (generator: string, iteration: number, bytes: Uint8Array): void => {
	const where = `decodeFrame: seed ${SEED} generator "${generator}" iteration ${iteration} input ${bytesToHex(bytes)}`;

	let frame: Frame;
	try {
		frame = decodeFrame(bytes);
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

	assert.notEqual(frame, undefined, `${where}: decoded to undefined`);
	assert.ok(equalBytes(encodeFrame(frame), bytes), `${where}: re-encoding did not reproduce the input`);
};

const RANDOM_ITERATIONS = 2000;
const MUTATIONS_PER_FIXTURE = 100;

test('decodeFrame answers or refuses safely, and reproduces its bytes', () => {
	const random = randomFrom(SEED);

	for (let i = 0; i < RANDOM_ITERATIONS; i++) {
		const bytes = randomBytes(random, randomBelow(random, 65));
		checkDecodeFrame('random bytes', i, bytes);
	}

	let i = 0;
	for (const hex of FRAME_BYTES) {
		const valid = bytesFromHex(hex);
		for (let m = 0; m < MUTATIONS_PER_FIXTURE; m++) {
			checkDecodeFrame('mutated frame', i++, mutateOnce(random, valid));
		}
	}
});
