// auth/Roles: the names a person holds, in the store and read live (design 289).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray } from '@aweftjs/core';

import type { Roles } from '../src/index.ts';
import type { Enter } from '../src/modules/Enter.ts';
import type { Session } from '../src/modules/Session.ts';

import { asClient, connectTo, fakeListener, jsonRequest, module, newStore, reasonOf, settle } from './helpers.ts';

test('may reads the store on every call: a grant is seen by the next check, a revoke too, and names is what was granted', async () => {
	const store = newStore();
	const { instance: roles } = await module<Roles>('Roles', store);

	assert.equal(await roles.may('u_1', 'reports'), false, 'nobody holds anything to start with');
	assert.equal(await store.head('roles:u_1'), 0, 'and a check writes no document');
	await roles.grant('u_1', 'reports');
	assert.equal(await roles.may('u_1', 'reports'), true);
	assert.equal(await roles.may('u_1', 'reports.monthly'), true, 'a granted name covers what is under it');
	assert.equal(await roles.may('u_1', 'admin'), false);
	assert.equal(await roles.may('u_2', 'reports'), false, 'another person holds nothing');
	await roles.grant('u_1', 'products.abc123', 'reports');
	assert.deepEqual(await roles.names('u_1'), ['reports', 'products.abc123'], 'a name granted twice is held once');
	assert.equal(await roles.may('u_1', 'products.abc123.read'), true);
	assert.equal(await roles.may('u_1', 'products.def456.read'), false);
	await roles.revoke('u_1', 'reports', 'never-held');
	assert.equal(await roles.may('u_1', 'reports'), false, 'a revoke is seen by the next check');
	assert.deepEqual(await roles.names('u_1'), ['products.abc123']);
	await roles.revoke('u_9', 'reports');
	assert.equal(await store.head('roles:u_9'), 0, 'a revoke from nobody writes nothing');
	assert.deepEqual(await roles.names('u_9'), []);

	const handle = await store.open('roles:u_1');
	assert.deepEqual([...(handle.root as { names: string[] }).names], ['products.abc123'], 'the document is the list');
	assert.equal(typeof (handle.root as { modifiedAt: number }).modifiedAt, 'number');
	await store.close(handle);
	await store.stop();
});

test('the table in config implies names transitively, the application extends it, and the call answers it', async () => {
	const store = newStore();
	const implies = { admin: ['*'], moderator: ['posts.delete'], member: ['products.read'] };
	const { instance: roles } = await module<Roles>('Roles', store, {}, { implies });
	await roles.grant('u_1', 'admin');
	await roles.grant('u_2', 'moderator');
	await roles.grant('u_3', 'member', 'products.abc123');
	assert.equal(await roles.may('u_1', 'anything.at.all'), true);
	assert.equal(await roles.may('u_2', 'posts.delete'), true);
	assert.equal(await roles.may('u_2', 'posts.edit'), false);
	assert.equal(await roles.may('u_3', 'products.abc123.read'), true, 'read of any product through the table');
	assert.equal(await roles.may('u_3', 'products.abc123.write'), true, 'every feature of one product through the grant');
	assert.equal(await roles.may('u_3', 'products.def456.write'), false);
	assert.deepEqual(JSON.parse(JSON.stringify(roles.call(undefined, undefined))), { implies }, 'the call answers the table');
	await store.stop();
});

test('a name that is not one is refused by grant and revoke, is held by nobody for may, and a table or a first that is not names is invalid-config', async () => {
	const store = newStore();
	const { instance: roles } = await module<Roles>('Roles', store);
	await roles.grant('u_1', '*');
	for (const bad of ['', 'two words', 7, null]) {
		await assert.rejects(roles.grant('u_1', bad as string), (error: unknown) => reasonOf(error) === 'invalid-name', JSON.stringify(bad));
		await assert.rejects(roles.revoke('u_1', bad as string), (error: unknown) => reasonOf(error) === 'invalid-name');
		assert.equal(await roles.may('u_1', bad as string), false, 'even everything covers no non-name');
	}
	await roles.revoke('u_1', '*');
	assert.deepEqual(await roles.names('u_1'), [], 'nothing was written on the way to a refusal');
	for (const config of [
		{ implies: null }, { implies: ['admin'] }, { implies: { 'two words': [] } }, { implies: { admin: 'star' } }, { implies: { admin: [''] } },
		{ first: 'admin' }, { first: [7] }, { first: ['admin', ' '] },
	]) {
		await assert.rejects(module<Roles>('Roles', store, {}, config), /invalid-config/, JSON.stringify(config));
	}
	await store.stop();
});

