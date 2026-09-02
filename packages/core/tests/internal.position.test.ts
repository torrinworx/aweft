// The chooser, reached directly, for the one thing the array cannot show it.
//
// `createArray` only ever hands `between` two neighbours in order, so the guard that refuses
// a pair which is not a gap is unreachable through the public surface. It is still a stated
// guarantee, and a stated guarantee lands with the check that fails when it stops holding.

import test from 'node:test';
import assert from 'node:assert/strict';

import { between } from '../src/position.ts';

const reason = (name: string) => (e: Error & { reason?: string }): boolean => e.reason === name;

test('two positions that are not a gap are refused', () => {
	const low = between(null, null);
	const high = between(low, null);

	assert.throws(() => between(high, low), reason('invalid-position'), 'the wrong way round');
	assert.throws(() => between(low, low), reason('invalid-position'), 'the same position twice');
	assert.throws(
		() => between(Uint8Array.from(low), low), reason('invalid-position'),
		'equal by value, not only by identity',
	);
});

test('an open end is never a gap that fails', () => {
	const one = between(null, null);
	assert.ok(between(one, null).length > 0, 'after the last');
	assert.ok(between(null, one).length > 0, 'before the first');
	assert.ok(between(null, null).length > 0, 'into nothing at all');
});
