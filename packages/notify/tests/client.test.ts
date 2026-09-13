// The client half: a user's inbox over a real client against a real server on a socket pair.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '@aweftjs/client';

import { createInbox } from '../src/client.ts';

import { anyone, asUser, pageSockets, reasonOf, settle, signUp, started } from './helpers.ts';

const URL = 'ws://app.test/';
const user = 'ada';

test('ready settles with the items, unread follows sends and reads, and read marks them', async () => {
	const running = await started({ gate: asUser(user) });
	await running.send.send({ to: { user }, title: 'before the page opened' });
	const seams = pageSockets(() => running.handlers);
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const inbox = createInbox(client);
	assert.equal(inbox.items, undefined, 'nothing before ready');
	assert.equal(inbox.unread.get(), 0);
	const items = await inbox.ready;
	assert.equal(items.length, 1);
	assert.equal(inbox.items, items);
	assert.equal(inbox.unread.get(), 1);

	const counts: number[] = [];
	inbox.unread.watch((n) => { counts.push(n); });
	await running.send.send({ to: { user }, title: 'live', body: 'while open' });
	await settle();
	assert.equal(items.length, 2, 'the list the page holds grew');
	assert.equal(items[1]!.title, 'live');
	assert.equal(inbox.unread.get(), 2);

	assert.equal(await inbox.read([items[0]!.id]), 1);
	await settle();
	assert.equal(inbox.unread.get(), 1);
	assert.equal(typeof items[0]!.readAt, 'number');
	assert.equal(await inbox.read(), 1);
	await settle();
	assert.equal(inbox.unread.get(), 0);
	assert.deepEqual(counts, [2, 1, 0]);

	assert.equal(await inbox.register({ device: 'phone', platform: 'android', transport: 'fcm', endpoint: 'tok' }), 1);
	assert.equal(await inbox.forget('phone'), 0);

	inbox.stop();
	inbox.stop();
	await assert.rejects(inbox.read(), (error: unknown) => reasonOf(error) === 'stopped');
	await assert.rejects(inbox.register({ device: 'p', platform: 'web', transport: 'none' }), (error: unknown) => reasonOf(error) === 'stopped');
	assert.equal(inbox.items, undefined, 'the handle is let go');
	// A send after stop does not move the count, and neither does a write into the list the page
	// still holds: the watcher is gone with the share.
	await running.send.send({ to: { user }, title: 'after stop' });
	await settle();
	(items[0] as { readAt: number | null }).readAt = null;
	assert.equal(inbox.unread.get(), 0);
	client.close();
	await running.stop();
});

test('an anonymous page hears the refusal at once instead of waiting for a topic that never comes', async () => {
	const gated = await started({ withAuth: true });
	const seams = pageSockets(() => gated.handlers);
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const inbox = createInbox(client);
	await assert.rejects(inbox.ready, (error: unknown) => reasonOf(error) === 'refused');
	assert.equal(inbox.items, undefined);
	client.close();

	// Under a gate with no users at all, the module itself says so.
	const open = await started({ gate: anyone });
	const bare = createClient({ url: URL, open: pageSockets(() => open.handlers).open, reconnect: false });
	await assert.rejects(createInbox(bare).ready, (error: unknown) => reasonOf(error) === 'anonymous');
	bare.close();
	await open.stop();

	// Signed in, the same page gets its inbox.
	const { user: id, cookie } = await signUp(gated.handlers, 'ada@example.com');
	const signedIn = createClient({ url: URL, open: pageSockets(() => gated.handlers, cookie).open, reconnect: false });
	const mine = createInbox(signedIn);
	const items = await mine.ready;
	await gated.send.send({ to: { user: id }, title: 'welcome' });
	await settle();
	assert.equal(items.length, 1);
	assert.equal(mine.unread.get(), 1);
	mine.stop();
	signedIn.close();
	await gated.stop();
});

test('a reconnect keeps the same list and the server\'s state wins on it', async () => {
	const running = await started({ gate: asUser(user) });
	const seams = pageSockets(() => running.handlers);
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const inbox = createInbox(client);
	const items = await inbox.ready;
	await running.send.send({ to: { user }, title: 'one' });
	await settle();
	assert.equal(items.length, 1);
	client.reconnect();
	await new Promise((done) => setTimeout(done, 20));
	await running.send.send({ to: { user }, title: 'two' });
	await settle();
	assert.equal(inbox.items, items, 'the same list object across the reconnect');
	assert.deepEqual(items.map((item) => item.title), ['one', 'two']);
	assert.equal(inbox.unread.get(), 2);
	inbox.stop();
	client.close();
	await running.stop();
});

test('one client has one live view: a second call hands it back, and a stopped one is replaced on the next socket', async () => {
	const running = await started({ gate: asUser(user) });
	await running.send.send({ to: { user }, title: 'one' });
	const seams = pageSockets(() => running.handlers);
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const first = createInbox(client);
	await first.ready;
	assert.equal(createInbox(client), first, 'the same view while it is live');
	first.stop();
	const replacement = createInbox(client);
	assert.notEqual(replacement, first, 'a new one once it is stopped');
	replacement.stop();

	// The server offered the topic once on this socket and the first view left it, so a view
	// pairs again on the next socket, which is what enter and leave open before a page makes one.
	client.reconnect();
	await new Promise<void>((done) => { const off = client.status.watch((now) => { if (now === 'open') { off(); done(); } }); });
	const second = createInbox(client);
	const items = await second.ready;
	assert.equal(items.length, 1);
	assert.equal(second.unread.get(), 1);
	second.stop();

	const early = createInbox(client);
	early.stop();
	await assert.rejects(early.ready, (error: unknown) => {
		assert.equal(reasonOf(error), 'stopped');
		assert.equal(typeof (error as { fix?: unknown }).fix, 'string');
		return true;
	});
	client.close();
	await running.stop();
});

test('a view whose ready was refused is not the one handed back next time', async () => {
	const gated = await started({ withAuth: true });
	const seams = pageSockets(() => gated.handlers);
	const client = createClient({ url: URL, open: seams.open, reconnect: false });
	const refused = createInbox(client);
	await assert.rejects(refused.ready, (error: unknown) => reasonOf(error) === 'refused');
	assert.notEqual(createInbox(client), refused);
	client.close();
	await gated.stop();
});

test('a view over a socket that never opens is bounded by the client\'s timeout', async () => {
	const client = createClient({ url: URL, open: () => ({ binaryType: '', readyState: 0, send: () => undefined, close: () => undefined, addEventListener: () => undefined }), reconnect: false, timeout: 50 });
	await assert.rejects(createInbox(client).ready, (error: unknown) => reasonOf(error) === 'timeout');
	client.close();
});
