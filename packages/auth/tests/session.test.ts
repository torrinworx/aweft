// auth/Session: sessions as documents, the cookie, and who a request is (design 074).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore, memoryDriver } from '@aweftjs/store';
import type { Connection, GatedLink } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

import type { AuthContext } from '../src/index.ts';
import type { Enter } from '../src/modules/Enter.ts';
import type { Password } from '../src/modules/Password.ts';
import type { Session, SessionDocument } from '../src/modules/Session.ts';
import type { Verify } from '../src/modules/Verify.ts';

import { fieldsOf, mailer, module, newStore, request, someToken, stored, withCookie, writePlain } from './helpers.ts';

/** A connection as the server hands one to a hook, with every call of its `close` counted. */
const connection = (context: AuthContext): { handed: Connection<AuthContext>; closed(): number } => {
	let closed = 0;
	return { handed: { link: {} as GatedLink, request: request('/ws'), context, close: () => { closed += 1; } }, closed: () => closed };
};

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

	const held = await store.open(stored('session', token));
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
	const unknown = someToken();
	assert.deepEqual(contextOf(await session.whoIs(withCookie('/', `session=${unknown}`))), { user: null, session: null, address: undefined }, 'a token of the right shape that names nothing');
	assert.deepEqual((await store.scan(10)).map((found) => found.doc), [], 'and neither name it could have is written');
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
	const handle = await store.open(stored('session', token));
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
	const held = await store.open(stored('session', revoked));
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
	assert.equal(await store.head(stored('session', revoked)), 0);
	assert.equal(await store.head(stored('session', expired)), 0);
	assert.ok(await store.head(stored('session', live)) > 0, 'a session with no end is never swept');
	assert.ok(await store.head(stored('session', recent)) > 0, 'one revoked just now is inside keep');
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
	assert.ok(await store.head(stored('session', old)) > 0, 'still there until something sweeps');
	const { stop: stopSecond } = await module<Session>('Session', store, {}, { keep: 1 });
	assert.equal(await store.head(stored('session', old)), 0, 'swept as the module was made');
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

test('revokeAll ends every active session of one person but the one named, counts what it ended, and leaves everyone else alone', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	const [a, b, c] = [await session.issue('u_1'), await session.issue('u_1'), await session.issue('u_1')];
	const other = await session.issue('u_2');
	await session.revoke(c);
	const live = async (token: string): Promise<boolean> => {
		const who = await session.whoIs(withCookie('/', `session=${token}`));
		return 'context' in who && who.context.user !== null;
	};

	assert.equal(await session.revokeAll('u_1', a), 1, 'b was the one active session besides the kept one');
	assert.equal(await live(a), true, 'the kept one');
	assert.equal(await live(b), false);
	assert.equal(await live(other), true, 'another person');
	assert.equal(await session.revokeAll('u_1'), 1, 'now the kept one goes too');
	assert.equal(await live(a), false);
	assert.equal(await session.revokeAll('u_1'), 0, 'nothing left to end');
	assert.equal(await session.revokeAll('u_nobody'), 0);
	await stop();
	await store.stop();
});

test('the connection hook keeps a signed-in connection until it ends, and never an anonymous one', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	const token = await session.issue('u_ada');
	const signedIn: AuthContext = { user: 'u_ada', session: token, address: undefined };

	const open = connection(signedIn);
	const endOpen = await session.connection(open.handed);
	assert.equal(typeof endOpen, 'function', 'a kept connection hands back its ending');
	const ended = connection(signedIn);
	const end = await session.connection(ended.handed);
	const anonymous = connection({ user: null, session: null, address: undefined });
	assert.equal(await session.connection(anonymous.handed), undefined, 'an anonymous connection is not kept, so it has no ending');

	(end as () => void)();
	assert.equal(await session.revoke(token), true);
	assert.equal(open.closed(), 1, 'the open connection of the session is closed');
	assert.equal(ended.closed(), 0, 'one that had ended was forgotten, so nothing calls its close');
	assert.equal(anonymous.closed(), 0);
	// The server runs the ending once the socket it closed is gone.
	(endOpen as () => void)();
	await session.revoke(token);
	assert.equal(open.closed(), 1, 'so nothing is left to close a second time');
	await stop();
	await store.stop();
});

test('a session that ended between the handshake and the hook is closed by the hook', async () => {
	const store = newStore();
	const { instance: session, stop } = await module<Session>('Session', store);
	const token = await session.issue('u_ada');
	// The handshake read the session live; the revoke lands before any hook has run.
	const identified = await session.whoIs(withCookie('/ws', `session=${token}`));
	await session.revoke(token);
	const late = connection(contextOf(identified));
	assert.equal(await session.connection(late.handed), undefined);
	assert.equal(late.closed(), 1, 'the socket of a session that is over does not stay open');
	await stop();
	await store.stop();
});

// --- a token is stored as its hash, and the names the version before wrote are still read (design 324)

