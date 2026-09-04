// auth/Check: does anyone have this email.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Check } from '../src/modules/Check.ts';
import type { Enter } from '../src/modules/Enter.ts';

import { module, newStore, reasonOf } from './helpers.ts';

test('exists answers by normalised email, and the call refuses arguments that are not { email }', async () => {
	const store = newStore();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': {} });
	const { instance: check } = await module<Check>('Check', store);
	assert.equal(check.public, true);
	assert.equal(await check.exists('ada@example.com'), false);
	await enter.enter('Ada@Example.com', 'pw');
	assert.equal(await check.exists('ada@example.com'), true);
	assert.equal(await check.exists('  ADA@example.com '), true);
	assert.equal(await check.exists('not an email'), false);
	assert.deepEqual(await check.call({ email: 'ada@example.com' }), { exists: true });
	assert.deepEqual(await check.call({ email: 'bo@example.com' }), { exists: false });
	await assert.rejects(check.call({}), (e) => reasonOf(e) === 'malformed');
	await assert.rejects(check.call('ada@example.com'), (e) => reasonOf(e) === 'malformed');
	await store.stop();
});