test('first grants the configured names to the first person to sign up and to nobody after, once even when two sign up at once, and to nobody where people already exist', async () => {
	const stubSession = { issue: async () => 'AAAAAAAAAAAAAAAAAAAAAA', setCookie: () => 'session=x' } as unknown as Session;
	const store = newStore();
	// A document of the application's own carrying an email is not a person, and does not count.
	const contact = await store.open('contact:1');
	(contact.root as Record<string, unknown>)['email'] = 'sales@example.com';
	await store.settled(contact);
	await store.close(contact);
	const { instance: roles } = await module<Roles>('Roles', store, {}, { first: ['admin', 'reports'] });
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': stubSession, 'auth/Roles': roles });

	const ada = await enter.enter('ada@example.com', 'correct horse');
	const bob = await enter.enter('bob@example.com', 'correct horse');
	assert.ok('user' in ada && 'user' in bob);
	assert.deepEqual(await roles.names(ada.user), ['admin', 'reports'], 'the first to sign up');
	assert.deepEqual(await roles.names(bob.user), [], 'and not the second');
	assert.equal(await roles.first(bob.user), false, 'asked again, still nobody');
	assert.equal(await store.head('roles:first'), 0, 'the marker is not in the roles namespace');
	assert.notEqual(await store.head('auth:first'), 0);

	// Two at once: one of them is the first, the other is not, and nobody is left out.
	const raced = newStore();
	const { instance: racing } = await module<Roles>('Roles', raced, {}, { first: ['admin'] });
	const [a, b] = await Promise.all([racing.first('u_a'), racing.first('u_b')]);
	assert.deepEqual([a, b].filter(Boolean).length, 1, `one first: ${String(a)}, ${String(b)}`);
	assert.deepEqual((await racing.names('u_a')).concat(await racing.names('u_b')), ['admin']);

	// A store where people already exist and `first` is configured afterwards: the module reads
	// the index once as it is made and writes the marker for nobody, so the next sign-up is a
	// stranger.
	const later = newStore();
	const { instance: quiet } = await module<Enter>('Enter', later, { 'auth/Session': stubSession, 'auth/Roles': { first: async () => false } });
	await quiet.enter('old@example.com', 'correct horse');
	const { instance: configured } = await module<Roles>('Roles', later, {}, { first: ['admin'] });
	assert.notEqual(await later.head('auth:first'), 0, 'the marker was written as the module was made');
	const { instance: enterLater } = await module<Enter>('Enter', later, { 'auth/Session': stubSession, 'auth/Roles': configured });
	const stranger = await enterLater.enter('new@example.com', 'correct horse');
	assert.ok('user' in stranger);
	assert.deepEqual(await configured.names(stranger.user), []);

	// No first configured: the first person is still the first, and holds nothing for it.
	const { instance: none } = await module<Roles>('Roles', newStore());
	assert.equal(await none.first('u_1'), true);
	assert.deepEqual(await none.names('u_1'), []);
	assert.equal(await none.first('u_2'), false);
	await store.stop();
	await raced.stop();
	await later.stop();
});

