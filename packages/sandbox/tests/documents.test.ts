// The documents an application names cross the link both ways (design 281), the room's asks
// go through the host's client for granted names (design 280), and the route document holds
// its shape against a room that writes what it should not (design 282). Through the public
// surface, with the far end held here where the test must play the room.

import test from 'node:test';
import assert from 'node:assert/strict';

import { atomic, createArray, createObject, intercept, mutable, observer } from '@aweftjs/core';
import { type ClientLike, createSandbox, inProcess } from '@aweftjs/sandbox';
import { type Entered, enter } from '@aweftjs/sandbox/inside';
import { type Channel, connect, inProcess as pair } from '@aweftjs/sync';

import { countingClient, document, grantsOf, reasonOf, until } from './helpers.ts';

/** A runner whose room is this test: the far end is whoever calls `far()`. */
const held = (): { runner: { start(): Promise<Channel>; stop(): Promise<void> }; far: () => Channel } => {
	const [near, there] = pair();
	return { runner: { start: async () => near, stop: async () => { there.close(); } }, far: () => there };
};

/** The far end run here, over the held channel, so its `share`, `ask` and `status` can be read. */
const entered = async (make: ReturnType<typeof held>, forward?: { errors?: boolean; console?: boolean }): Promise<Entered> =>
	enter(make.far(), forward === undefined ? {} : { forward });

const fakeClient = (answer: (name: string, args: unknown) => unknown): ClientLike & { status: ReturnType<typeof mutable<string>> } => {
	const status = mutable('connecting');
	return { status, ask: async (name, args) => answer(name, args) };
};

test('a document the host names arrives in the room, and writes cross both ways once each', async () => {
	const state = createObject<Record<string, unknown>>({ count: 0, note: '' });
	const hostSeen: number[] = [];
	const make = held();
	const sandbox = await createSandbox({ runner: make.runner, modules: document({}), grants: grantsOf(), documents: { state } });
	const room = await entered(make);
	const copy = await room.share<typeof state>('state').ready;
	assert.equal(copy.count, 0, 'the host\'s state arrived');

	const roomSeen: number[] = [];
	observer(copy).path('count').watch(() => { roomSeen.push(copy.count as number); });
	observer(state).path('count').watch(() => { hostSeen.push(state.count as number); });

	copy.count = 1;
	await until('the room write reaching the host', () => state.count === 1);
	state.count = 2;
	await until('the host write reaching the room', () => copy.count === 2);
	await new Promise((done) => setTimeout(done, 20));
	assert.deepEqual(hostSeen, [1, 2], 'the host heard the room\'s write and its own, once each');
	assert.deepEqual(roomSeen, [1, 2], 'the room heard its own write and the host\'s, once each, with no echo');

	assert.equal(room.share('state'), room.share('state'), 'one handle per name');
	await sandbox.stop();
});

test('a guard on the host\'s copy refuses a room write, and the room hears the refusal', async () => {
	const state = createObject<Record<string, unknown>>({ count: 0 });
	const stopGuard = intercept(state, (commit) =>
		commit.deltas.some((d) => d.ref.kind === 'object' && d.ref.key === 'count' && typeof d.value === 'number' && d.value < 0)
			? [{ code: 'no-negatives', message: 'a count does not go below zero' }]
			: []);
	const make = held();
	const sandbox = await createSandbox({ runner: make.runner, modules: document({}), grants: grantsOf(), documents: { state } });
	const room = await entered(make);
	const copy = await room.share<typeof state>('state').ready;
	// The refusal reaches the room as the host's copy staying put and its own diverging, which
	// is what design 066 says of the module document too.
	copy.count = -1;
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(state.count, 0, 'the host\'s copy never took the write');
	assert.equal(copy.count, -1, 'the room\'s copy diverged, as with the module document');
	copy.count = 5;
	await until('an acceptable write', () => state.count === 5);
	stopGuard();
	await sandbox.stop();
});

