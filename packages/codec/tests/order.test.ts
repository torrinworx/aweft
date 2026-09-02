// The canonical order, read off the values, has to be the order the bytes are in.
//
// Section 6.9 states the order over the encoded form: the id, then the ref, compared as byte
// strings. `compareDeltas` reads that order off the values instead, without writing anything,
// which is worth having because a commit sorts on the path every mutation takes. It is only
// worth having if the two agree everywhere, so this checks them against each other on the
// cases where a hand written comparator goes wrong: keys whose lengths cross a head boundary,
// text that is not ASCII, and characters above the basic plane.

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '@aweftjs/testing';

import {
	type Delta, type Ref,
	compareBytes, compareDeltas, createId, encodeValue,
} from '../src/index.ts';

/** The order as the specification states it: the encoding of the id, then of the ref. */
const encodedOrder = (a: Delta, b: Delta): number => {
	const key = (d: Delta): Uint8Array => {
		const id = encodeValue(d.id);
		const kind = encodeValue(d.ref.kind === 'object' ? 0 : d.ref.kind === 'array' ? 1 : 2);
		const slot = encodeValue(d.ref.key);

		const out = new Uint8Array(id.length + kind.length + slot.length);
		out.set(id);
		out.set(kind, id.length);
		out.set(slot, id.length + kind.length);
		return out;
	};

	return compareBytes(key(a), key(b));
};

// Lengths that sit either side of where a head grows, and text that is not one byte per
// character, because both are where a comparator that guesses gets it wrong.
const texts = [
	'', 'a', 'b', 'ab', 'B', '~', '0', 'key', 'keys', 'Key', 'kez',
	'a'.repeat(23), 'a'.repeat(24), 'b'.repeat(23), 'a'.repeat(255), 'a'.repeat(256),
	'\u00e9', '\u00e9e', '\u00fc', '\u00ff', '\u0800',
	// The pairs that separate code point order from code unit order. A character above the
	// basic plane is a surrogate pair whose first unit is below U+E000, so comparing the
	// strings themselves sorts it under characters it belongs above. These have matching
	// UTF-8 lengths, so the comparison reaches the characters rather than stopping at length.
	'\u{1f600}', '\uffffa', '\ue000a', 'a\uffff', '\u{10ffff}', '\uffff\uffff',
	'\u{1f600}\u{1f600}', '\uffff\uffffab', '\u{1f600}ab', '\uffff\uffff\uffff',
];

const positions = [
	Uint8Array.of(0x80), Uint8Array.of(0x81), Uint8Array.of(0x01), Uint8Array.of(0x80, 0x80),
	Uint8Array.of(0x80, 0x01), Uint8Array.of(0xff), new Uint8Array(23).fill(1),
	new Uint8Array(24).fill(1), new Uint8Array(25).fill(1),
];

test('the comparator agrees with the encoded order on every pair', () => {
	const random = randomFrom(20260831);
	const ids = [createId(), createId(), createId(), createId()];
	const mapKeys = [createId(), createId()];

	const pick = <T>(list: readonly T[]): T => list[randomBelow(random, list.length)]!;

	const refs: Ref[] = [];
	for (const key of texts) refs.push({ kind: 'object', key });
	for (const key of positions) refs.push({ kind: 'array', key });
	for (const key of mapKeys) refs.push({ kind: 'map', key });

	const deltas: Delta[] = [];
	for (const id of ids) {
		for (const ref of refs) deltas.push({ type: 'remove', id, ref });
	}

	let compared = 0;
	for (const a of deltas) {
		for (const b of deltas) {
			const mine = compareDeltas(a, b);
			const stated = encodedOrder(a, b);

			assert.equal(
				Math.sign(mine), Math.sign(stated),
				`${a.ref.kind} ${String(a.ref.key)} against ${b.ref.kind} ${String(b.ref.key)}`,
			);
			compared += 1;
		}
	}

	assert.ok(compared > 10000, `only ${compared} pairs were compared`);
	assert.ok(pick(deltas) !== undefined);
});

test('sorting by either rule reaches the same list', () => {
	const random = randomFrom(7);
	const ids = [createId(), createId()];

	const deltas: Delta[] = [];
	for (let i = 0; i < 200; i++) {
		const id = ids[Math.floor(random() * ids.length)]!;
		const roll = random();

		const ref: Ref = roll < 0.6
			? { kind: 'object', key: texts[Math.floor(random() * texts.length)]! }
			: roll < 0.85
				? { kind: 'array', key: positions[Math.floor(random() * positions.length)]! }
				: { kind: 'map', key: ids[Math.floor(random() * ids.length)]! };

		deltas.push({ type: 'remove', id, ref });
	}

	const mine = [...deltas].sort(compareDeltas).map((d) => `${d.ref.kind} ${String(d.ref.key)}`);
	const stated = [...deltas].sort(encodedOrder).map((d) => `${d.ref.kind} ${String(d.ref.key)}`);

	assert.deepEqual(mine, stated);
});

test('two deltas addressing one slot compare equal, whatever the slot is', () => {
	const id = createId();
	const key = createId();

	assert.equal(compareDeltas(
		{ type: 'remove', id, ref: { kind: 'object', key: 'a' } },
		{ type: 'add', id, ref: { kind: 'object', key: 'a' }, value: 1 },
	), 0);

	assert.equal(compareDeltas(
		{ type: 'remove', id, ref: { kind: 'map', key } },
		{ type: 'remove', id, ref: { kind: 'map', key } },
	), 0);

	assert.notEqual(compareDeltas(
		{ type: 'remove', id, ref: { kind: 'object', key: 'a' } },
		{ type: 'remove', id, ref: { kind: 'array', key: Uint8Array.of(0x80) } },
	), 0, 'the kind is part of what a delta addresses');
});