test('a user that is not text is refused by every call, and a grant or a revoke of no names writes nothing', async () => {
	const store = newStore();
	const { instance: roles } = await module<Roles>('Roles', store);
	for (const bad of [undefined, '', 7, null]) {
		await assert.rejects(roles.grant(bad as string, 'admin'), (error: unknown) => reasonOf(error) === 'invalid-user', JSON.stringify(bad));
		await assert.rejects(roles.revoke(bad as string, 'admin'), (error: unknown) => reasonOf(error) === 'invalid-user');
		await assert.rejects(roles.may(bad as string, 'admin'), (error: unknown) => reasonOf(error) === 'invalid-user');
		await assert.rejects(roles.names(bad as string), (error: unknown) => reasonOf(error) === 'invalid-user');
		await assert.rejects(roles.first(bad as string), (error: unknown) => reasonOf(error) === 'invalid-user');
	}
	await roles.grant('u_1');
	await roles.revoke('u_1');
	assert.equal(await store.head('roles:u_1'), 0, 'nothing was written');
	assert.equal(await store.head('roles:undefined'), 0);
	await store.stop();
});

test('an implies key that is an object property is a name in the table, and a name nobody holds implies nothing', async () => {
	const store = newStore();
	const implies = { constructor: ['posts.delete'], hasOwnProperty: ['reports'] };
	const { instance: roles } = await module<Roles>('Roles', store, {}, { implies });
	await roles.grant('u_1', 'constructor');
	await roles.grant('u_2', 'hasOwnProperty');
	assert.equal(await roles.may('u_1', 'posts.delete'), true);
	assert.equal(await roles.may('u_1', 'reports'), false);
	assert.equal(await roles.may('u_2', 'reports'), true);
	assert.equal(await roles.may('u_3', 'toString'), false, 'a property of Object is not a name anyone holds');
	await roles.grant('u_3', 'toString');
	assert.equal(await roles.may('u_3', 'toString.tag'), true, 'until it is granted');
	assert.deepEqual(JSON.parse(JSON.stringify(roles.call(undefined, undefined))), { implies });
	await store.stop();
});

test('the connection shares roles:<user> read-only, and a grant reaches the page while the socket is open', async () => {
	const store = newStore();
	const listening = fakeListener();
	const { createServer } = await import('@aweftjs/server');
	const { auth } = await import('../src/index.ts');
	const server = createServer({ sources: [auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	const roles = server.loader.get('auth/Roles') as Roles;

	const signed = await listening.handlers().request(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'correct horse' }), { address: '1.1.1.1' });
	assert.equal(signed.status, 201);
	const { user } = await signed.json() as { user: string };
	const cookie = signed.headers.getSetCookie()[0]!.split(';')[0]!;

	const page = asClient(await connectTo(listening.handlers(), cookie));
	const shared = await page.link.share<{ names?: string[] }>('roles').ready;
	assert.deepEqual([...(shared.names ?? [])], []);
	await roles.grant(user, 'reports');
	await settle();
	assert.deepEqual([...(shared.names ?? [])], ['reports'], 'the grant reached the page with no reconnect');

	// The page's write is refused, and the server's copy is unchanged; and writing names into the
	// state document, which is the user's to write, grants nothing either.
	shared.names!.push('admin');
	await settle();
	assert.deepEqual(await roles.names(user), ['reports']);
	assert.equal(await roles.may(user, 'admin'), false);
	const state = await page.link.share<Record<string, unknown>>('state').ready;
	state['names'] = createArray(['admin']);
	state['role'] = 'admin';
	await settle();
	assert.equal(await roles.may(user, 'admin'), false, 'the state document is not where names live');

	const anonymous = asClient(await connectTo(listening.handlers()));
	const nothing = anonymous.link.share('roles');
	await settle();
	assert.equal(nothing.document, undefined, 'an anonymous connection is offered no roles topic');
	nothing.stop();

	assert.deepEqual(await page.asks.ask('auth/Roles'), { implies: {} }, 'the call answers the table');
	await assert.rejects(anonymous.asks.ask('auth/Roles'), (error: unknown) => reasonOf(error) === 'refused', 'and not to anonymous');

	page.socket.close();
	anonymous.socket.close();
	await server.stop();
	await store.stop();
});
