// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as jobs from '../src/index.ts';

test('the entry hands out exactly what the calls decided', () => {
	assert.deepEqual(Object.keys(jobs).sort(), ['createScheduler']);
});
