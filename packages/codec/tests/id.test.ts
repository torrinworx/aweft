import test from 'node:test';
import assert from 'node:assert/strict';

import { bytesFromHex } from '../src/index.ts';
import type { CodecError } from '../src/index.ts';
import { assertId, createId, ID_BYTES, ID_TEXT_LENGTH, idFromText, idToText } from '../src/index.ts';

test('an id is 96 bits of randomness', () => {
	const id = createId();
	assert.equal(id.length, ID_BYTES);

	const seen = new Set<string>();
	for (let i = 0; i < 5000; i++) seen.add(idToText(createId()));
	assert.equal(seen.size, 5000, 'ids repeated within one run');
});

test('the pool refills without repeating, shortening or sharing bytes', () => {
	// More than one pool's worth (341 ids), so the boundary is crossed several times and an
	// off-by-one in the refill shows up as a short id or a repeat rather than as nothing.
	const seen = new Set<string>();
	for (let i = 0; i < 1100; i++) {
		const id = createId();
		assert.equal(id.length, ID_BYTES, `id ${i} is not ${ID_BYTES} bytes`);
		seen.add(idToText(id));
	}
	assert.equal(seen.size, 1100);

	const a = createId();
	const b = createId();
	a.fill(0);
	assert.notDeepEqual(b, a, 'each id owns its bytes; two must not be views on one buffer');
});

test('the textual form is sixteen characters and round trips', () => {
	for (let i = 0; i < 200; i++) {
		const id = createId();
		const text = idToText(id);
		assert.equal(text.length, ID_TEXT_LENGTH);
		assert.deepEqual(idFromText(text), id);
	}
});

test('the textual form has no padding and no characters needing escapes', () => {
	assert.equal(idToText(bytesFromHex('000000000000000000000000')), 'AAAAAAAAAAAAAAAA');
	assert.equal(idToText(bytesFromHex('ffffffffffffffffffffffff')), '________________');
	assert.match(idToText(createId()), /^[A-Za-z0-9_-]{16}$/);
});

test('a malformed id is refused rather than padded or truncated', () => {
	const reason = (fn: () => unknown, r: string): void =>
		assert.throws(fn, (e: CodecError) => e.reason === r);

	reason(() => assertId(bytesFromHex('00')), 'invalid-id');
	reason(() => assertId(bytesFromHex('0000000000000000000000000000')), 'invalid-id');
	reason(() => idFromText('short'), 'invalid-id');
	reason(() => idFromText('AAAAAAAAAAAAAAA+'), 'invalid-id');
	reason(() => idFromText('AAAAAAAAAAAAAA=='), 'invalid-id');
});
