// auth/Session: sessions as documents, the cookie, and who a request is (design 074).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { AuthContext } from '../src/index.ts';
import type { Session } from '../src/modules/Session.ts';

import { module, newStore, request, withCookie } from './helpers.ts';

const contextOf = (identified: Awaited<ReturnType<Session['whoIs']>>): AuthContext => {
	if ('refused' in identified) throw new Error(`refused: ${JSON.stringify(identified.refused)}`);
	return identified.context;
};

test('issue mints a token, whoIs reads it back from the cookie, and revoke ends it', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	const token = await session.issue('u_ada');
	assert.equal(token.length, 16);

	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: 'u_ada', session: token });
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `theme=dark; session=${token}; other=1`))), { user: 'u_ada', session: token });
	assert.deepEqual(contextOf(await session.whoIs(request('/'))), { user: null, session: null });
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
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: null, session: null }, 'a revoked session is anonymous');
	assert.equal(await session.revoke('AAAAAAAAAAAAAAAA'), false, 'a token that names no session revokes nothing');
	await stop();
	await store.stop();
});

test('a cookie that is not a token, or names no session, is anonymous, and nothing is refused at the door', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	for (const bad of ['nope', 'AAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAA!!', '', 'AAAAAAAAAAAAAAAA']) {
		assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${bad}`))), { user: null, session: null }, JSON.stringify(bad));
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
		assert.deepEqual(contextOf(await session.whoIs(withCookie('/', header))), { user: 'u_ada', session: live }, header);
	}
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${stale}; session=legacy`))), { user: null, session: null });
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
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: 'u_ada', session: token });
	assert.match(session.setCookie(token, request('/')), /Max-Age=0(;|$)/, 'a lifetime under a second rounds down to zero');
	await new Promise((done) => setTimeout(done, 80));
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: null, session: null }, 'an expired session is anonymous');

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
	assert.deepEqual(contextOf(await named.whoIs(withCookie('/', 'session=AAAAAAAAAAAAAAAA'))), { user: null, session: null }, 'the other name is not read');
	await store.stop();
});

test('DELETE /api/session revokes the session and clears the cookie, and an anonymous one still clears it', async () => {
	const store = newStore();
	const { instance: session } = await module<Session>('Session', store);
	assert.equal(session.public, true);
	const token = await session.issue('u_ada');
	const route = session.routes['DELETE /api/session']!;
	const response = await route(withCookie('/api/session', `session=${token}`, { method: 'DELETE' }), { user: 'u_ada', session: token });
	assert.equal(response.status, 200);
	assert.deepEqual(response.headers.getSetCookie(), ['session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${token}`))), { user: null, session: null });

	const stale = await route(request('/api/session', { method: 'DELETE' }), { user: null, session: null });
	assert.equal(stale.status, 200);
	assert.deepEqual(stale.headers.getSetCookie(), ['session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0']);
	await store.stop();
});

test('call answers who the asking connection is, and anonymous hears null', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	assert.deepEqual(session.call({}, { user: 'u_ada', session: 'AAAAAAAAAAAAAAAA' }), { user: 'u_ada' });
	assert.deepEqual(session.call({}, { user: null, session: null }), { user: null });
	assert.deepEqual(session.call({}, undefined), { user: null }, 'a context from another gate names nobody');
	await stop();
	await store.stop();
});

test('a module without a store in the loader props is refused loudly', async () => {
	const exports = await import('../src/modules/Session.ts');
	assert.throws(() => exports.default({ imports: {}, config: { cookie: 'session' }, extensions: {} }), /needs a store/);
});
