// The whole battery behind the server, over an in-memory connection: what a browser does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { fromBundle } from '@aweftjs/modules';
import { createServer } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';

import { loadServer } from '@aweftjs/testing';

import { auth } from '../src/index.ts';
import type { AuthContext } from '../src/index.ts';
import type { Session } from '../src/modules/Session.ts';

import { asClient, connectTo, fakeListener, jsonRequest, newStore, peer, reasonOf, request, settle } from './helpers.ts';

const started = async () => {
	const store = newStore();
	const seen: string[] = [];
	const app = fromBundle({
		'./app/Private.ts': { default: () => ({ connection: ({ context }: Connection<AuthContext>) => { seen.push(`private saw ${String(context.user)}`); }, call: () => 'private' }) },
		'./app/Public.ts': { default: () => ({ public: true, call: () => 'public' }) },
	});
	const listening = fakeListener();
	const server = createServer({ sources: [app, auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	return { store, seen, handlers: listening.handlers(), server };
};

test('sign up over HTTP, connect with the cookie, share the state, sign out, and the old cookie is anonymous', async () => {
	const { store, seen, handlers, server } = await started();

	const signUp = await handlers.request(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'correct horse' }), peer);
	assert.equal(signUp.status, 201);
	const { user } = await signUp.json() as { user: string };
	const cookie = signUp.headers.getSetCookie()[0]!.split(';')[0]!;
	assert.match(cookie, /^session=[A-Za-z0-9_-]{22}$/);

	const ada = asClient(await connectTo(handlers, cookie));
	const state = await ada.link.share<Record<string, unknown>>('state').ready;
	await settle();
	state.theme = 'dark';
	await settle();
	assert.deepEqual(seen, ['private saw ' + user]);
	assert.equal(await ada.asks.ask('app/Private'), 'private');
	assert.equal(await ada.asks.ask('app/Public'), 'public');
	assert.equal(JSON.stringify(await ada.asks.ask('auth/Session')), `{"user":"${user}"}`, 'the connection can ask who it is');
	ada.socket.close();
	await settle();
	const kept = await store.open(`state:${user}`);
	assert.equal((kept.root as Record<string, unknown>).theme, 'dark', 'the client\'s write is in the store');
	await store.close(kept);

	const anonymous = asClient(await connectTo(handlers));
	assert.equal(await anonymous.asks.ask('app/Public'), 'public');
	assert.equal(await anonymous.asks.ask('app/Private').catch(reasonOf), 'refused');
	assert.equal(JSON.stringify(await anonymous.asks.ask('auth/Session')), '{"user":null}', 'and an anonymous one hears null');
	assert.equal(await anonymous.asks.ask('auth/Check', { email: 'ada@example.com' }).then((r) => JSON.stringify(r)), '{"exists":true}');
	anonymous.socket.close();

	const garbage = asClient(await connectTo(handlers, 'session=garbage'));
	assert.equal(await garbage.asks.ask('app/Private').catch(reasonOf), 'refused', 'a cookie that is not a token connects, as anonymous');
	garbage.socket.close();
	assert.equal((await handlers.request(request('/api/session', { method: 'DELETE', headers: { cookie: 'session=garbage' } }), peer)).status, 200, 'and can always clear itself');

	const signOut = await handlers.request(request('/api/session', { method: 'DELETE', headers: { cookie } }), peer);
	assert.equal(signOut.status, 200);
	const stale = asClient(await connectTo(handlers, cookie));
	assert.equal(await stale.asks.ask('app/Private').catch(reasonOf), 'refused', 'after sign-out the old cookie is anonymous');
	stale.socket.close();
	await server.stop();
	await store.stop();
});

test('a private route is 403 to an anonymous request, and the auth routes are reachable to it', async () => {
	const { handlers, server, store } = await started();
	assert.equal((await handlers.request(request('/api/session', { method: 'DELETE' }), peer)).status, 200, 'sign-out is public');
	assert.equal((await handlers.request(jsonRequest('/api/session', 'POST', {}), peer)).status, 400, 'sign-in is public');
	assert.equal((await handlers.request(request('/nothing'), peer)).status, 404);
	await server.stop();
	await store.stop();
});

test('mail beside the real notify battery: the verification link and the reset link go through its own sender, and the two flows work end to end over HTTP', async () => {
	const { notify } = await import('@aweftjs/notify');
	const { mail } = await import('../src/index.ts');
	const store = newStore();
	const mails: { to: string; subject: string; text: string; html: string }[] = [];
	const configured = fromBundle({
		'./auth/Verify.ts': { config: { url: (token: string) => `http://app.test/verify?token=${token}`, resendMs: 1 } },
		'./auth/Password.ts': { config: { url: (token: string) => `http://app.test/reset?token=${token}` } },
		'./notify/Send.ts': { config: { email: async (one: { to: string; subject: string; text: string; html: string }) => { mails.push(one); return { ok: true }; } } },
	});
	const listening = fakeListener();
	const server = createServer({ sources: [configured, auth, mail, notify], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	const handlers = listening.handlers();
	const post = (path: string, body: unknown, cookie?: string) => handlers.request(jsonRequest(path, 'POST', body, cookie), peer);

	const signUp = await post('/api/session', { email: 'ada@example.com', password: 'correct horse' });
	const cookie = signUp.headers.getSetCookie()[0]!.split(';')[0]!;
	const { user } = await signUp.json() as { user: string };

	assert.equal((await post('/api/verify/send', {})).status, 401, 'anonymous cannot ask for the mail');
	assert.equal((await post('/api/verify/send', {}, cookie)).status, 200);
	assert.equal(mails.length, 1);
	assert.equal(mails[0]!.to, 'ada@example.com', 'notify read the address off the user document');
	assert.equal(mails[0]!.subject, 'Verify your email address');
	const verifyToken = mails[0]!.text.slice(mails[0]!.text.indexOf('token=') + 6);
	assert.ok(mails[0]!.html.includes(`http://app.test/verify?token=${verifyToken}`));
	assert.equal((await post('/api/verify', { token: verifyToken })).status, 401, 'opened with no cookie, the link is refused and left (design 322)');
	const taken = await post('/api/verify', { token: verifyToken }, cookie);
	assert.equal(taken.status, 200);
	assert.deepEqual(await taken.json(), { user });
	const page = asClient(await connectTo(handlers, cookie));
	const roles = await page.link.share<{ names?: string[] }>('roles').ready;
	assert.deepEqual([...(roles.names ?? [])], ['verified'], 'the name is on the page');
	page.socket.close();

	assert.equal((await post('/api/password/forgot', { email: 'ada@example.com' })).status, 200);
	assert.equal(mails.length, 2);
	assert.equal(mails[1]!.subject, 'Reset your password');
	const resetToken = mails[1]!.text.slice(mails[1]!.text.indexOf('token=') + 6);
	assert.equal((await post('/api/password/reset', { token: resetToken, password: 'battery staple' })).status, 200);
	assert.equal((await handlers.request(request('/api/session', { method: 'DELETE', headers: { cookie } }), peer)).status, 200);
	assert.equal((await post('/api/session', { email: 'ada@example.com', password: 'correct horse' })).status, 401, 'the old password is gone');
	assert.equal((await post('/api/session', { email: 'ada@example.com', password: 'battery staple' })).status, 200);

	await server.stop();
	await store.stop();
});

test('ending a session closes its open connections, and only those', async () => {
	const store = newStore();
	const running = await loadServer({ sources: [auth], store, gate: 'auth/Gate' });
	const session = running.server.loader.get('auth/Session') as Session;
	const enter = async (email: string): Promise<{ user: string; cookie: string; token: string }> => {
		const answer = await running.fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'correct horse' }) });
		const cookie = answer.headers.getSetCookie()[0]!.split(';')[0]!;
		return { user: (await answer.json() as { user: string }).user, cookie, token: cookie.slice('session='.length) };
	};
	const open = async (cookie?: string) => (await running.open(cookie === undefined ? {} : { headers: { cookie } })).socket;
	const OPEN = 1;
	const CLOSED = 3;

	// Ada on three devices, one of them with two tabs; Bo; and a visitor.
	const [phone, laptop, desk] = [await enter('ada@example.com'), await enter('ada@example.com'), await enter('ada@example.com')];
	const bo = await enter('bo@example.com');
	const sockets = {
		phoneOne: await open(phone.cookie), phoneTwo: await open(phone.cookie),
		laptop: await open(laptop.cookie), desk: await open(desk.cookie),
		bo: await open(bo.cookie), visitor: await open(),
	};
	await settle();
	const states = (): Record<string, number> => Object.fromEntries(Object.entries(sockets).map(([name, socket]) => [name, socket.readyState]));
	assert.deepEqual(states(), { phoneOne: OPEN, phoneTwo: OPEN, laptop: OPEN, desk: OPEN, bo: OPEN, visitor: OPEN });

	assert.equal(await session.revoke(phone.token), true);
	await settle();
	assert.deepEqual(states(), { phoneOne: CLOSED, phoneTwo: CLOSED, laptop: OPEN, desk: OPEN, bo: OPEN, visitor: OPEN }, 'revoke closes every connection of that session and no other');

	assert.equal(await session.revokeAll(phone.user, laptop.token), 1);
	await settle();
	assert.deepEqual(states(), { phoneOne: CLOSED, phoneTwo: CLOSED, laptop: OPEN, desk: CLOSED, bo: OPEN, visitor: OPEN }, 'revokeAll leaves the kept session connected');

	const tablet = await enter('ada@example.com');
	const late = await open(tablet.cookie);
	await settle();
	assert.equal(await session.revokeAll(phone.user), 2);
	await settle();
	assert.deepEqual(states(), { phoneOne: CLOSED, phoneTwo: CLOSED, laptop: CLOSED, desk: CLOSED, bo: OPEN, visitor: OPEN }, 'revokeAll with nothing kept closes them all, and another person and a visitor stay');
	assert.equal(late.readyState, CLOSED);

	// What a page does next is connect again, and the cookie it still holds names nobody.
	const back = await running.open({ headers: { cookie: laptop.cookie } });
	assert.equal(JSON.stringify(await back.asks.ask('auth/Session')), '{"user":null}');
	back.socket.close();

	assert.equal((await running.fetch('/api/session', { method: 'DELETE', headers: { cookie: bo.cookie } })).status, 200);
	await settle();
	assert.deepEqual([sockets.bo.readyState, sockets.visitor.readyState], [CLOSED, OPEN], 'signing out closes the sockets of the session that asked');

	sockets.visitor.close();
	await running.stop();
	await store.stop();
});

test('mail listed without notify fails start with missing, naming notify/Send', async () => {
	const { mail } = await import('../src/index.ts');
	const store = newStore();
	const configured = fromBundle({
		'./auth/Verify.ts': { config: { url: (token: string) => token } },
		'./auth/Password.ts': { config: { url: (token: string) => token } },
	});
	const server = createServer({ sources: [configured, auth, mail], store, gate: 'auth/Gate', listener: fakeListener().listener });
	await assert.rejects(server.start(), (error: Error) => reasonOf(error) === 'missing' && /notify\/Send/.test(error.message));
	await store.stop();
});
