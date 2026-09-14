// auth/Session: sessions as documents, the cookie, and who a request is (design 074).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';

import type { AuthContext } from '../src/index.ts';
import type { Session, SessionDocument } from '../src/modules/Session.ts';

import { module, newStore, request, withCookie } from './helpers.ts';

const contextOf = (identified: Awaited<ReturnType<Session['whoIs']>>): AuthContext => {
	if ('refused' in identified) throw new Error(`refused: ${JSON.stringify(identified.refused)}`);
	return identified.context;
};

test('issue mints a token, whoIs reads it back from the cookie, and revoke ends it', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	const token = await session.issue('u_ada');
	assert.equal(token.length, 22, 'sixteen random bytes, base64url');

	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: 'u_ada', session: token, address: undefined });
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `theme=dark; session=${token}; other=1`))), { user: 'u_ada', session: token, address: undefined });
	assert.deepEqual(contextOf(await session.whoIs(request('/'))), { user: null, session: null, address: undefined });
	assert.notEqual(contextOf(await session.whoIs(request('/'))), contextOf(await session.whoIs(request('/'))), 'each anonymous answer is its own object, so a connection can be told from another');

	const held = await store.open(`session:${token}`);
	const doc = held.root as Record<string, unknown>;
	assert.equal(doc.user, 'u_ada');
	assert.equal(doc.expires, null, 'no lifetime ships');
	assert.equal(doc.status, 'active');
	assert.equal(typeof doc.createdAt, 'number');
	await store.close(held);

	assert.equal(await session.revoke(token), true);
	assert.equal(await session.revoke(token), false, 'revoking twice says it was already over');
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: null, session: null, address: undefined }, 'a revoked session is anonymous');
	assert.equal(await session.revoke('AAAAAAAAAAAAAAAA'), false, 'a token that names no session revokes nothing');
	await stop();
	await store.stop();
});

test('a cookie that is not a token, or names no session, is anonymous, and nothing is refused at the door', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	for (const bad of ['nope', 'AAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAA!!', '', 'AAAAAAAAAAAAAAAA']) {
		assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${bad}`))), { user: null, session: null, address: undefined }, JSON.stringify(bad));
	}
	assert.equal(await store.head('session:AAAAAAAAAAAAAAAA'), 0, 'asking about a token creates no document');
	await store.stop();
});

test('several cookies of the name: the first that names a live session wins, and the others are not held against it', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	const live = await session.issue('u_ada');
	const stale = await session.issue('u_old');
	await session.revoke(stale);
	for (const header of [
		`session=; session=${live}`,
		`session=${live}; session=`,
		`session=legacy-app-value; session=${live}`,
		`session=${stale}; session=${live}`,
		`session=${live}; session=${stale}`,
		`theme=dark; session=${live}; session=not-a-token; other=1`,
	]) {
		assert.deepEqual(contextOf(await session.whoIs(withCookie('/', header))), { user: 'u_ada', session: live, address: undefined }, header);
	}
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${stale}; session=legacy`))), { user: null, session: null, address: undefined });
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `other=${live}; =${live}`))), { user: null, session: null, address: undefined },
		'a live token under another name, or under no name, is not this battery\'s cookie');
	await store.stop();
});

test('a lifetime that is not a positive number is refused when the module is made', async () => {
	const store = newStore();
	for (const sessionMs of ['60000', -1, 0, Number.NaN, Number.POSITIVE_INFINITY, null, true]) {
		await assert.rejects(module<Session>('Session', store, {}, { sessionMs }), /sessionMs/, JSON.stringify(sessionMs));
	}
	await store.stop();
});

test('with a lifetime configured, a session expires and the cookie carries Max-Age', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store, {}, { sessionMs: 60 });
	const token = await session.issue('u_ada');
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: 'u_ada', session: token, address: undefined });
	assert.match(session.setCookie(token, request('/')), /Max-Age=0(;|$)/, 'a lifetime under a second rounds down to zero');
	await new Promise((done) => setTimeout(done, 80));
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: null, session: null, address: undefined }, 'an expired session is anonymous');

	const { instance: longer } = await module<Session>('Session', store, {}, { sessionMs: 3_600_000 });
	assert.match(longer.setCookie(await longer.issue('u_bo'), request('/')), /Max-Age=3600(;|$)/);
	await store.stop();
});

test('the cookie is HttpOnly, SameSite=Lax, on every path, Secure only over TLS, and clears with Max-Age=0', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	const plain = session.setCookie('AAAAAAAAAAAAAAAA', request('/'));
	assert.equal(plain, 'session=AAAAAAAAAAAAAAAA; Path=/; HttpOnly; SameSite=Lax');
	const tls = session.setCookie('AAAAAAAAAAAAAAAA', new Request('https://app.test/'));
	assert.equal(tls, 'session=AAAAAAAAAAAAAAAA; Path=/; HttpOnly; SameSite=Lax; Secure');
	assert.equal(session.setCookie(null, request('/')), 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');

	const { instance: named } = await module<Session>('Session', store, {}, { cookie: 'sid' });
	assert.match(named.setCookie('AAAAAAAAAAAAAAAA', request('/')), /^sid=/);
	assert.deepEqual(contextOf(await named.whoIs(withCookie('/', 'session=AAAAAAAAAAAAAAAA'))), { user: null, session: null, address: undefined }, 'the other name is not read');
	await store.stop();
});

