// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as battery from '../src/index.ts';

test('the entry hands out the source, and nothing else', () => {
	assert.deepEqual(Object.keys(battery).sort(), ['health']);
});

test('the source lists the one module', async () => {
	const candidates = await battery.health.candidates();
	assert.deepEqual(candidates.map((candidate) => candidate.name), ['health/Check']);
});