test('reserved names and a document that is not observable are refused by name before the room starts', async () => {
	let started = 0;
	const runner = { start: async () => { started += 1; return inProcess().start(); }, stop: async () => {} };
	for (const name of ['modules', 'room', 'calls', 'route']) {
		await assert.rejects(
			createSandbox({ runner, modules: document({}), grants: grantsOf(), documents: { [name]: createObject() } }),
			(e) => reasonOf(e) === 'reserved' && String((e as Error).message).includes(name),
			name,
		);
	}
	await assert.rejects(
		createSandbox({ runner, modules: document({}), grants: grantsOf(), documents: { plain: { not: 'observable' } } }),
		(e) => reasonOf(e) === 'malformed' && String((e as Error).message).includes('documents.plain'),
	);
	assert.equal(started, 0, 'the runner never started');
});

test('the control document lists the documents, and share of an unlisted name is refused at once', async () => {
	const make = held();
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(),
		documents: { state: createObject(), settings: createArray() },
	});
	const link = connect(make.far());
	const control = await link.share<{ documents: string[]; console: string[]; status: string; page: unknown }>('room').ready;
	assert.deepEqual([...control.documents].sort(), ['settings', 'state']);
	assert.deepEqual([...control.console], ['error', 'warn'], 'the default levels');
	assert.equal(control.status, 'closed', 'no client, so closed');
	assert.equal(control.page, null, 'a compute room has no page');
	link.close();
	await sandbox.stop();

	const again = held();
	const second = await createSandbox({ runner: again.runner, modules: document({}), grants: grantsOf(), documents: { state: createObject() }, console: ['log'] });
	const room = await entered(again);
	assert.throws(() => room.share('secrets'), (e: Error) => reasonOf(e) === 'not-shared' && /documents/.test(String((e as { fix?: string }).fix)));
	assert.doesNotThrow(() => room.share('state'));
	await second.stop();
});

test('ask is refused for an ungranted name and with no client, answered for a granted one, and a refusal crosses with its reason', async () => {
	const withoutClient = held();
	const bare = await createSandbox({ runner: withoutClient.runner, modules: document({}), grants: grantsOf(['notes/Export']) });
	const bareRoom = await entered(withoutClient);
	await assert.rejects(bareRoom.ask('notes/Export', {}), (e) => reasonOf(e) === 'refused' && /no client/.test(String((e as Error).message)));
	await bare.stop();

	const asked: [string, unknown][] = [];
	const client = fakeClient((name, args) => {
		asked.push([name, args]);
		if (name === 'notes/Refuse') {
			throw Object.assign(new Error('the month is closed'), { reason: 'closed-month', reasons: [{ code: 'closed-month' }] });
		}
		return { rows: 3, echo: args };
	});
	const make = held();
	const grants = grantsOf(['notes/Export', 'notes/Refuse']);
	const sandbox = await createSandbox({ runner: make.runner, modules: document({}), grants, client });
	const room = await entered(make);

	assert.deepEqual(await room.ask('notes/Export', { month: '2026-09' }), { rows: 3, echo: { month: '2026-09' } });
	assert.deepEqual(asked, [['notes/Export', { month: '2026-09' }]], 'the page\'s client was asked with the args');

	await assert.rejects(room.ask('notes/Secret', {}), (e) => reasonOf(e) === 'refused' && /not granted/.test(String((e as Error).message)));
	assert.equal(asked.length, 1, 'an ungranted ask never reached the client');

	const crossed = await room.ask('notes/Refuse').catch((e: unknown) => e) as Error & { reason: string };
	assert.equal(crossed.reason, 'closed-month', 'the server\'s reason crossed');
	assert.equal(crossed.message, 'the month is closed', 'with its message');

	grants.splice(grants.indexOf('notes/Export'), 1);
	await assert.rejects(room.ask('notes/Export'), (e) => reasonOf(e) === 'refused', 'a name taken off the grants refuses from the next ask');
	await sandbox.stop();
});

