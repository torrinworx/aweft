// The tests an application writes for itself, at the two levels worth writing at.
//
// The first needs nothing running: one module, its dependencies stubbed. The second boots the
// real server with the real battery and signs somebody in, which is the only way to find out
// whether the gate, the cookie and the socket agree with each other.
//
// Run: node --import @aweftjs/build/loader --test recipes/full-stack/tests/*.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import { loadModule, loadServer } from '@aweftjs/testing';

import Mine from '../backend/modules/board/Mine.ts';

const modules = fileURLToPath(new URL('../backend/modules', import.meta.url));

// --- one module, nothing running --------------------------------------------------------------

test('board/Mine answers with whoever asked', async () => {
	const { instance, stop } = await loadModule({ exports: { default: Mine } });
	const board = instance as { call(args: unknown, context: { user: string }): string };
	assert.equal(board.call(null, { user: 'u_1' }), 'the board of u_1');
	await stop();
});

// --- the whole backend, signed in -------------------------------------------------------------

/** What the harness deliberately does not ship: this battery's sign-up, in five lines. */
const signUp = async (server: Awaited<ReturnType<typeof loadServer>>, email: string): Promise<string> => {
	const answer = await server.fetch('/api/session', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password: 'correct horse battery staple' }),
	});
	assert.equal(answer.status, 201, `${email} could not sign up`);
	return answer.headers.getSetCookie()[0]!;
};

const backend = async () => loadServer({
	sources: [fromDirectory(modules), auth],
	store: createStore({ driver: memoryDriver(), declare: { ...paths } }),
	gate: 'auth/Gate',
});

test('the public call is answered before anyone has signed in', async () => {
	const server = await backend();
	const page = await server.open();
	assert.equal(await page.asks.ask('board/Notice'), 'the board is open to everyone');
	await server.stop();
});

test('the gated call refuses a connection with no cookie', async () => {
	const server = await backend();
	const page = await server.open();
	await assert.rejects(() => page.asks.ask('board/Mine'));
	await server.stop();
});

test('the same call answers once the socket carries the cookie', async () => {
	const server = await backend();
	const cookie = await signUp(server, 'someone@example.test');

	const page = await server.open({ headers: { cookie } });
	const answer = await page.asks.ask('board/Mine');
	assert.match(String(answer), /^the board of /, 'the gate read the cookie off the handshake');
	await server.stop();
});
