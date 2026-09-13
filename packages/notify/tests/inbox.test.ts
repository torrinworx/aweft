// notify/Inbox: the share on every connection of a user, the page's write refused, the read
// call, the trim, and the document let go when nothing holds it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';
import type { Store } from '@aweftjs/store';

import type { Inbox, Item } from '../src/index.ts';

import { anyone, asUser, connectTo, newStore, reasonOf, settle, signUp, started, wait } from './helpers.ts';

const user = 'ada';

interface Root { items: Item[] }

const share = async (client: Awaited<ReturnType<typeof connectTo>>): Promise<Root> => client.link.share<Root>('inbox').ready;

test('a send lands on every connection of the user live, and on the next connection from the store', async () => {
	const running = await started({ gate: asUser(user) });
	const a = await connectTo(running.handlers);
	const b = await connectTo(running.handlers);
	const inboxA = await share(a);
	const inboxB = await share(b);
	const sent = await running.send.send({ to: { user }, title: 'hello', body: 'there' });
	await settle();
	assert.equal(inboxA.items.length, 1);
	assert.equal(inboxB.items.length, 1);
	assert.equal(inboxA.items[0]!.id, sent.id);
	assert.equal(inboxB.items[0]!.title, 'hello');
	assert.equal(inboxB.items[0]!.delivery, JSON.stringify({ inbox: { ok: true } }));
	a.socket.close();
	b.socket.close();
	await settle();
	const c = await connectTo(running.handlers);
	const inboxC = await share(c);
	assert.equal(inboxC.items.length, 1, 'a later connection reads it from the store');
	c.socket.close();
	await running.stop();
});

test('a page\'s commit into the inbox is refused read-only and the item is unchanged on the other end', async () => {
	const running = await started({ gate: asUser(user) });
	await running.send.send({ to: { user }, title: 'keep me' });
	const a = await connectTo(running.handlers);
	const refusals: unknown[] = [];
	const inbox = await a.link.share<Root>('inbox', undefined, { refused: (report) => { refusals.push(report.reasons); } }).ready;
	const b = await connectTo(running.handlers);
	const other = await share(b);
	(inbox.items[0] as { title: string }).title = 'changed by the page';
	inbox.items.push(createObject<Item>({ id: 'fake', at: 0, level: 'info', title: 'forged', body: '', url: null, tag: null, readAt: null, delivery: '{}' }));
	await settle();
	assert.equal(refusals.length, 2);
	assert.deepEqual((refusals[0] as { code: string }[]).map((r) => r.code), ['read-only']);
	assert.equal(other.items.length, 1);
	assert.equal(other.items[0]!.title, 'keep me');
	// The page's own copy keeps its write until the next connection, when the server's state
	// wins (design 184): the client's handle offers no resync, so nothing here can yield sooner.
	assert.equal(inbox.items[0]!.title, 'changed by the page');
	assert.equal(inbox.items.length, 2);
	a.socket.close();
	b.socket.close();
	const again = await connectTo(running.handlers);
	const fresh = await share(again);
	assert.deepEqual(fresh.items.map((item) => item.title), ['keep me']);
	again.socket.close();
	await running.stop();
});

test('read marks the caller\'s own items, all or by id, answers how many changed, and the other connection sees it', async () => {
	const running = await started({ gate: asUser(user) });
	const one = await running.send.send({ to: { user }, title: 'one' });
	const two = await running.send.send({ to: { user }, title: 'two' });
	await running.send.send({ to: { user }, title: 'three' });
	const a = await connectTo(running.handlers);
	const b = await connectTo(running.handlers);
	await share(a);
	const other = await share(b);
	assert.deepEqual(await a.asks.ask('notify/Inbox', { read: [one.id, 'no-such'] }), { marked: 1 });
	await settle();
	assert.equal(typeof other.items[0]!.readAt, 'number');
	assert.equal(other.items[1]!.readAt, null);
	assert.deepEqual(await a.asks.ask('notify/Inbox', { read: [one.id, two.id] }), { marked: 1 }, 'an item already read is not counted again');
	assert.deepEqual(await a.asks.ask('notify/Inbox', { read: 'all' }), { marked: 1 });
	assert.deepEqual(await a.asks.ask('notify/Inbox', { read: [] }), { marked: 0 });
	await settle();
	assert.ok(other.items.every((item) => typeof item.readAt === 'number'));
	for (const bad of [{ read: 'some' }, { read: [1] }, {}, null, 'all']) {
		await assert.rejects(a.asks.ask('notify/Inbox', bad), (error: unknown) => reasonOf(error) === 'invalid-call');
	}
	a.socket.close();
	b.socket.close();
	await running.stop();
});

