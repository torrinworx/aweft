// The behavioral corpus for `auth`: requirements this problem domain is known to need, each
// stated as something aweft must do. Append-only; removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Enter } from '../src/modules/Enter.ts';
import type { Session } from '../src/modules/Session.ts';

import { module, newStore, request, withCookie } from './helpers.ts';

test('requirement: the password never reaches the store, in any document or any commit', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const password = 'hunter2-a-very-particular-string';
	await enter.enter('ada@example.com', password);
	await enter.enter('ada@example.com', password);
	for (const { doc } of await store.scan(100)) {
		const held = await store.open(doc);
		assert.ok(!JSON.stringify(held.root).includes(password), `${doc} holds the password`);
		await store.close(held);
		for (const { commit } of await store.since(doc, 0)) {
			assert.ok(!JSON.stringify(commit.deltas.map((d) => d.value)).includes(password), `${doc}'s history holds the password`);
		}
	}
	await store.stop();
});

test('requirement: a session that has expired or been revoked is anonymous, not an error and not a user', async () => {
	const store = newStore();
	const { instance: brief } = await module<Session>('Session', store, {}, { sessionMs: 20 });
	const { instance: session } = await module<Session>('Session', store);
	const expiring = await brief.issue('u_1');
	const revoked = await session.issue('u_2');
	await session.revoke(revoked);
	await new Promise((done) => setTimeout(done, 40));
	for (const token of [expiring, revoked]) {
		const identified = await session.whoIs(withCookie('/', `session=${token}`));
		assert.ok('context' in identified && identified.context.user === null, `${token} is anonymous`);
	}
	await store.stop();
});

test('requirement: a token of the right shape that names no session is anonymous, and asking creates nothing', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	const identified = await session.whoIs(withCookie('/', 'session=zzzzzzzzzzzzzzzz'));
	assert.ok('context' in identified && identified.context.user === null);
	assert.deepEqual(await store.scan(10), [], 'no document was made by asking');
	await store.stop();
});

test('requirement: the cookie is HttpOnly and SameSite=Lax on every path, whatever the name or lifetime', async () => {
	const store = newStore();
	for (const config of [{}, { cookie: 'sid' }, { sessionMs: 1000 }, { cookie: 'x', sessionMs: 5 }]) {
		const { instance: session } = await module<Session>('Session', store, {}, config);
		for (const token of ['AAAAAAAAAAAAAAAA', null]) {
			const header = session.setCookie(token, request('/deep/path'));
			assert.match(header, /; HttpOnly(;|$)/);
			assert.match(header, /; SameSite=Lax(;|$)/);
			assert.match(header, /; Path=\/(;|$)/);
		}
	}
	await store.stop();
});

test('requirement: two sessions of one user are two documents, and revoking one leaves the other', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	const laptop = await session.issue('u_1');
	const phone = await session.issue('u_1');
	assert.notEqual(laptop, phone);
	await session.revoke(laptop);
	const still = await session.whoIs(withCookie('/', `session=${phone}`));
	assert.ok('context' in still && still.context.user === 'u_1');
	await store.stop();
});

test('requirement: a wrong password is refused the same way whether the account is old or new to this process', async () => {
	const store = newStore();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': {} });
	await enter.enter('ada@example.com', 'right');
	const { instance: fresh } = await module<Enter>('Enter', store, { 'auth/Session': {} });
	const [a, b] = await Promise.all([enter.enter('ada@example.com', 'wrong'), fresh.enter('ada@example.com', 'wrong')]);
	assert.deepEqual(a, b);
	assert.ok('refused' in a);
	await store.stop();
});
