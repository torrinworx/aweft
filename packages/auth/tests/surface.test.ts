// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as client from '../src/client.ts';
import * as auth from '../src/index.ts';

test('the client subpath hands out the function and the source, and nothing else', () => {
	assert.deepEqual(Object.keys(client).sort(), ['authClient', 'createAuth']);
});

test('the entry hands out the source and the paths, and nothing else', () => {
	assert.deepEqual(Object.keys(auth).sort(), ['auth', 'paths']);
	assert.deepEqual(auth.paths, { email: ['email'], user: ['user'], expires: ['expires'] });
});

test('the source lists the five modules and evaluates none of them until asked', async () => {
	const candidates = await auth.auth.candidates();
	assert.deepEqual(candidates.map((c) => c.name).sort(), ['auth/Check', 'auth/Enter', 'auth/Gate', 'auth/Session', 'auth/State']);
});
