// The client half: identity over one connection, and the state document behind it.
//
// Every case runs against the real battery behind a real server, over a socket pair wired in
// memory and a fetch that calls the server's own request handler, so sign-in, the reconnect and
// the identity ask all happen with no port anywhere.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '@aweftjs/client';
import type { Client } from '@aweftjs/client';
import { createServer } from '@aweftjs/server';
import type { Store } from '@aweftjs/store';

import { fromBundle } from '@aweftjs/modules';

import { auth, mail } from '../src/index.ts';
import type { Roles } from '../src/index.ts';
import { createAuth } from '../src/client.ts';
import type { Auth, FetchResponse } from '../src/client.ts';

import { fakeListener, mailer, newStore, page, reasonOf, settle, tokenIn } from './helpers.ts';
import type { Page } from './helpers.ts';

const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://app.test';
const URL = 'ws://app.test/';

type State = Record<string, unknown>;

interface Running {
	readonly store: Store;
	readonly seams: Page;
	readonly roles: Roles;
	readonly mail: ReturnType<typeof mailer>;
	stop(): Promise<void>;
}

const url = (token: string): string => `${ORIGIN}/take?token=${token}`;

/** The battery behind a server, with `mail` and a stand-in for notify/Send when asked. */
const running = async (mailing = false): Promise<Running> => {
	const store = newStore();
	const listening = fakeListener();
	const sender = mailer();
	const configured = fromBundle({ 'auth/Verify.ts': { config: { url, resendMs: 1 } }, 'auth/Password.ts': { config: { url } } } as never, { prefix: '' });
	const notify = fromBundle({ 'notify/Send.ts': { default: () => sender } } as never, { prefix: '' });
	const server = createServer({ sources: mailing ? [configured, auth, mail, notify] : [auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	return {
		store,
		mail: sender,
		seams: page(listening.handlers),
		roles: server.loader.get('auth/Roles') as Roles,
		stop: async () => {
			await server.stop();
			await store.stop();
		},
	};
};

// The automatic retry is off everywhere below: every drop these cases make is one they made on
// purpose, and `reconnect()` answers it without a real timer in the way.
const connect = (seams: Page): { client: Client; auth: Auth } => {
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	return { client, auth: createAuth(client, { origin: ORIGIN, fetch: seams.fetch }) };
};

const answering = (status: number, body: unknown = {}): FetchResponse =>
	({ status, ok: status >= 200 && status < 300, json: async () => body });

test('user reads undefined, then null, then the id after enter, then null after leave', async () => {
	const { store, seams, stop } = await running();
	const { client, auth } = connect(seams);

	assert.equal(auth.user.get(), undefined, 'nothing is known until the server has answered');
	await settle();
	assert.equal(auth.user.get(), null, 'the first connection carries no cookie');

	const signedUp = await auth.enter('ada@example.com', PASSWORD);
	assert.equal('user' in signedUp, true);
	const ada = (signedUp as { user: string; created: boolean });
	assert.equal(ada.created, true, 'the email was new');
	assert.equal(auth.user.get(), ada.user, 'enter resolves once the new connection has answered');

	const state = await auth.state<State>().ready;
	state.theme = 'dark';
	await settle();
	const kept = await store.open(`state:${ada.user}`);
	assert.equal((kept.root as State).theme, 'dark', 'the write reached the store through the share');
	await store.close(kept);

	await auth.leave();
	assert.equal(auth.user.get(), null, 'signing out leaves the connection anonymous');
	await assert.rejects(auth.state<State>().ready, (error: Error) => reasonOf(error) === 'anonymous');

	const back = await auth.enter('ada@example.com', PASSWORD) as { user: string; created: boolean };
	assert.equal(back.created, false, 'the second time the email is known');
	assert.equal(back.user, ada.user, 'and it is the same account');
	const again = await auth.state<State>().ready;
	assert.equal(again.theme, 'dark', 'the new handle holds what the old one wrote');

	auth.stop();
	auth.stop();
	client.close();
	await stop();
});

test('enter carries extra fields to the sign-up rule, and a sign-up the rule closed the door to resolves with its reason', async () => {
	const store = newStore();
	const listening = fakeListener();
	const gated = fromBundle({ 'auth/Enter.ts': { config: { refuseSignUp: ({ extra }: { extra: Record<string, unknown> }) => extra['invite'] === 'open-sesame' ? undefined : { code: 'invite', message: 'sign-up is by invitation' } } } } as never, { prefix: '' });
	const server = createServer({ sources: [gated, auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	const { client, auth: session } = connect(page(listening.handlers));

	const closed = await session.enter('ada@example.com', PASSWORD) as { refused: readonly { code: string }[] };
	assert.deepEqual(closed.refused.map((one) => one.code), ['invite'], '403 resolves with the rule\'s reason');
	assert.equal(session.user.get(), null, 'and reconnects nothing');
	const opened = await session.enter('ada@example.com', PASSWORD, { invite: 'open-sesame' }) as { user: string; created: boolean };
	assert.equal(opened.created, true, 'the extra field reached the rule');
	assert.equal(session.user.get(), opened.user);

	session.stop();
	client.close();
	await server.stop();
	await store.stop();
});

test('a wrong password, a malformed address, a status nobody expects, and a fetch that throws', async () => {
	const { seams, stop } = await running();
	const { client, auth } = connect(seams);
	await auth.enter('ada@example.com', PASSWORD);

	const wrong = await auth.enter('ada@example.com', 'nope') as { refused: readonly { code: string }[] };
	assert.deepEqual(wrong.refused.map((one) => one.code), ['password'], '401 resolves with the module\'s reasons');
	const bad = await auth.enter('not-an-address', PASSWORD) as { refused: readonly { code: string }[] };
	assert.deepEqual(bad.refused.map((one) => one.code), ['email'], 'and so does 400');

	const odd = createAuth(client, { origin: ORIGIN, fetch: async () => answering(500) });
	await assert.rejects(odd.enter('ada@example.com', PASSWORD), (error: Error) =>
		reasonOf(error) === 'enter-failed' && /500/.test(error.message));
	odd.stop();

	const offline = createAuth(client, { origin: ORIGIN, fetch: () => { throw new Error('the network is gone'); } });
	await assert.rejects(offline.enter('ada@example.com', PASSWORD), /the network is gone/);
	offline.stop();

	// A refusal the route answers with no reasons in it still has the shape a page reads.
	const empty = createAuth(client, { origin: ORIGIN, fetch: async () => answering(401, {}) });
	assert.deepEqual(await empty.enter('ada@example.com', PASSWORD), { refused: [] });
	empty.stop();

	auth.stop();
	client.close();
	await stop();
});

test('leave refuses when the route does, and changes nothing', async () => {
	const { seams, stop } = await running();
	const { client, auth } = connect(seams);
	const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };

	const broken = createAuth(client, { origin: ORIGIN, fetch: async () => answering(503) });
	await assert.rejects(broken.leave(), (error: Error) => reasonOf(error) === 'leave-failed' && /503/.test(error.message));
	broken.stop();
	assert.equal(auth.user.get(), ada.user, 'the connection is still signed in');

	auth.stop();
	client.close();
	await stop();
});

test('state before the server has answered: it shares when there is a user, and refuses when there is not', async () => {
	const { seams, stop } = await running();

	const first = connect(seams);
	const waiting = first.auth.state<State>();
	assert.equal(waiting.document, undefined, 'nothing to read before the answer');
	await assert.rejects(waiting.ready, (error: Error) => reasonOf(error) === 'anonymous');
	first.auth.stop();
	first.client.close();

	// Sign in over HTTP alone: the jar now holds the cookie, so the next socket is Ada's.
	const signUp = await seams.fetch(`${ORIGIN}/api/session`, {
		method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: 'ada@example.com', password: PASSWORD }), credentials: 'same-origin',
	});
	assert.equal(signUp.status, 201);

	const second = connect(seams);
	const held = second.auth.state<State>();
	assert.equal(held.document, undefined);
	const document = await held.ready;
	assert.equal(held.document, document, 'the handle reads through to the share it made');

	second.auth.stop();
	second.client.close();
	await stop();
});

test('a state handle stopped before the answer arrives shares nothing', async () => {
	const { seams, stop } = await running();
	const { client, auth } = connect(seams);

	const waiting = auth.state<State>();
	let settled = 'pending';
	void waiting.ready.then(() => { settled = 'shared'; }, () => { settled = 'refused'; });
	waiting.stop();
	await settle();
	assert.equal(settled, 'pending', 'stopping the wait cancels it rather than refusing it');
	assert.equal(auth.user.get(), null);

	auth.stop();
	client.close();
	await stop();
});

test('asking for the state twice hands back one handle, and a new socket is what makes a new one', async () => {
	const { seams, stop } = await running();
	const { client, auth } = connect(seams);
	const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };

	const one = auth.state<State>();
	assert.equal(auth.state<State>(), one, 'one connection carries one state document');
	const document = await one.ready;
	document.theme = 'dark';
	await settle();

	// The server offers the topic once per socket, so a stopped handle is not reopened on the
	// connection that had it: the same one comes back, and only a new socket brings a new one.
	one.stop();
	assert.equal(auth.state<State>(), one, 'the connection has no second offer of state to give');

	await auth.leave();
	await auth.enter('ada@example.com', PASSWORD);
	const two = auth.state<State>();
	assert.notEqual(two, one, 'signing back in opened a socket, and this is its handle');
	assert.equal((await two.ready).theme, 'dark', 'holding what the first one wrote');
	assert.equal(auth.user.get(), ada.user);

	auth.stop();
	client.close();
	await stop();
});

test('an answer that arrives after stop is ignored, and one whose socket dropped leaves user alone', async () => {
	const { seams, stop } = await running();

	const stopping = connect(seams);
	// Registered after the client half's own watcher, so this runs once the ask is already out.
	stopping.client.status.watch((now) => { if (now === 'open') stopping.auth.stop(); });
	await settle();
	assert.equal(stopping.auth.user.get(), undefined, 'the answer came back to a half that had stopped');
	stopping.client.close();

	const dropping = connect(seams);
	let cut = false;
	dropping.client.status.watch((now) => {
		if (now !== 'open' || cut) return;
		cut = true;
		seams.sockets[seams.sockets.length - 1]!.close();
	});
	await settle();
	assert.equal(dropping.auth.user.get(), undefined, 'an ask that died with its socket says nothing');
	dropping.client.reconnect();
	await settle();
	assert.equal(dropping.auth.user.get(), null, 'the next socket asks again');

	dropping.auth.stop();
	dropping.client.close();
	await stop();
});

test('an unplanned drop keeps the last user, and the next socket refreshes it', async () => {
	const { seams, stop } = await running();
	const { client, auth } = connect(seams);
	const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };

	seams.sockets[seams.sockets.length - 1]!.close();
	await settle();
	assert.equal(client.status.get(), 'closed');
	assert.equal(auth.user.get(), ada.user, 'a drop is not a sign-out');

	client.reconnect();
	await settle();
	assert.equal(auth.user.get(), ada.user, 'and the new socket says the same thing');

	auth.stop();
	client.close();
	await stop();
});

test('check asks the module, and the status watcher goes on stop', async () => {
	const { seams, stop } = await running();
	const { client, auth } = connect(seams);
	await auth.enter('ada@example.com', PASSWORD);

	assert.equal(await auth.check('ada@example.com'), true);
	assert.equal(await auth.check('nobody@example.com'), false);

	auth.stop();
	const was = auth.user.get();
	client.reconnect();
	await settle();
	assert.equal(auth.user.get(), was, 'a stopped half asks nothing on the next socket');

	client.close();
	await stop();
});

test('origin comes from the page, and its absence is refused with a fix', async () => {
	const { seams, stop } = await running();
	const client = createClient({ url: URL, open: seams.open, reconnect: false });

	// The origin is read when a route is called, not when the auth is made, so a module holding
	// one is buildable with no page at all (design 245). The refusal is on the call.
	const outside = createAuth(client);
	await assert.rejects(() => outside.enter('ada@example.com', PASSWORD), (error: Error) =>
		reasonOf(error) === 'no-origin' && /Pass origin to createAuth/.test(error.message));
	await assert.rejects(() => outside.leave(), (error: Error) => reasonOf(error) === 'no-origin');
	outside.stop();

	const held = globalThis as { location?: unknown };
	for (const location of [{ origin: '' }, { origin: ORIGIN }]) {
		held.location = location;
		try {
			if (location.origin === '') {
				const empty = createAuth(client);
				await assert.rejects(() => empty.enter('ada@example.com', PASSWORD),
					(error: Error) => reasonOf(error) === 'no-origin');
				empty.stop();
				continue;
			}
			const auth = createAuth(client, { fetch: seams.fetch });
			const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };
			assert.equal(auth.user.get(), ada.user, 'the page origin reached the sign-in route');
			auth.stop();
		} finally {
			delete held.location;
		}
	}

	client.close();
	await stop();
});

