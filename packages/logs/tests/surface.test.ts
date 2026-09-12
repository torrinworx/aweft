// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as battery from '../src/index.ts';
import * as client from '../src/client.ts';

test('the entry hands out the source, the paths, and the four readers', () => {
	assert.deepEqual(Object.keys(battery).sort(), ['errors', 'logs', 'paths', 'prune', 'visit', 'visits']);
});

test('the source lists the three modules', async () => {
	const candidates = await battery.logs.candidates();
	assert.deepEqual(candidates.map((c) => c.name).sort(), ['logs/Observe', 'logs/Record', 'logs/Visits']);
});

test('the client half hands out createLog', () => {
	assert.deepEqual(Object.keys(client).sort(), ['createLog']);
});
