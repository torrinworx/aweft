// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as client from '../src/client.ts';
import * as auth from '../src/index.ts';

test('the client subpath hands out the function and the source, and nothing else', () => {
	assert.deepEqual(Object.keys(client).sort(), ['authClient', 'createAuth']);
});

test('the entry hands out the two sources, the paths and the check, and nothing else', () => {
	assert.deepEqual(Object.keys(auth).sort(), ['auth', 'holds', 'mail', 'paths']);
	assert.deepEqual(auth.paths, { email: ['email'], user: ['user'], expires: ['expires'] });
});

test('the auth source lists the six modules, the mail source the two that mail, and neither evaluates one until asked', async () => {
	const candidates = await auth.auth.candidates();
	assert.deepEqual(candidates.map((c) => c.name).sort(), ['auth/Check', 'auth/Enter', 'auth/Gate', 'auth/Roles', 'auth/Session', 'auth/State']);
	const mailing = await auth.mail.candidates();
	assert.deepEqual(mailing.map((c) => c.name).sort(), ['auth/Password', 'auth/Verify']);
});