test('DELETE /api/session revokes the session and clears the cookie, and an anonymous one still clears it', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	assert.equal(session.public, true);
	const token = await session.issue('u_ada');
	const route = session.routes['DELETE /api/session']!;
	const response = await route(withCookie('/api/session', `session=${token}`, { method: 'DELETE' }), { user: 'u_ada', session: token, address: undefined });
	assert.equal(response.status, 200);
	assert.deepEqual(response.headers.getSetCookie(), ['session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: null, session: null, address: undefined });

	const stale = await route(request('/api/session', { method: 'DELETE' }), { user: null, session: null, address: undefined });
	assert.equal(stale.status, 200);
	assert.deepEqual(stale.headers.getSetCookie(), ['session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
	await store.stop();
});

test('call answers who the asking connection is, and anonymous hears null', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	assert.deepEqual(session.call({}, { user: 'u_ada', session: 'AAAAAAAAAAAAAAAA' }), { user: 'u_ada' });
	assert.deepEqual(session.call({}, { user: null, session: null, address: undefined }), { user: null });
	assert.deepEqual(session.call({}, undefined), { user: null }, 'a context from another gate names nobody');
	await stop();
	await store.stop();
});

test('a module without a store in the loader props is refused loudly', async () => {
	const exports = await import('../src/modules/Session.ts');
	await assert.rejects(exports.default({ imports: {}, config: { cookie: 'session', keep: 30, sweepMs: 3_600_000 }, extensions: {} }), /needs a store/);
});

test('whoIs carries the peer address into the context, signed in or not', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	const token = await session.issue('u_ada');
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`), { address: '203.0.113.9' })), { user: 'u_ada', session: token, address: '203.0.113.9' });
	assert.deepEqual(contextOf(await session.whoIs(request('/'), { address: '203.0.113.9' })), { user: null, session: null, address: '203.0.113.9' });
	assert.deepEqual(contextOf(await session.whoIs(request('/'), { address: undefined })), { user: null, session: null, address: undefined });
	await stop();
	await store.stop();
});

/** Move a session's end into the past, the way time would. */
const backdate = async (store: Store, token: string, daysAgo: number): Promise<void> => {
	const handle = await store.open(`session:${token}`);
	(handle.root as SessionDocument).expires = Date.now() - daysAgo * 86_400_000;
	await store.settled(handle);
	await store.close(handle);
};

test('revoke writes expires as the moment it ended, and the sweep removes what has been over for longer than keep', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store, {}, { keep: 1 });
	const before = Date.now();
	const revoked = await session.issue('u_old');
	await session.revoke(revoked);
	const held = await store.open(`session:${revoked}`);
	const doc = held.root as SessionDocument;
	assert.equal(doc.status, 'revoked');
	assert.ok(typeof doc.expires === 'number' && doc.expires >= before && doc.expires <= Date.now(), 'expires is when it ended');
	await store.close(held);

	const live = await session.issue('u_live');
	const recent = await session.issue('u_recent');
	await session.revoke(recent);
	const expired = await session.issue('u_expired');
	await backdate(store, revoked, 2);
	await backdate(store, expired, 2);
	assert.equal(await session.sweep(), 2, 'the one revoked two days ago and the one that expired two days ago');
	assert.equal(await store.head(`session:${revoked}`), 0);
	assert.equal(await store.head(`session:${expired}`), 0);
	assert.ok(await store.head(`session:${live}`) > 0, 'a session with no end is never swept');
	assert.ok(await store.head(`session:${recent}`) > 0, 'one revoked just now is inside keep');
	assert.equal(await session.sweep(), 0);
	await stop();
	await store.stop();
});

test('the sweep runs when the module is made, and keep or sweepMs that is not a positive number is refused', async () => {
	const store = newStore();
	const { instance: first, stop } = await module<Session>('Session', store, {}, { keep: 1 });
	const old = await first.issue('u_old');
	await first.revoke(old);
	await backdate(store, old, 2);
	await stop();
	assert.ok(await store.head(`session:${old}`) > 0, 'still there until something sweeps');
	const { stop: stopSecond } = await module<Session>('Session', store, {}, { keep: 1 });
	assert.equal(await store.head(`session:${old}`), 0, 'swept as the module was made');
	await stopSecond();
	for (const config of [{ keep: 0 }, { keep: '30' }, { keep: -1 }, { sweepMs: 0 }, { sweepMs: 2_147_483_648 }, { sweepMs: 'hourly' }]) {
		await assert.rejects(module<Session>('Session', store, {}, config), /invalid-config/, JSON.stringify(config));
	}
	await store.stop();
});

test('a store that does not declare expires is refused as the module is made, naming the fix', async () => {
	const store = createStore({ driver: memoryDriver(), declare: { email: ['email'], user: ['user'] } });
	await assert.rejects(module<Session>('Session', store), (e: Error) => String((e.cause as { reason?: string }).reason) === 'undeclared' && /Spread paths from @aweftjs\/auth/.test(e.message));
	await store.stop();
});
