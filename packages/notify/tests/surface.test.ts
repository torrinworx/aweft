// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as battery from '../src/index.ts';
import * as client from '../src/client.ts';

test('the entry hands out the source and nothing else at run time', () => {
	assert.deepEqual(Object.keys(battery).sort(), ['notify']);
});

test('the source lists the three modules', async () => {
	const candidates = await battery.notify.candidates();
	assert.deepEqual(candidates.map((c) => c.name).sort(), ['notify/Devices', 'notify/Inbox', 'notify/Send']);
});

test('the client half hands out createInbox', () => {
	assert.deepEqual(Object.keys(client).sort(), ['createInbox']);
});