test('an identity that changed underneath the page stops the handle the page holds', async () => {
	const { store, seams, stop } = await running();
	const { client, auth } = connect(seams);
	const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };

	const one = auth.state<State>();
	const document = await one.ready;

	// The server forgets the session while the page holds Ada's state, so the socket the client
	// opens next carries a cookie that names nothing.
	const token = seams.cookie().split('=')[1]!;
	const session = await store.open(`session:${token}`);
	(session.root as { status: string }).status = 'revoked';
	await store.settled(session);
	await store.close(session);

	client.reconnect();
	await settle(40);
	assert.equal(auth.user.get(), null, 'the connection came back as nobody');

	const two = auth.state<State>();
	assert.notEqual(two, one, 'the handle made for Ada is not handed out to whoever this is now');
	await assert.rejects(two.ready, (error: Error) => reasonOf(error) === 'anonymous');

	const kept = await store.open(`state:${ada.user}`);
	(kept.root as State).theme = 'written after the identity changed';
	await store.settled(kept);
	await store.close(kept);
	await settle(20);
	assert.equal((document as State).theme, undefined, 'the stopped handle follows the server no further');

	auth.stop();
	client.close();
	await stop();
});

test('every call on a stopped auth refuses at once, and none of them reaches the route', async () => {
	const { seams, stop } = await running();
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	let posts = 0;
	const auth = createAuth(client, {
		origin: ORIGIN,
		fetch: (url, init) => { posts += 1; return seams.fetch(url, init); },
	});
	await settle();
	auth.stop();

	const refuses = (error: Error): boolean =>
		reasonOf(error) === 'stopped' && /Make a new auth with createAuth/.test(error.message);
	await assert.rejects(auth.enter('ada@example.com', PASSWORD), refuses);
	await assert.rejects(auth.leave(), refuses);
	await assert.rejects(auth.check('ada@example.com'), refuses);
	await assert.rejects(auth.state<State>().ready, refuses);
	await assert.rejects(auth.verify(), refuses);
	await assert.rejects(auth.verify('AAAAAAAAAAAAAAAAAAAAAA'), refuses);
	await assert.rejects(auth.change(PASSWORD, PASSWORD), refuses);
	await assert.rejects(auth.forgot('ada@example.com'), refuses);
	await assert.rejects(auth.reset('AAAAAAAAAAAAAAAAAAAAAA', PASSWORD), refuses);
	assert.equal(posts, 0, 'a stopped half calls no route at all');
	assert.equal(auth.may('anything'), false, 'and holds nothing');

	client.close();
	await stop();
});

