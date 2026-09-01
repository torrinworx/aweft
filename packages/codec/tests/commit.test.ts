import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex, bytesToHex } from '../src/bytes.ts';
import { type CborValue, type CodecError, encodeValue } from '../src/cbor.ts';
import {
	type Commit, type Delta, type Value,
	decodeCommit, encodeCommit, isReference, MAX_TAG_BYTES, MIN_TAG_BYTES,
} from '../src/commit.ts';

const id = (n: number): Uint8Array => bytesFromHex(n.toString(16).padStart(24, '0'));

const A = id(1);
const B = id(2);
const C = id(3);

const reason = (fn: () => unknown, r: string): void =>
	assert.throws(fn, (e: CodecError) => e.reason === r, `expected ${r}`);

const roundTrip = (commit: Commit): Commit => {
	const bytes = encodeCommit(commit);
	const back = decodeCommit(bytes);
	assert.deepEqual(bytesToHex(encodeCommit(back)), bytesToHex(bytes), 're-encoding is not byte equal');
	return back;
};

test('all three slot kinds survive a round trip', () => {
	const commit: Commit = {
		deltas: [
			{ type: 'add', id: A, ref: { kind: 'object', key: 'title' }, value: 'a page' },
			{ type: 'replace', id: B, ref: { kind: 'array', key: Uint8Array.of(0x40) }, value: 7 },
			{ type: 'remove', id: C, ref: { kind: 'map', key: A } },
		],
	};

	assert.deepEqual(roundTrip(commit).deltas.length, 3);
});

test('every value kind survives a round trip', () => {
	const values: Value[] = [
		null, true, false, 0, -1, 1.5, 'text', Uint8Array.of(1, 2, 3),
		{ edge: 'attach', kind: 'object', id: B }, { edge: 'alias', kind: 'array', id: C },
		{ edge: 'attach', kind: 'map', id: A },
	];

	for (const [i, value] of values.entries()) {
		const back = roundTrip({ deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: `k${i}` }, value }] });
		assert.deepEqual(back.deltas[0]?.value, value);
	}
});

test('the order deltas are handed over does not change the bytes', () => {
	const deltas: Delta[] = [
		{ type: 'add', id: C, ref: { kind: 'object', key: 'z' }, value: 3 },
		{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: 1 },
		{ type: 'add', id: B, ref: { kind: 'object', key: 'm' }, value: 2 },
	];

	const forward = bytesToHex(encodeCommit({ deltas }));
	const reversed = bytesToHex(encodeCommit({ deltas: [...deltas].reverse() }));
	const rotated = bytesToHex(encodeCommit({ deltas: [deltas[1]!, deltas[2]!, deltas[0]!] }));

	assert.equal(forward, reversed);
	assert.equal(forward, rotated);
	assert.deepEqual(decodeCommit(bytesFromHex(forward)).deltas.map((d) => d.id), [A, B, C]);
});

test('an integrity tag rides along, within its stated width', () => {
	const deltas: Delta[] = [{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: 1 }];
	const tag = Uint8Array.of(1, 2, 3, 4);

	assert.deepEqual(roundTrip({ deltas, tag }).tag, tag);
	reason(() => encodeCommit({ deltas, tag: Uint8Array.of(1) }), 'invalid-tag');
	reason(() => encodeCommit({ deltas, tag: new Uint8Array(33) }), 'invalid-tag');
});

test('a commit that says nothing is not a commit', () => {
	reason(() => encodeCommit({ deltas: [] }), 'empty-commit');
	reason(() => decodeCommit(encodeValue([[]])), 'empty-commit');
});

test('one slot, one delta', () => {
	const twice: Delta[] = [
		{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: 1 },
		{ type: 'replace', id: A, ref: { kind: 'object', key: 'a' }, value: 2 },
	];

	reason(() => encodeCommit({ deltas: twice }), 'duplicate-slot');
});