test('status mirrors the client\'s cell into the room, and stopping the sandbox lets go of it', async () => {
	const client = countingClient(() => null);
	const make = held();
	const sandbox = await createSandbox({ runner: make.runner, modules: document({}), grants: grantsOf(), client });
	const room = await entered(make);
	assert.equal(client.live, 1, 'the sandbox follows the cell with one effect');
	assert.equal(room.status.get(), 'connecting', 'the status the client had when the room was made');
	const seen: string[] = [];
	const stop = room.status.effect((value) => { seen.push(value); });
	client.set('open');
	await until('open in the room', () => room.status.get() === 'open');
	client.set('closed');
	await until('closed in the room', () => room.status.get() === 'closed');
	assert.deepEqual(seen, ['connecting', 'open', 'closed']);
	assert.throws(() => room.status.set('forged'), 'the mirror is read-only in the room');
	stop();
	await sandbox.stop();
	assert.equal(client.live, 0, 'nothing of the sandbox is left on the cell');
});

test('the route document crosses only with a page, and the host refuses a room write that could leave the tail, is too long or holds a control character', async () => {
	const make = held();
	const route = createObject<Record<string, unknown>>({ url: '/', key: 'e1', move: 'push', seq: 0 });
	const sandbox = await createSandbox({
		runner: make.runner, modules: document({}), grants: grantsOf(),
		page: { act: 'app/Main', route },
	});
	const room = await entered(make);
	assert.deepEqual(room.page, { act: 'app/Main' });
	assert.ok(room.route !== null, 'the route document arrived');
	const copy = room.route!;
	assert.equal(copy.url, '/');

	atomic(() => { copy.url = '/notes/3'; copy.move = 'push'; copy.seq = 1; });
	await until('an honest push', () => route.seq === 1);
	assert.equal(route.url, '/notes/3');

	for (const bad of ['notes', '//evil.test/x', '/\\evil', '/a/../../x', '/a/%2e%2e/x', '/a/.%2E/x', '/./x', '/a\\..\\x', `/${'a'.repeat(8192)}`, '/x\nconnect', '/x?y=\u007f']) {
		atomic(() => { copy.url = bad; copy.move = 'push'; copy.seq = copy.seq as number + 1; });
		await new Promise((done) => setTimeout(done, 20));
		assert.equal(route.url, '/notes/3', `the host never applied ${bad}`);
	}
	assert.equal(route.seq, 1, 'and none of the refused commits moved seq');

	copy.key = 'forged';
	await new Promise((done) => setTimeout(done, 20));
	assert.equal(route.key, 'e1', 'the room does not write the key');
	atomic(() => { (copy as Record<string, unknown>).move = 'sideways'; copy.seq = 20; });
	await new Promise((done) => setTimeout(done, 20));
	assert.equal(route.seq, 1, 'a move outside the three is refused');
	(copy as Record<string, unknown>).extra = 'a fifth slot';
	await new Promise((done) => setTimeout(done, 20));
	assert.equal('extra' in route, false, 'the document gains no slot');

	atomic(() => { copy.url = '/x?back=/../y#../z'; copy.move = 'replace'; copy.seq = 30; });
	await until('a query and a hash may hold anything', () => route.seq === 30);
	assert.equal(route.url, '/x?back=/../y#../z');

	atomic(() => { route.url = '/from/page'; route.key = 'e2'; });
	await until('the host\'s move reaching the room', () => copy.key === 'e2');
	assert.equal(copy.url, '/from/page');
	await sandbox.stop();

	await assert.rejects(
		createSandbox({ runner: inProcess(), modules: document({}), grants: grantsOf(), page: { act: 'app/Main', route: { url: '/' } } }),
		(e) => reasonOf(e) === 'malformed',
	);
	await assert.rejects(
		createSandbox({ runner: inProcess(), modules: document({}), grants: grantsOf(), page: { act: 7 as unknown as string, route } }),
		(e) => reasonOf(e) === 'malformed',
	);
});