test('enter and leave refuse closed once the route has answered and the client is gone', async () => {
	const { seams, stop } = await running();
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	let posts = 0;
	const auth = createAuth(client, {
		origin: ORIGIN,
		fetch: (url, init) => { posts += 1; return seams.fetch(url, init); },
	});
	await settle();
	client.close();

	const gone = (error: Error): boolean =>
		reasonOf(error) === 'closed' && /the client is closed/.test(error.message);
	await assert.rejects(auth.enter('ada@example.com', PASSWORD), gone);
	assert.equal(posts, 1, 'the sign-in route had already answered when the client turned out to be closed');
	await assert.rejects(auth.leave(), gone);
	assert.equal(posts, 2);

	auth.stop();
	await stop();
});

test('a stopped auth asks nothing on the sockets that follow', async () => {
	const { seams, stop } = await running();
	const asked: string[] = [];
	const client = createClient({
		url: URL,
		reconnect: false,
		open: (url) => {
			const socket = seams.open(url);
			const send = socket.send;
			socket.send = (data) => {
				if (typeof data === 'string') asked.push(data);
				send(data);
			};
			return socket;
		},
	});
	const auth = createAuth(client, { origin: ORIGIN, fetch: seams.fetch });
	await settle();

	const sessions = (): number => asked.filter((frame) => frame.includes('auth/Session')).length;
	assert.equal(sessions(), 1, 'the first socket was asked who it is');

	auth.stop();
	client.reconnect();
	await settle();
	assert.equal(sessions(), 1, 'the status watcher is gone, so the next socket is asked nothing');

	client.close();
	await stop();
});

