// The document model and the JSON conversions, tested directly.
//
// These run inside checkFixture, so coverage says they execute, but nothing held them to a
// contract of their own. They are what an implementation in another language reads a fixture
// through, so their contract is the round trip: what goes to JSON comes back unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex, type Commit, type Delta, type Ref, type Value } from '@aweftjs/codec';

import {
	type DocumentJson,
	applyCommit, canonicalJson, commitToJson, deltaFromJson, deltaToJson, modelApplier,
	refFromJson, refToJson, slotKey, valueFromJson, valueToJson,
} from '../src/index.ts';

const A = bytesFromHex('000000000000000000000001');
const B = bytesFromHex('000000000000000000000002');

test('a slot key is the same string the three kinds file under', () => {
	assert.equal(slotKey({ kind: 'object', key: 'title' }), 'title');
	assert.equal(slotKey({ kind: 'array', key: Uint8Array.of(0x80) }), '80');
	assert.equal(slotKey({ kind: 'map', key: A }), 'AAAAAAAAAAAAAAAB');
});

test('every kind of value survives the trip to JSON and back', () => {
	const values: Value[] = [
		null, true, false, 0, -1, 1.5, 2 ** 53, -(2 ** 53), '', 'text',
		bytesFromHex('cafe'),
		{ edge: 'attach', kind: 'object', id: A },
		{ edge: 'alias', kind: 'map', id: B },
	];

	for (const v of values) {
		const back = valueFromJson(valueToJson(v));
		assert.deepEqual(back, v, `${JSON.stringify(valueToJson(v))} did not come back unchanged`);
	}
});

test('every kind of ref survives the trip to JSON and back', () => {
	const refs: Ref[] = [
		{ kind: 'object', key: 'title' },
		{ kind: 'array', key: Uint8Array.of(0x80, 0x01) },
		{ kind: 'map', key: A },
	];

	for (const r of refs) assert.deepEqual(refFromJson(refToJson(r)), r);
});

test('a delta survives the trip to JSON and back, with and without a value', () => {
	const deltas: Delta[] = [
		{ type: 'add', id: A, ref: { kind: 'object', key: 'a' }, value: 1 },
		{ type: 'replace', id: A, ref: { kind: 'array', key: Uint8Array.of(0x80) }, value: 'x' },
		{ type: 'remove', id: A, ref: { kind: 'map', key: B } },
	];

	for (const d of deltas) assert.deepEqual(deltaFromJson(deltaToJson(d)), d);
});

test('a commit in JSON states its bytes, its deltas, and its tag only when it has one', () => {
	const bytes = Uint8Array.of(1, 2, 3);
	const plain: Commit = { deltas: [{ type: 'remove', id: A, ref: { kind: 'object', key: 'a' } }] };

	assert.equal('tag' in commitToJson(plain, bytes), false);
	assert.equal(commitToJson({ ...plain, tag: bytes }, bytes).tag, '010203');
});

test('canonical JSON does not depend on the order keys were written in', () => {
	assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
	assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));

	// Arrays are order, not a set: reordering them has to change the answer.
	assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test('the model applies a commit and reaches the document it should', () => {
	const initial: DocumentJson = {
		root: 'AAAAAAAAAAAAAAAB',
		observables: { AAAAAAAAAAAAAAAB: { kind: 'object', slots: {} } },
	};

	const reached = applyCommit(initial, {
		deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'title' }, value: 'a page' }],
	});

	assert.equal(reached.observables.AAAAAAAAAAAAAAAB!.slots.title, 'a page');
	assert.deepEqual(initial.observables.AAAAAAAAAAAAAAAB!.slots, {}, 'the input is not mutated');

	// modelApplier is the same thing over a sequence, which is the shape checkFixture wants.
	const viaApplier = modelApplier(initial, [{
		deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'title' }, value: 'a page' }],
	}]);
	assert.equal(canonicalJson(viaApplier), canonicalJson(reached));
});