test('an anonymous connection is shared nothing and its call is anonymous under an open gate, refused under the auth gate', async () => {
	const failed: string[] = [];
	const running = await started({ gate: anyone, failed });
	const a = await connectTo(running.handlers);
	await assert.rejects(a.asks.ask('notify/Inbox', { read: 'all' }), (error: unknown) => reasonOf(error) === 'anonymous');
	// No topic is offered to it either: a share waits, and no inbox document was made for nobody.
	const offered = await Promise.race([share(a).then(() => true), wait(100).then(() => false)]);
	assert.equal(offered, false, 'the topic is not offered to an anonymous connection');
	assert.equal(await running.store!.head('inbox:null'), 0, 'and no document was opened for it');
	a.socket.close();
	await settle();
	assert.deepEqual(failed, [], 'the connection hook did not throw for the anonymous socket');
	await running.stop();

	const gated = await started({ withAuth: true });
	const anonymous = await connectTo(gated.handlers);
	await assert.rejects(anonymous.asks.ask('notify/Inbox', { read: 'all' }), (error: unknown) => reasonOf(error) === 'refused');
	anonymous.socket.close();
	const { user: id, cookie } = await signUp(gated.handlers, 'ada@example.com');
	const signedIn = await connectTo(gated.handlers, cookie);
	const inbox = await share(signedIn);
	await gated.send.send({ to: { user: id }, title: 'for you' });
	await settle();
	assert.equal(inbox.items.length, 1);
	signedIn.socket.close();
	await gated.stop();
});

test('with no store the call says no-store and the connection is shared nothing', async () => {
	const failed: string[] = [];
	const running = await started({ store: null, gate: asUser(user), failed });
	const a = await connectTo(running.handlers);
	await assert.rejects(a.asks.ask('notify/Inbox', { read: 'all' }), (error: unknown) => reasonOf(error) === 'no-store');
	a.socket.close();
	await settle();
	assert.deepEqual(failed, []);
	await running.stop();
});

test('the inbox keeps the newest `keep` items and drops the oldest', async () => {
	const running = await started({ gate: asUser(user), config: { './notify/Inbox.ts': { config: { keep: 3 } } } });
	for (const title of ['one', 'two', 'three', 'four', 'five']) await running.send.send({ to: { user }, title });
	const a = await connectTo(running.handlers);
	const inbox = await share(a);
	assert.deepEqual(inbox.items.map((item) => item.title), ['three', 'four', 'five']);
	a.socket.close();
	await running.stop();
});

test('the document is let go idleMs after the last holder, and held while a connection has it', async () => {
	const store = newStore();
	let closes = 0;
	const counted: Store = { ...store, close: async (handle) => { closes += 1; await store.close(handle); } };
	const running = await started({ store: counted, gate: asUser(user), config: { './notify/Inbox.ts': { config: { idleMs: 40 } } } });
	await running.send.send({ to: { user }, title: 'to nobody' });
	assert.equal(closes, 0, 'held for a moment after the send');
	await wait(15);
	assert.equal(closes, 0, 'still held before idleMs has passed');
	await wait(65);
	assert.equal(closes, 1, 'let go once idle');
	const a = await connectTo(running.handlers);
	await share(a);
	await running.send.send({ to: { user }, title: 'to a page' });
	await wait(80);
	assert.equal(closes, 1, 'the connection still holds it');
	a.socket.close();
	await wait(80);
	assert.equal(closes, 2, 'let go once the connection ended and the idle passed');
	await running.stop();
});

test('a configuration out of shape is invalid-config at load', async () => {
	for (const config of [{ keep: 0 }, { keep: 'many' }, { idleMs: 0 }, { idleMs: 2_147_483_648 }]) {
		await assert.rejects(started({ config: { './notify/Inbox.ts': { config } } }), (error: unknown) => reasonOf(error) === 'invalid-config');
	}
});

test('two first writes to one inbox open the document once', async () => {
	const store = newStore();
	let opens = 0;
	const counted: Store = { ...store, open: async (doc, kind) => { opens += 1; return store.open(doc, kind); } };
	const running = await started({ store: counted, gate: asUser(user) });
	const inbox = running.server.loader.get('notify/Inbox') as Inbox;
	const item = (id: string): Item => ({ id, at: 1, level: 'info', title: id, body: '', url: null, tag: null, readAt: null, delivery: '{}' });
	await Promise.all([inbox.append(user, item('a')), inbox.append(user, item('b'))]);
	assert.equal(opens, 1);
	const a = await connectTo(running.handlers);
	const shared = await share(a);
	assert.deepEqual(shared.items.map((one) => one.id), ['a', 'b']);
	// A delivery record for an item that has since fallen off the list writes nothing and throws nothing.
	await inbox.delivered(user, 'gone', { inbox: { ok: true } });
	a.socket.close();
	await running.stop();
});