test('names reads undefined, then [] anonymous, then the granted list, follows a grant with no reconnect, and may agrees with the server', async () => {
	const { seams, roles, stop } = await running();
	const { client, auth } = connect(seams);

	assert.equal(auth.names.get(), undefined, 'nothing is known until the server has answered');
	assert.equal(auth.may('reports'), false);
	await settle();
	assert.deepEqual(auth.names.get(), [], 'anonymous holds nothing');

	const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };
	await settle();
	assert.deepEqual(auth.names.get(), [], 'signed in and granted nothing yet');
	const seen: unknown[] = [];
	const off = auth.names.watch((now) => { seen.push(now); });
	await roles.grant(ada.user, 'reports', 'products.abc123');
	await settle();
	assert.deepEqual(auth.names.get(), ['reports', 'products.abc123'], 'the grant reached the page over the share');
	assert.deepEqual(seen, [['reports', 'products.abc123']], 'and the cell fired once for the one commit');
	assert.equal(auth.may('reports.monthly'), true, 'covered by a granted name');
	assert.equal(auth.may('products.abc123.read'), true);
	assert.equal(auth.may('products.def456.read'), false);
	assert.equal(await roles.may(ada.user, 'products.def456.read'), false, 'the same answer the server gives');
	await roles.revoke(ada.user, 'reports');
	await settle();
	assert.equal(auth.may('reports'), false, 'a revoke too');
	off();

	await auth.leave();
	assert.deepEqual(auth.names.get(), [], 'anonymous again');
	await roles.grant(ada.user, 'admin');
	await settle();
	assert.deepEqual(auth.names.get(), [], 'a grant to a person the page is not reaches it not');
	await auth.enter('ada@example.com', PASSWORD);
	await settle();
	assert.deepEqual(auth.names.get(), ['products.abc123', 'admin'], 'the new socket shares the document again');
	assert.equal(auth.may('anything'), false, 'no table on this server, so admin covers admin');
	assert.equal(auth.may('admin.console'), true);

	auth.stop();
	assert.deepEqual(auth.names.get(), ['products.abc123', 'admin'], 'stop leaves the last value alone');
	await roles.grant(ada.user, 'later');
	await settle();
	assert.deepEqual(auth.names.get(), ['products.abc123', 'admin'], 'and follows the server no further');
	client.close();
	await stop();
});

