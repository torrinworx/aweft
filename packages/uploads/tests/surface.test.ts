// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as battery from '../src/index.ts';
import * as client from '../src/client.ts';
import * as bucket from '../src/s3.ts';

test('the entry hands out the source, the paths, the directory adapter, the key rule and the two readers', () => {
	assert.deepEqual(Object.keys(battery).sort(), ['directory', 'keyOf', 'paths', 'records', 'upload', 'uploads']);
});

test('the source lists the three modules', async () => {
	const candidates = await battery.uploads.candidates();
	assert.deepEqual(candidates.map((c) => c.name).sort(), ['uploads/Files', 'uploads/Receive', 'uploads/Serve']);
});

test('the client half hands out createUploads', () => {
	assert.deepEqual(Object.keys(client).sort(), ['createUploads']);
});

test('the s3 subpath hands out s3', () => {
	assert.deepEqual(Object.keys(bucket).sort(), ['s3']);
});