const anonymous: AuthContext = { user: null, session: null, address: undefined };
const who = async (session: Session, token: string): Promise<AuthContext> => contextOf(await session.whoIs(withCookie('/', `session=${token}`)));
const active = (user: string): SessionDocument => ({ user, expires: null, status: 'active', createdAt: 1_700_000_000_000 });

test('no stored document name holds a token that was handed out, for a session, a verification link or a reset link', async () => {
	const store = newStore();
	const mail = mailer();
	const link = (token: string): string => `https://app.example/?token=${token}`;
	const { instance: session, stop } = await module<Session>('Session', store);
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const { instance: verify } = await module<Verify>('Verify', store, { 'auth/Roles': { grant: async () => {} }, 'notify/Send': mail }, { url: link });
	const { instance: password } = await module<Password>('Password', store, { 'auth/Session': session, 'auth/Enter': enter, 'notify/Send': mail }, { url: link });
	const made = await enter.enter('ada@example.com', 'correct horse');
	assert.ok('user' in made);

	const cookie = await session.issue(made.user);
	await verify.send(made.user);
	await password.forgot('ada@example.com');
	const [verifyToken, resetToken] = [mail.sent[0]!.body, mail.sent[1]!.body].map((body) => body.slice(body.indexOf('token=') + 'token='.length)) as [string, string];

	const names = (await store.scan(100)).map((found) => found.doc);
	for (const token of [cookie, verifyToken, resetToken]) {
		assert.deepEqual(names.filter((name) => name.includes(token)), [], 'a copy of the store holds nothing that works as a credential');
	}
	assert.ok(names.includes(stored('session', cookie)), 'the session is named by the SHA-256 of its token');
	assert.ok(names.includes(stored('verify', verifyToken)));
	assert.ok(names.includes(stored('reset', resetToken)));
	assert.equal((await who(session, cookie)).session, cookie, 'and the context still carries the token itself');
	verify.stop();
	password.stop();
	await stop();
	await store.stop();
});

test('a session stored under its token is honoured by whoIs, and afterwards exists only under its hash', async () => {
	const store = newStore();
	const token = someToken();
	await writePlain(store, 'session', token, active('u_ada'));
	// Made after the document, as a new version starts beside the one that wrote it.
	const { instance: session, stop } = await module<Session>('Session', store);
	assert.deepEqual(await fieldsOf(store, `session:${token}`), active('u_ada'), 'the sweep run as the module is made leaves it where the other version finds it');
	assert.equal(await store.head(stored('session', token)), 0);

	assert.deepEqual(await who(session, token), { user: 'u_ada', session: token, address: undefined }, 'nobody is signed out by the move to hashed names');
	assert.equal(await store.head(`session:${token}`), 0, 'the plain document is gone');
	assert.deepEqual(await fieldsOf(store, stored('session', token)), active('u_ada'), 'and the hashed one holds the same fields');
	assert.deepEqual(await who(session, token), { user: 'u_ada', session: token, address: undefined }, 'found by its hash from then on');
	await stop();
	await store.stop();
});

test('the timed sweep moves every plain session to its hash, whatever its status, and the sweep run as the module is made moves none', async () => {
	const store = newStore();
	const [live, revoked] = [someToken(), someToken()];
	const ended: SessionDocument = { user: 'u_bo', expires: Date.now() - 1000, status: 'revoked', createdAt: 1_700_000_000_000 };
	await writePlain(store, 'session', live, active('u_ada'));
	await writePlain(store, 'session', revoked, ended);
	const { stop } = await module<Session>('Session', store, {}, { sweepMs: 40 });
	assert.notEqual(await store.head(`session:${live}`), 0, 'still plain once the module is made');
	assert.notEqual(await store.head(`session:${revoked}`), 0);

	for (let waited = 0; waited < 3000 && await store.head(`session:${revoked}`) !== 0; waited += 20) await new Promise((done) => setTimeout(done, 20));
	assert.deepEqual((await store.scan(10)).map((found) => found.doc).sort(), [stored('session', live), stored('session', revoked)].sort(), 'no stored name is a token any more');
	assert.deepEqual(await fieldsOf(store, stored('session', live)), active('u_ada'));
	assert.deepEqual(await fieldsOf(store, stored('session', revoked)), ended, 'a session that was over is moved as over');
	await stop();
	await store.stop();
});

test('a connection whose session cannot be read is not kept: the hook throws, and a later revoke calls nothing', async () => {
	const real = newStore();
	let down = false;
	const store = new Proxy(real, { get: (target, key) => (key === 'head' ? async (name: string) => { if (down) throw new Error('store down'); return target.head(name); } : (target as never)[key]) });
	const { instance, stop } = await module<Session>('Session', store as typeof real);
	const token = await instance.issue('u_ada');
	let closed = 0;
	down = true;
	await assert.rejects(instance.connection({ link: {} as GatedLink, request: request('/ws'), context: { user: 'u_ada', session: token, address: undefined }, close: () => { closed += 1; } }), /store down/);
	down = false;
	await instance.revoke(token);
	assert.equal(closed, 0, 'the server closes a connection whose hook threw, so nothing of it is left to close');
	await stop();
	await real.stop();
});