test('may runs the table the server answered, so admin: [*] on the server is everything on the page', async () => {
	const store = newStore();
	const listening = fakeListener();
	const configured = fromBundle({ 'auth/Roles.ts': { config: { implies: { admin: ['*'] }, first: ['admin'] } } } as never, { prefix: '' });
	const server = createServer({ sources: [configured, auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	const seams = page(listening.handlers);
	const { client, auth: page1 } = connect(seams);
	await settle();
	await page1.enter('ada@example.com', PASSWORD);
	await settle();
	assert.deepEqual(page1.names.get(), ['admin'], 'the first to sign up');
	assert.equal(page1.may('posts.delete'), true, 'through the table');
	assert.equal(page1.may(''), false, 'text that is not a name is held by nobody, everything included');
	assert.equal(page1.may('two words'), false);
	page1.stop();
	client.close();
	await server.stop();
	await store.stop();
});

test('verify sends the mail and takes the link, forgot and reset set the password and sign the page out, change keeps it signed in', async () => {
	const { seams, mail, roles, stop } = await running(true);
	const { client, auth } = connect(seams);
	await settle();

	assert.deepEqual(await auth.verify(), { refused: [{ code: 'private', message: 'sign in to verify your email' }] }, 'anonymous cannot ask for the mail');
	const ada = await auth.enter('ada@example.com', PASSWORD) as { user: string };
	await settle();
	assert.deepEqual(await auth.verify(), { ok: true });
	assert.equal(mail.sent.length, 1);
	assert.equal(auth.may('verified'), false);
	assert.deepEqual(await auth.verify('not-a-token'), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] });
	assert.deepEqual(await auth.verify(tokenIn(mail.sent[0]!.body)), { ok: true });
	await settle();
	assert.equal(auth.may('verified'), true, 'the name reached the page with no reconnect');
	assert.equal(await roles.may(ada.user, 'verified'), true);
	await new Promise((done) => setTimeout(done, 5));
	assert.deepEqual(await auth.verify(), { refused: [{ code: 'verified', message: 'this email is already verified' }] });

	assert.deepEqual(await auth.change('wrong', 'battery staple horse'), { refused: [{ code: 'password', message: 'the current password is wrong' }] });
	assert.deepEqual(await auth.change(PASSWORD, 'short'), { refused: [{ code: 'password', message: 'password is 8 to 256 characters' }] });
	assert.deepEqual(await auth.change(PASSWORD, 'battery staple horse'), { ok: true });
	assert.equal(auth.user.get(), ada.user, 'still signed in on the session that asked');

	assert.deepEqual(await auth.forgot('not an address'), { refused: [{ code: 'email', message: 'email is an address' }] });
	assert.deepEqual(await auth.forgot('nobody@example.com'), { ok: true });
	assert.equal(mail.sent.length, 1, 'no mail for an address nobody has');
	assert.deepEqual(await auth.forgot('ada@example.com'), { ok: true });
	assert.equal(mail.sent.length, 2);
	assert.deepEqual(await auth.reset('AAAAAAAAAAAAAAAAAAAAAA', 'new horse battery'), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] });
	assert.equal(auth.user.get(), ada.user, 'a refusal reconnects nothing');
	assert.deepEqual(await auth.reset(tokenIn(mail.sent[1]!.body), 'new horse battery'), { ok: true });
	assert.equal(auth.user.get(), null, 'every session of the person is over, this page\'s included');
	assert.deepEqual(auth.names.get(), []);
	const back = await auth.enter('ada@example.com', 'new horse battery') as { user: string; created: boolean };
	assert.equal(back.created, false);
	await settle();
	assert.equal(auth.may('verified'), true, 'the name survived the reset');

	mail.answer({ ok: false, error: 'down' });
	assert.deepEqual(await auth.forgot('ada@example.com'), { refused: [{ code: 'mail', message: 'the mail could not be sent: down' }] });
	auth.stop();
	client.close();
	await stop();
});

