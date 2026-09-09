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

import { auth } from '../src/index.ts';
import { createAuth } from '../src/client.ts';
import type { Auth, FetchResponse } from '../src/client.ts';

import { fakeListener, newStore, page, reasonOf, settle } from './helpers.ts';
import type { Page } from './helpers.ts';

const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://app.test';
const URL = 'ws://app.test/';

type State = Record<string, unknown>;

interface Running {
	readonly store: Store;
	readonly seams: Page;
	stop(): Promise<void>;
}

const running = async (): Promise<Running> => {
	const store = newStore();
	const listening = fakeListener();
	const server = createServer({ sources: [auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	return {
		store,
		seams: page(listening.handlers),
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
	assert.equal(posts, 0, 'a stopped half calls no route at all');

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
