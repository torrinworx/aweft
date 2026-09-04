// auth/State: the user's state document, shared on their connection and let go of when it ends.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Accepting, GatedLink } from '@aweftjs/server';

import type { State } from '../src/modules/State.ts';

import { module, newStore, request } from './helpers.ts';

const fakeLink = () => {
	const shares: { name: string; document: unknown; handlers: Accepting }[] = [];
	const link: GatedLink = {
		share: (name, document, handlers) => {
			shares.push({ name, document, handlers });
			return { document, ready: Promise.resolve(document), resync: () => {}, stop: () => {} } as never;
		},
	};
	return { link, shares };
};

test('a signed-in connection shares state:<user> from the store, accepting every commit, and closes it at the end', async () => {
	const store = newStore();
	const { instance: state } = await module<State>('State', store);
	const { link, shares } = fakeLink();
	const end = await state.connection({ link, request: request('/ws'), context: { user: 'u_ada', session: 't' }, close: () => {} });

	assert.equal(shares.length, 1);
	assert.equal(shares[0]!.name, 'state');
	assert.deepEqual(shares[0]!.handlers.accept({ deltas: [] }), []);
	const held = await store.open('state:u_ada');
	assert.equal(held.root, shares[0]!.document, 'the shared document is the store\'s live one');
	(held.root as Record<string, unknown>).theme = 'dark';
	await store.settled(held);
	await store.close(held);

	await end();
	const reopened = await store.open('state:u_ada');
	assert.equal((reopened.root as Record<string, unknown>).theme, 'dark', 'what was written is what comes back');
	await store.close(reopened);
	await store.stop();
});

test('an anonymous connection reaching this private module is a loud error, not an empty state', async () => {
	const store = newStore();
	const { instance: state } = await module<State>('State', store);
	const { link, shares } = fakeLink();
	await assert.rejects(state.connection({ link, request: request('/ws'), context: { user: null, session: null }, close: () => {} }), /anonymous connection reached a private module/);
	assert.equal(shares.length, 0);
	await store.stop();
});
