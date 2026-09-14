// auth/Gate: identify calls `Session.whoIs`, access reads `public` and `needs` (designs 071,
// 074, 289).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Gate } from '@aweftjs/server';

import type { AuthContext } from '../src/index.ts';

import { module, newStore, peer, request } from './helpers.ts';

const whoIs = async (_req: Request, from?: { address: string | undefined }) =>
	({ context: { user: 'u_1', session: 't', address: from?.address } });

/** A roles module that holds the given names for everyone, and records what it was asked. */
const holding = (names: readonly string[]) => {
	const asked: [string, string][] = [];
	return { asked, may: async (user: string, name: string) => { asked.push([user, name]); return names.includes(name); } };
};

const signedIn: AuthContext = { user: 'u_1', session: 't', address: undefined };
const anonymous: AuthContext = { user: null, session: null, address: undefined };

test('identify hands the request and the peer to the session, and access allows public always and private with a user', async () => {
	const store = newStore();
	const seen: Request[] = [];
	const { instance: gate } = await module<Gate<AuthContext>>('Gate', store, {
		'auth/Session': { whoIs: async (req: Request, from?: { address: string | undefined }) => { seen.push(req); return whoIs(req, from); } },
		'auth/Roles': holding([]),
	});

	const req = request('/');
	assert.deepEqual(await gate.identify(req, peer), { context: { user: 'u_1', session: 't', address: '127.0.0.1' } });
	assert.equal(seen[0], req);

	assert.deepEqual(await gate.access({ name: 'auth/Check', instance: { public: true } }, anonymous), []);
	assert.deepEqual(await gate.access({ name: 'auth/State', instance: {} }, signedIn), []);
	assert.deepEqual(await gate.access({ name: 'auth/State', instance: {} }, anonymous), [{ code: 'private', message: 'auth/State needs a signed-in user' }]);
	assert.deepEqual(await gate.access({ name: 'x', instance: { public: 'yes' } }, anonymous), [{ code: 'private', message: 'x needs a signed-in user' }], 'only the boolean true is public');
	assert.equal((await gate.access({ name: 'x', instance: 42 }, anonymous)).length, 1, 'an instance that is not an object is private');
	assert.equal((await gate.access({ name: 'x', instance: {} }, 'not our context' as unknown as AuthContext)).length, 1, 'a context that is not ours is anonymous');
	await store.stop();
});

test('a module declaring needs is refused to anonymous as private, public or not, to a user who lacks a name as needs, and to everyone when the declaration is not names', async () => {
	const store = newStore();
	const roles = holding(['reports', 'verified']);
	const { instance: gate } = await module<Gate<AuthContext>>('Gate', store, { 'auth/Session': { whoIs }, 'auth/Roles': roles });

	assert.deepEqual(await gate.access({ name: 'app/Reports', instance: { needs: 'reports' } }, signedIn), []);
	assert.deepEqual(await gate.access({ name: 'app/Reports', instance: { needs: 'reports', public: true } }, anonymous),
		[{ code: 'private', message: 'app/Reports needs a signed-in user' }], 'a module that needs a name needs a person, whatever else it declares');
	assert.deepEqual(await gate.access({ name: 'app/Wipe', instance: { needs: 'admin' } }, signedIn),
		[{ code: 'needs', message: 'app/Wipe needs admin' }]);
	assert.deepEqual(await gate.access({ name: 'app/Both', instance: { needs: ['reports', 'verified'] } }, signedIn), [], 'a list is every name');
	assert.deepEqual(await gate.access({ name: 'app/Both', instance: { needs: ['reports', 'admin'] } }, signedIn),
		[{ code: 'needs', message: 'app/Both needs admin' }], 'the first name lacking is the reason');
	assert.deepEqual(await gate.access({ name: 'app/None', instance: { needs: [] } }, signedIn), [], 'an empty list needs a person and nothing more');
	assert.deepEqual(await gate.access({ name: 'app/None', instance: { needs: [], public: true } }, anonymous), [], 'and with public, nobody');
	assert.deepEqual(await gate.access({ name: 'app/None', instance: { needs: undefined, public: true } }, anonymous), [], 'undefined is no declaration');
	// A declaration that is not a name fails closed: the module is for nobody, whoever asks.
	for (const odd of ['not a name', 'admin ', '', ['reports', 7], ['admin', ''], 42, {}, null]) {
		assert.deepEqual(await gate.access({ name: 'app/Odd', instance: { needs: odd, public: true } }, signedIn),
			[{ code: 'needs', message: 'app/Odd declares needs that is not a name or a list of names' }], JSON.stringify(odd));
		assert.equal((await gate.access({ name: 'app/Odd', instance: { needs: odd } }, anonymous))[0]?.code, 'needs', `anonymous, ${JSON.stringify(odd)}`);
	}

	assert.deepEqual(roles.asked, [['u_1', 'reports'], ['u_1', 'admin'], ['u_1', 'reports'], ['u_1', 'verified'], ['u_1', 'reports'], ['u_1', 'admin']],
		'the roles module is asked per check and per name, never for an anonymous connection and never about a declaration that is not names');
	await store.stop();
});
