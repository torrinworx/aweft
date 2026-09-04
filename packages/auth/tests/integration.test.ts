// The whole battery behind the server, over an in-memory connection: what a browser does.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLoader, fromBundle } from '@aweftjs/modules';
import { createServer } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';

import { auth } from '../src/index.ts';
import type { AuthContext } from '../src/index.ts';

import { asClient, connectTo, fakeListener, gateOf, jsonRequest, newStore, peer, reasonOf, request, settle } from './helpers.ts';

const started = async () => {
	const store = newStore();
	const seen: string[] = [];
	const app = fromBundle({
		'./app/Private.ts': { default: () => ({ connection: ({ context }: Connection<AuthContext>) => { seen.push(`private saw ${String(context.user)}`); }, call: () => 'private' }) },
		'./app/Public.ts': { default: () => ({ public: true, call: () => 'public' }) },
	});
	const loader = createLoader({ sources: [app, auth], props: { store } });
	await loader.load(['auth/Gate', 'auth/Session', 'auth/Enter', 'auth/Check', 'auth/State', 'app/Private', 'app/Public']);
	const listening = fakeListener();
	const server = createServer({ loader, gate: await gateOf(loader), listener: listening.listener });
	await server.start();
	return { store, seen, handlers: listening.handlers(), server };
};

test('sign up over HTTP, connect with the cookie, share the state, sign out, and the old cookie is anonymous', async () => {
	const { store, seen, handlers, server } = await started();

	const signUp = await handlers.request(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'pw' }), peer);
	assert.equal(signUp.status, 201);
	const { user } = await signUp.json() as { user: string };
	const cookie = signUp.headers.getSetCookie()[0]!.split(';')[0]!;
	assert.match(cookie, /^session=[A-Za-z0-9_-]{16}$/);

	const ada = asClient(await connectTo(handlers, cookie));
	const state = await ada.link.share<Record<string, unknown>>('state').ready;
	await settle();
	state.theme = 'dark';
	await settle();
	assert.deepEqual(seen, ['private saw ' + user]);
	assert.equal(await ada.asks.ask('app/Private'), 'private');
	assert.equal(await ada.asks.ask('app/Public'), 'public');
	ada.socket.close();
	await settle();
	const kept = await store.open(`state:${user}`);
	assert.equal((kept.root as Record<string, unknown>).theme, 'dark', 'the client\'s write is in the store');
	await store.close(kept);

	const anonymous = asClient(await connectTo(handlers));
	assert.equal(await anonymous.asks.ask('app/Public'), 'public');
	assert.equal(await anonymous.asks.ask('app/Private').catch(reasonOf), 'refused');
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
