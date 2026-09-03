// The public surface, by name.
//
// The exports map decides what exists outside this package. This list is written by hand
// from the README, never from the module, so an export that appears or disappears without
// being decided turns this red rather than passing silently.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as codec from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = [
		'ID_BYTES', 'ID_TEXT_LENGTH', 'MAX_INT', 'MAX_TAG_BYTES', 'MIN_INT', 'MIN_TAG_BYTES',
		'assertId', 'assertPosition',
		'bytesFromHex', 'bytesToHex',
		'codecError', 'compareBytes', 'compareDeltas', 'comparePositions',
		'createId', 'decodeCommit', 'decodeValue', 'encodeCommit', 'encodeValue', 'equalBytes',
		'idFromText', 'idToText', 'isReference',
		'isValidPosition', 'slotKeyOf',
	];

	assert.deepEqual(Object.keys(codec).sort(), decided);
});