test('the five calls reject <name>-failed with a fix for a status nobody expects, and reset refuses closed once the client is gone', async () => {
	const { seams, stop } = await running(true);
	let status = 500;
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const auth = createAuth(client, { origin: ORIGIN, fetch: async () => answering(status, {}) });
	await settle();
	const failing = (reason: string) => (error: Error): boolean => reasonOf(error) === reason && /mail source/.test(error.message);
	await assert.rejects(auth.verify(), failing('verify-failed'));
	await assert.rejects(auth.verify('AAAAAAAAAAAAAAAAAAAAAA'), failing('verify-failed'));
	await assert.rejects(auth.change('a', 'b'), failing('change-failed'));
	await assert.rejects(auth.forgot('ada@example.com'), failing('forgot-failed'));
	await assert.rejects(auth.reset('AAAAAAAAAAAAAAAAAAAAAA', 'b'), failing('reset-failed'));
	status = 200;
	client.close();
	await assert.rejects(auth.reset('AAAAAAAAAAAAAAAAAAAAAA', 'b'), (error: Error) => reasonOf(error) === 'closed');
	auth.stop();
	await stop();
});

test('a call with a body says it is JSON and one without sends no content type, on every route', async () => {
	const { seams, stop } = await running(true);
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const seen: [string, string, string | undefined][] = [];
	const auth = createAuth(client, {
		origin: ORIGIN,
		fetch: (url, init) => { seen.push([init.method, url.slice(ORIGIN.length), init.headers['content-type']]); return seams.fetch(url, init); },
	});
	await settle();
	await auth.enter('ada@example.com', PASSWORD);
	await auth.verify();
	await auth.change(PASSWORD, 'battery staple horse');
	await auth.forgot('ada@example.com');
	await auth.reset('AAAAAAAAAAAAAAAAAAAAAA', 'battery staple horse');
	await auth.verify('AAAAAAAAAAAAAAAAAAAAAA');
	await auth.leave();
	assert.deepEqual(seen, [
		['POST', '/api/session', 'application/json'],
		['POST', '/api/verify/send', undefined],
		['POST', '/api/password', 'application/json'],
		['POST', '/api/password/forgot', 'application/json'],
		['POST', '/api/password/reset', 'application/json'],
		['POST', '/api/verify', 'application/json'],
		['DELETE', '/api/session', undefined],
	]);
	auth.stop();
	client.close();
	await stop();
});

test('a roles module answering no table is held as an empty one, so may reads the names alone', async () => {
	const { createArray, createObject } = await import('@aweftjs/core');
	const store = newStore();
	const listening = fakeListener();
	// An application's own auth/Roles: shares the names, answers no table at all.
	const own = fromBundle({
		'auth/Roles.ts': {
			default: () => ({
				may: async () => true,
				first: async () => false,
				call: () => ({ implies: null }),
				connection: ({ link }: { link: { share(name: string, doc: object, handlers: object): void } }) => {
					link.share('roles', createObject({ names: createArray(['reports']) }), { accept: () => [] });
				},
			}),
		},
	} as never, { prefix: '' });
	const server = createServer({ sources: [own, auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	const seams = page(listening.handlers);
	const { client, auth: page1 } = connect(seams);
	await settle();
	await page1.enter('ada@example.com', PASSWORD);
	await settle();
	assert.deepEqual(page1.names.get(), ['reports']);
	assert.equal(page1.may('reports.monthly'), true);
	assert.equal(page1.may('admin'), false, 'no table, and no throw');
	page1.stop();
	client.close();
	await server.stop();
	await store.stop();
});
