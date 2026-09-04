// auth/Enter: sign in, or sign up when the email is new, never storing the password
// (design 074).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Enter, UserDocument } from '../src/modules/Enter.ts';
import type { Session } from '../src/modules/Session.ts';

import { jsonRequest, module, newStore, request } from './helpers.ts';

const stubSession = () => {
	const issued: string[] = [];
	const session = {
		issue: async (user: string) => { issued.push(user); return 'AAAAAAAAAAAAAAAA'; },
		setCookie: (token: string | null) => `session=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax`,
	} as unknown as Session;
	return { session, issued };
};

test('sign-up creates the user document with a hash and never the password; sign-in verifies it', async () => {
	const store = newStore();
	const { session } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	assert.equal(enter.public, true);

	const up = await enter.enter('  Ada@Example.COM ', 'correct horse');
	assert.ok('user' in up && up.created === true);
	const held = await store.open(`user:${up.user}`);
	const doc = held.root as UserDocument;
	assert.equal(doc.email, 'ada@example.com', 'the address is stored normalised');
	assert.equal(doc.name, null);
	assert.equal(doc.emailVerified, false);
	assert.equal(typeof doc.createdAt, 'number');
	assert.equal(doc.modifiedAt, doc.createdAt);
	assert.match(doc.password, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/, 'the hash carries its parameters and salt');
	assert.ok(!doc.password.includes('correct horse'));
	await store.close(held);

	const again = await enter.enter('ada@example.com', 'correct horse');
	assert.deepEqual(again, { user: up.user, created: false });
	const wrong = await enter.enter('ada@example.com', 'wrong horse');
	assert.ok('refused' in wrong && wrong.refused[0]!.code === 'password');
	const other = await enter.enter('bo@example.com', 'correct horse');
	assert.ok('user' in other && other.created === true && other.user !== up.user, 'a new email is a new user');
	await store.stop();
});

test('two hashes of one password differ, and a document whose hash is not a hash never verifies', async () => {
	const store = newStore();
	const { session } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const a = await enter.enter('a@example.com', 'same');
	const b = await enter.enter('b@example.com', 'same');
	const [ha, hb] = await Promise.all(['user' in a ? a.user : '', 'user' in b ? b.user : ''].map(async (id) => {
		const held = await store.open(`user:${id}`);
		const hash = (held.root as UserDocument).password;
		await store.close(held);
		return hash;
	}));
	assert.notEqual(ha, hb, 'a fresh salt per hash');

	const held = await store.open('user:' + ('user' in a ? a.user : ''));
	(held.root as UserDocument).password = 'not a hash';
	await store.settled(held);
	await store.close(held);
	const outcome = await enter.enter('a@example.com', 'same');
	assert.ok('refused' in outcome);
	await store.stop();
});

test('POST /api/session signs up with 201 and in with 200, sets the cookie, and refuses the rest by status', async () => {
	const store = newStore();
	const { session, issued } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const route = enter.routes['POST /api/session']!;
	const anonymous = { user: null, session: null };

	const up = await route(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'pw' }), anonymous);
	assert.equal(up.status, 201);
	const made = await up.json() as { user: string; created: boolean };
	assert.equal(made.created, true);
	assert.deepEqual(up.headers.getSetCookie(), ['session=AAAAAAAAAAAAAAAA; Path=/; HttpOnly; SameSite=Lax']);
	assert.deepEqual(issued, [made.user]);

	const back = await route(jsonRequest('/api/session', 'POST', { email: 'ADA@example.com', password: 'pw' }), anonymous);
	assert.equal(back.status, 200);
	assert.deepEqual(await back.json(), { user: made.user, created: false });

	const wrong = await route(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'nope' }), anonymous);
	assert.equal(wrong.status, 401);
	assert.deepEqual(await wrong.json(), { reasons: [{ code: 'password', message: 'the password is wrong' }] });
	assert.equal(issued.length, 2, 'nothing was issued for the refusal');

	for (const [body, code] of [
		[{ email: 'not an email', password: 'pw' }, 'email'],
		[{ password: 'pw' }, 'email'],
		[{ email: 'x@y.z', password: '' }, 'password'],
		[{ email: 'x@y.z' }, 'password'],
		[[1, 2], 'email'],
	] as const) {
		const bad = await route(jsonRequest('/api/session', 'POST', body), anonymous);
		assert.equal(bad.status, 400, JSON.stringify(body));
		assert.equal((await bad.json() as { reasons: { code: string }[] }).reasons[0]!.code, code);
	}
	const notJson = await route(request('/api/session', { method: 'POST', body: 'email=x' }), anonymous);
	assert.equal(notJson.status, 400);
	await store.stop();
});