test('a remove carries no value and an add carries one', () => {
	reason(
		() => encodeCommit({ deltas: [{ type: 'remove', id: A, ref: { kind: 'object', key: 'a' }, value: 1 }] }),
		'unexpected-value',
	);
	reason(
		() => encodeCommit({ deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'a' } }] }),
		'missing-value',
	);
});

test('a value is a primitive or a reference, never a structure', () => {
	reason(
		() => encodeCommit({
			deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: [1, 2] as unknown as Value }],
		}),
		'inline-container',
	);
});

test('a malformed slot name is refused', () => {
	reason(
		() => encodeCommit({ deltas: [{ type: 'add', id: A, ref: { kind: 'array', key: Uint8Array.of(1, 0) }, value: 1 }] }),
		'invalid-position',
	);
	reason(
		() => encodeCommit({ deltas: [{ type: 'add', id: A, ref: { kind: 'array', key: new Uint8Array(0) }, value: 1 }] }),
		'invalid-position',
	);
	reason(
		() => encodeCommit({ deltas: [{ type: 'add', id: A, ref: { kind: 'map', key: Uint8Array.of(1) }, value: 1 }] }),
		'invalid-id',
	);
});

// Deltas written in any order other than the canonical one are refused rather than sorted:
// accepting them would mean two byte strings decode to one commit, and then a re-encode
// could not reproduce its input, which is the property conformance rests on.
test('deltas out of canonical order are refused, not sorted', () => {
	const delta = (target: Uint8Array): CborValue => [0, target, [0, 'a'], 1];

	reason(() => decodeCommit(encodeValue([[delta(B), delta(A)]])), 'deltas-out-of-order');
	reason(() => decodeCommit(encodeValue([[delta(A), delta(A)]])), 'duplicate-slot');
});

test('a delta whose shape is wrong names the rule it broke', () => {
	reason(() => decodeCommit(encodeValue([[[9, A, [0, 'a'], 1]]])), 'unknown-delta-type');
	reason(() => decodeCommit(encodeValue([[[0, A, [9, 'a'], 1]]])), 'unknown-ref-kind');
	reason(() => decodeCommit(encodeValue([[[0, Uint8Array.of(1), [0, 'a'], 1]]])), 'invalid-id');
	reason(() => decodeCommit(encodeValue([[[0, A, [0, 'a']]]])), 'missing-value');
	reason(() => decodeCommit(encodeValue([[[2, A, [0, 'a'], 1]]])), 'unexpected-value');
	reason(() => decodeCommit(encodeValue([[[0, A, [0, 1], 1]]])), 'invalid-ref');
	reason(() => decodeCommit(encodeValue([[[0, A, [0, 'a'], [0, 0, Uint8Array.of(1)]]]])), 'invalid-id');
	reason(() => decodeCommit(encodeValue([[[0, A, [0, 'a'], [0, B]]]])), 'invalid-reference');
	reason(() => decodeCommit(encodeValue([[[0, A, [0, 'a'], [9, 0, B]]]])), 'unknown-edge-kind');
	reason(() => decodeCommit(encodeValue(['not a commit'])), 'invalid-commit');
	reason(() => decodeCommit(encodeValue([[[0, A, [0, 'a'], 1]], 'tag'])), 'invalid-tag');
});

test('a whole commit matches bytes spelled out by hand from the specification', () => {
	// Everywhere else the expected bytes come from this encoder, so those checks compare it
	// against its own past behavior and cannot catch it drifting from `spec/format.md`. These
	// are spelled out from the prose instead, head by head, so a disagreement shows up here.
	//
	// Read down the sections: 6.8 says a commit is [deltas], 6.7 says an add is
	// [type, id, ref, value], 6.5 says a ref is [kind, key], and 6.1 gives every head as three
	// bits of major type and five of argument, in the shortest form that holds it.
	//
	//   81                        6.8  array of 1: the commit
	//   81                        6.8  array of 1: the deltas
	//   84                        6.7  array of 4: an add carries a value
	//   00                        6.7  type 0, add
	//   4c 0000..0001             6.10 byte string of 12: the id
	//   82                        6.5  array of 2: the ref
	//   00                        6.5  kind 0, object
	//   65 7469746c65             6.3  text of 5: "title"
	//   62 6869                   6.3  text of 2: "hi"
	const spelled = '818184004c0000000000000000000000018200657469746c65626869';

	const commit: Commit = {
		deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'title' }, value: 'hi' }],
	};

	assert.equal(bytesToHex(encodeCommit(commit)), spelled);
	assert.deepEqual(decodeCommit(bytesFromHex(spelled)), commit);
});