test('revoke and revokeAll end a session stored under its token, keep the one named, and close its connections', async () => {
	const store = newStore();
	const [one, two, kept] = [someToken(), someToken(), someToken()];
	for (const token of [one, two, kept]) await writePlain(store, 'session', token, active('u_ada'));
	const { instance: session, stop } = await module<Session>('Session', store);
	const hashed = await session.issue('u_ada');
	const onTwo = connection({ user: 'u_ada', session: two, address: undefined });
	const onKept = connection({ user: 'u_ada', session: kept, address: undefined });
	await session.connection(onTwo.handed);
	await session.connection(onKept.handed);

	assert.equal(await session.revoke(one), true);
	assert.deepEqual(await who(session, one), anonymous);
	assert.equal(await session.revoke(one), false, 'already over');

	assert.equal(await session.revokeAll('u_ada', kept), 2, 'the other plain one and the hashed one');
	assert.deepEqual(await who(session, two), anonymous);
	assert.deepEqual(await who(session, hashed), anonymous);
	assert.equal((await who(session, kept)).user, 'u_ada', 'except names a token, and a plain session is kept by it');
	assert.deepEqual([onTwo.closed(), onKept.closed()], [1, 0]);

	assert.equal(await session.revokeAll('u_ada'), 1);
	assert.deepEqual(await who(session, kept), anonymous);
	assert.equal(onKept.closed(), 1);
	await stop();
	await store.stop();
});

test('a revoked or expired session stored under its token is not revived by the move, nor is one whose revoke lands as it moves', async () => {
	const store = newStore();
	const [revoked, expired, stale, racedOne, racedTwo] = [someToken(), someToken(), someToken(), someToken(), someToken()];
	await writePlain(store, 'session', revoked, { ...active('u_ada'), status: 'revoked', expires: Date.now() - 1000 });
	await writePlain(store, 'session', expired, { ...active('u_ada'), expires: Date.now() - 1000 });
	// A move that stopped half way: the hashed copy was revoked later, the plain one still says active.
	await writePlain(store, 'session', stale, active('u_ada'));
	await writePlain(store, 'session', stored('session', stale).slice('session:'.length), { ...active('u_ada'), status: 'revoked', expires: Date.now() - 1000 });
	await writePlain(store, 'session', racedOne, active('u_ada'));
	await writePlain(store, 'session', racedTwo, active('u_ada'));
	const { instance: session, stop } = await module<Session>('Session', store);

	for (const token of [revoked, expired, stale]) assert.deepEqual(await who(session, token), anonymous, 'over before the move');
	// The first sight of a plain session moves it; a revoke in flight beside that must win, in either order.
	await Promise.all([who(session, racedOne), session.revoke(racedOne)]);
	await Promise.all([session.revoke(racedTwo), who(session, racedTwo)]);
	assert.deepEqual(await who(session, racedOne), anonymous, 'the revoke was not lost to the move');
	assert.deepEqual(await who(session, racedTwo), anonymous);

	assert.equal(await session.sweep(), 0, 'inside keep, so nothing is removed; what is plain is moved');
	const names = (await store.scan(20)).map((found) => found.doc);
	for (const token of [revoked, expired, stale, racedOne, racedTwo]) {
		assert.ok(!names.includes(`session:${token}`), 'no plain name is left');
		assert.deepEqual(await who(session, token), anonymous, 'and over after the move');
	}
	assert.equal((await fieldsOf(store, stored('session', stale)))!.status, 'revoked', 'a hashed document that is already there is not written over');
	await stop();
	await store.stop();
});

test('a revoke that lands on the plain document while it is being moved is carried to the hashed one', async () => {
	const store = newStore();
	const token = someToken();
	await writePlain(store, 'session', token, active('u_ada'));
	// The move's first write to the hashed document waits here while a revoke runs to its end.
	// The revoke finds the plain document, and no hashed one: a driver that writes over a
	// network answers head 0 until the write has landed, which the memory driver never shows.
	let armed = false;
	let revoking = false;
	const held: { session?: Session } = {};
	const pausing: Store = {
		...store,
		head: async (name) => (revoking && name === stored('session', token) ? 0 : store.head(name)),
		settled: async (handle) => {
			if (armed) {
				armed = false;
				revoking = true;
				assert.equal(await held.session!.revoke(token), true, 'the revoke found the session active');
				revoking = false;
			}
			return store.settled(handle);
		},
	};
	const { instance: session, stop } = await module<Session>('Session', pausing);
	held.session = session;

	armed = true;
	assert.deepEqual(await who(session, token), anonymous, 'the request that set the move off is not let in');
	assert.equal(armed, false, 'the revoke did run inside the move');
	assert.equal(await store.head(`session:${token}`), 0, 'the move finished');
	assert.equal((await fieldsOf(store, stored('session', token)))!.status, 'revoked', 'and what it left is over');
	assert.deepEqual(await who(session, token), anonymous);
	await stop();
	await store.stop();
});
