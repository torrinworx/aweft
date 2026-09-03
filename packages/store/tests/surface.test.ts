import test from 'node:test';
import assert from 'node:assert/strict';

import * as store from '../src/index.ts';

// What this package hands out, pinned. An export that arrives without being decided on is a
// public promise nobody made.
test('the entry file exports exactly what was decided', () => {
	assert.deepEqual(Object.keys(store).sort(), [
		'compare', 'createStore', 'decodeCommit', 'encodeCommit', 'holds', 'memoryDriver',
	]);
});

test('every exported function is one', () => {
	for (const [name, held] of Object.entries(store)) {
		assert.equal(typeof held, 'function', `${name} is not callable`);
	}
});