test('a commit with a tag, a reference and a position matches bytes spelled out by hand', () => {
	// The head forms the first one does not reach: a three element delta for a remove (6.7),
	// an array ref whose key is a position byte string (6.5, 6.6), a value that is a reference
	// (6.4), a tag (6.8), and the canonical order between two deltas (6.9).
	//
	// The order is decided by the encoded ref, since both deltas share an id. The object ref
	// encodes 82 00 61 61 and the array ref 82 01 41 80, so the object one sorts first on its
	// second byte, whatever order the caller passes them in.
	//
	//   82                        6.8  array of 2: a commit carrying a tag
	//   82                        6.8  array of 2: two deltas
	//     84                      6.7  array of 4: an add
	//     00                      6.7  type 0, add
	//     4c 0000..0001           6.10 byte string of 12: the id
	//     82 00 61 61             6.5  ref [kind 0 object, text of 1 "a"]
	//     83 00 00 4c 0000..0002  6.4  value [edge 0 attach, kind 0 object, the id]
	//     83                      6.7  array of 3: a remove carries no value
	//     02                      6.7  type 2, remove
	//     4c 0000..0001           6.10 the id
	//     82 01 41 80             6.5  ref [kind 1 array, byte string of 1: the position]
	//   44 deadbeef               6.8  byte string of 4: the tag
	const spelled = '828284004c000000000000000000000001820061618300004c000000000000000000000002'
		+ '83024c0000000000000000000000018201418044deadbeef';

	const commit: Commit = {
		deltas: [
			{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: { edge: 'attach', kind: 'object', id: B } },
			{ type: 'remove', id: A, ref: { kind: 'array', key: Uint8Array.of(0x80) } },
		],
		tag: bytesFromHex('deadbeef'),
	};

	assert.equal(bytesToHex(encodeCommit(commit)), spelled);
	assert.deepEqual(decodeCommit(bytesFromHex(spelled)), commit);
});

test('the tag bounds are the ones the package publishes, and both edges hold', () => {
	const withTag = (n: number): Commit => ({
		deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: 1 }],
		tag: new Uint8Array(n).fill(7),
	});

	assert.equal(MIN_TAG_BYTES, 4);
	assert.equal(MAX_TAG_BYTES, 32);

	// The published constants are what the encoder actually enforces. A reader sizing a tag
	// from them, rather than from the prose, gets the same answer.
	roundTrip(withTag(MIN_TAG_BYTES));
	roundTrip(withTag(MAX_TAG_BYTES));
	reason(() => encodeCommit(withTag(MIN_TAG_BYTES - 1)), 'invalid-tag');
	reason(() => encodeCommit(withTag(MAX_TAG_BYTES + 1)), 'invalid-tag');
});

test('a reference is told from a primitive by its shape, not by being an object', () => {
	const ref: Value = { edge: 'attach', kind: 'object', id: B };
	assert.equal(isReference(ref), true);

	assert.equal(isReference(1), false);
	assert.equal(isReference('a'), false);
	assert.equal(isReference(null), false);
	assert.equal(isReference(B), false, 'a byte string is a primitive');

	// Anything object shaped used to pass, so a plain object reached the reference writer and
	// failed there complaining about its kind rather than about being a structure at all.
	assert.equal(isReference({} as Value), false);
	assert.equal(isReference(new Date() as unknown as Value), false);
	assert.equal(isReference({ kind: 'object', id: B } as unknown as Value), false, 'no edge');
});
