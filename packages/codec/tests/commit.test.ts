import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex, bytesToHex } from '../src/bytes.ts';
import { type CborValue, type CodecError, encodeValue } from '../src/cbor.ts';
import { type Commit, type Delta, type Value, decodeCommit, encodeCommit } from '../src/commit.ts';

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
