// The public surface, by name.
//
// Written by hand from the README and decision design 057, never from the module, so an
// export that appears without being decided turns this red.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as schema from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = ['check', 'guard', 'list', 'shape', 'table'];

	assert.deepEqual(Object.keys(schema).sort(), decided);
});
