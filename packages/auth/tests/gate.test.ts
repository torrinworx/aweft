// auth/Gate: identify calls `Session.whoIs`, access reads `public` (designs 071, 074).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Gate } from '@aweftjs/server';

import type { AuthContext } from '../src/index.ts';

import { module, newStore, peer, request } from './helpers.ts';

test('identify hands the request to the session, and access allows public always and private with a user', async () => {
	const store = newStore();
	const seen: Request[] = [];
	const whoIs = async (req: Request) => { seen.push(req); return { context: { user: 'u_1', session: 't' } }; };
	const { instance: gate } = await module<Gate<AuthContext>>('Gate', store, { 'auth/Session': { whoIs } });

	const req = request('/');
	assert.deepEqual(await gate.identify(req, peer), { context: { user: 'u_1', session: 't' } });
	assert.equal(seen[0], req);

	const signedIn = { user: 'u_1', session: 't' };
	const anonymous = { user: null, session: null };
	assert.deepEqual(await gate.access({ name: 'auth/Check', instance: { public: true } }, anonymous), []);
	assert.deepEqual(await gate.access({ name: 'auth/State', instance: {} }, signedIn), []);
	assert.deepEqual(await gate.access({ name: 'auth/State', instance: {} }, anonymous), [{ code: 'private', message: 'auth/State needs a signed-in user' }]);
	assert.deepEqual(await gate.access({ name: 'x', instance: { public: 'yes' } }, anonymous), [{ code: 'private', message: 'x needs a signed-in user' }], 'only the boolean true is public');
	assert.equal((await gate.access({ name: 'x', instance: 42 }, anonymous)).length, 1, 'an instance that is not an object is private');
	assert.equal((await gate.access({ name: 'x', instance: {} }, 'not our context' as unknown as AuthContext)).length, 1, 'a context that is not ours is anonymous');
	await store.stop();
});
