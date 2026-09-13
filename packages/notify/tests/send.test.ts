// notify/Send: the level map, the channels, the skips, the record, a channel that fails, the cap,
// the outward switch, and the refusals.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Sender } from '../src/index.ts';

import { asUser, fake, fakeFcm, newStore, reasonOf, sendConfig, serviceAccount, started } from './helpers.ts';

const user = 'ada';

/** A store with one user document, the way the auth battery keeps one. */
const storeWith = async (email: string | null) => {
	const store = newStore();
	const handle = await store.open(`user:${user}`);
	if (email !== null) (handle.root as { email?: string }).email = email;
	await store.settled(handle);
	await store.close(handle);
	return store;
};

const itemsOf = async (store: NonNullable<Awaited<ReturnType<typeof started>>['store']>) => {
	const handle = await store.open(`inbox:${user}`);
	const items = [...((handle.root as { items?: Record<string, unknown>[] }).items ?? [])].map((one) => ({ ...one }));
	await store.close(handle);
	return items;
};

test('the level picks the channels: info the inbox, warn adds push, error adds email', async () => {
	const running = await started({ store: await storeWith('ada@example.com'), gate: asUser(user) });
	const info = await running.send.send({ to: { user }, title: 'quiet' });
	const warn = await running.send.send({ to: { user }, title: 'louder', level: 'warn' });
	const error = await running.send.send({ to: { user }, title: 'loudest', level: 'error' });
	assert.deepEqual(Object.keys(info.delivery), ['inbox']);
	assert.deepEqual(Object.keys(warn.delivery), ['inbox', 'push']);
	assert.deepEqual(Object.keys(error.delivery), ['inbox', 'email', 'push']);
	assert.deepEqual(info.delivery.inbox, { ok: true });
	// Neither network channel is configured, and the record says which setting is missing.
	assert.match((error.delivery.email as { error: string }).error, /email is not configured/);
	assert.match((error.delivery.push as { error: string }).error, /no device is registered/);
	await running.stop();
});

test('channels named on the send replace the level\'s, and the inbox is not written when it is not among them', async () => {
	const store = await storeWith('ada@example.com');
	const running = await started({ store, gate: asUser(user) });
	const sent = await running.send.send({ to: { user }, title: 'mail only', level: 'error', channels: ['email'] });
	assert.deepEqual(Object.keys(sent.delivery), ['email']);
	assert.equal((await itemsOf(store)).length, 0);
	await running.stop();
});

test('an address recipient skips the inbox and push, and the mail goes to that address', async () => {
	const resend = await fake();
	resend.answer(200, { id: 'msg-1' });
	const running = await started({
		gate: asUser(user),
		config: sendConfig({ email: { resend: { key: 'k', from: 'Site <site@example.com>', endpoint: resend.url } } }),
	});
	const sent = await running.send.send({ to: { email: 'Owner@Example.com' }, title: 'a message', body: 'hello', level: 'error', replyTo: 'visitor@example.com' });
	assert.deepEqual(sent.delivery.inbox, { skipped: 'no user' });
	assert.deepEqual(sent.delivery.push, { skipped: 'no user' });
	assert.deepEqual(sent.delivery.email, { ok: true, id: 'msg-1' });
	assert.equal(resend.calls.length, 1);
	const body = resend.calls[0]!.body as Record<string, unknown>;
	assert.equal(body.to, 'owner@example.com');
	assert.equal(body.reply_to, 'visitor@example.com');
	assert.equal(body.from, 'Site <site@example.com>');
	assert.equal(resend.calls[0]!.headers.authorization, 'Bearer k');
	await running.stop();
	await resend.stop();
});

test('a server with no store skips the inbox and push and refuses nothing, which is a contact form\'s shape', async () => {
	const resend = await fake();
	const running = await started({
		store: null, gate: asUser(user),
		config: sendConfig({ email: { resend: { key: 'k', from: 'site@example.com', endpoint: resend.url } } }),
	});
	const sent = await running.send.send({ to: { email: 'owner@example.com' }, title: 'from the form', level: 'error' });
	assert.deepEqual(sent.delivery.inbox, { skipped: 'no user' });
	assert.equal((sent.delivery.email as { ok: boolean }).ok, true);
	// A user recipient on the same server: the inbox and the device list have nowhere to be.
	const toUser = await running.send.send({ to: { user }, title: 'no store', level: 'warn' });
	assert.deepEqual(toUser.delivery.inbox, { skipped: 'no store' });
	assert.deepEqual(toUser.delivery.push, { skipped: 'no store' });
	await running.stop();
	await resend.stop();
});

test('the item is in the inbox before the network answers, and carries the record once it has', async () => {
	const store = await storeWith('ada@example.com');
	const resend = await fake();
	resend.answer(200, { id: 'msg-2' }, 150);
	const running = await started({
		store, gate: asUser(user),
		config: sendConfig({ email: { resend: { key: 'k', from: 'site@example.com', endpoint: resend.url } } }),
	});
	const sending = running.send.send({ to: { user }, title: 'shipped', body: 'your order', level: 'error', url: '/orders/1', tag: 'orders' });
	await new Promise((done) => setTimeout(done, 50));
	const early = await itemsOf(store);
	assert.equal(early.length, 1, 'the item is there while Resend is still answering');
	assert.equal(early[0]!.delivery, '{}');
	const sent = await sending;
	const late = await itemsOf(store);
	assert.equal(late[0]!.id, sent.id);
	assert.equal(late[0]!.title, 'shipped');
	assert.equal(late[0]!.url, '/orders/1');
	assert.equal(late[0]!.tag, 'orders');
	assert.equal(late[0]!.readAt, null);
	assert.deepEqual(JSON.parse(late[0]!.delivery as string), sent.delivery);
	assert.deepEqual(sent.delivery.email, { ok: true, id: 'msg-2' });
	assert.equal((resend.calls[0]!.body as { to: string }).to, 'ada@example.com', 'the address came off the user document');
	await running.stop();
	await resend.stop();
});

test('a sender that throws or a service that fails is a line in the record, and the send resolves with the item kept', async () => {
	const store = await storeWith('ada@example.com');
	const throwing: Sender = async () => { throw new Error('the mailer fell over'); };
	const running = await started({ store, gate: asUser(user), config: sendConfig({ email: throwing }) });
	const sent = await running.send.send({ to: { user }, title: 'still kept', level: 'error' });
	assert.deepEqual(sent.delivery.email, { ok: false, error: 'the mailer fell over' });
	assert.deepEqual(sent.delivery.inbox, { ok: true });
	assert.equal((await itemsOf(store)).length, 1);
	await running.stop();

	const resend = await fake();
	resend.answer(500, { message: 'domain not verified' });
	const failing = await started({
		store: await storeWith('ada@example.com'), gate: asUser(user),
		config: sendConfig({ email: { resend: { key: 'k', from: 'site@example.com', endpoint: resend.url } } }),
	});
	const answer = await failing.send.send({ to: { user }, title: 'refused by resend', level: 'error' });
	assert.deepEqual(answer.delivery.email, { ok: false, error: 'resend answered 500: domain not verified' });
	await failing.stop();
	await resend.stop();
});

test('the cap is per recipient per hour, and another recipient is not under it', async () => {
	const running = await started({ store: await storeWith(null), gate: asUser(user), config: sendConfig({ perHour: 2 }) });
	await running.send.send({ to: { user }, title: 'one' });
	await running.send.send({ to: { user }, title: 'two' });
	await assert.rejects(running.send.send({ to: { user }, title: 'three' }), (error: unknown) => reasonOf(error) === 'capped');
	const other = await running.send.send({ to: { user: 'grace' }, title: 'hers' });
	assert.deepEqual(other.delivery.inbox, { ok: true });
	await assert.rejects(running.send.send({ to: { email: 'a@b.co' }, title: 'a' }).then(() => running.send.send({ to: { email: 'a@b.co' }, title: 'b' })).then(() => running.send.send({ to: { email: 'a@b.co' }, title: 'c' })), (error: unknown) => reasonOf(error) === 'capped');
	await running.stop();
});

test('outward off reaches neither service and records the refusal, after every local step ran', async () => {
	const resend = await fake();
	const fcm = await fakeFcm();
	const store = await storeWith('ada@example.com');
	const running = await started({
		store, gate: asUser(user),
		config: sendConfig({
			outward: false,
			email: { resend: { key: 'k', from: 'site@example.com', endpoint: resend.url } },
			push: { fcm: { account: serviceAccount(), endpoint: fcm.endpoint, tokenUrl: fcm.tokenUrl } },
		}),
	});
	const devices = running.server.loader.get('notify/Devices') as { call(args: unknown, context: unknown): Promise<unknown> };
	await devices.call({ register: { device: 'phone', platform: 'android', transport: 'fcm', endpoint: 'tok' } }, { user });
	const sent = await running.send.send({ to: { user }, title: 'silent', level: 'error' });
	assert.deepEqual(sent.delivery.email, { ok: false, error: 'outward delivery is off (outward: false)' });
	assert.deepEqual(sent.delivery.push, { ok: false, error: 'outward delivery is off (outward: false)' });
	assert.equal(resend.calls.length, 0);
	assert.equal(fcm.calls.length, 0);
	// The user with no address is found before the switch, so that bug is not hidden by it.
	const nobody = await started({ store: await storeWith(null), gate: asUser(user), config: sendConfig({ outward: false, email: { resend: { key: 'k', from: 'f@x.co' } } }) });
	const missing = await nobody.send.send({ to: { user }, title: 'no address', channels: ['email'] });
	assert.deepEqual(missing.delivery.email, { ok: false, error: 'the user has no email address' });
	await nobody.stop();
	await running.stop();
	await resend.stop();
	await fcm.stop();
});

test('push carries the id and a generic line by default, the text with private false, and forgets a dead device', async () => {
	const fcm = await fakeFcm();
	const store = await storeWith(null);
	const running = await started({
		store, gate: asUser(user),
		config: sendConfig({ push: { fcm: { account: serviceAccount(), endpoint: fcm.endpoint, tokenUrl: fcm.tokenUrl } } }),
	});
	const devices = running.server.loader.get('notify/Devices') as { call(args: unknown, context: unknown): Promise<unknown>; list(user: string): Promise<Record<string, unknown>> };
	await devices.call({ register: { device: 'phone', platform: 'android', transport: 'fcm', endpoint: 'tok-1' } }, { user });
	await devices.call({ register: { device: 'tablet', platform: 'android', transport: 'fcm', endpoint: 'tok-2' } }, { user });
	await devices.call({ register: { device: 'laptop', platform: 'desktop', transport: 'none' } }, { user });

	const quiet = await running.send.send({ to: { user }, title: 'Balance low', body: '12.00', level: 'warn', url: '/bank', tag: 'bank' });
	assert.deepEqual(quiet.delivery.push, { ok: true, devices: 2 });
	assert.equal(fcm.sends().length, 2, 'one send per device that can be woken');
	const message = (fcm.sends()[0]!.body as { message: Record<string, unknown> }).message;
	assert.equal(message.token, 'tok-1');
	assert.deepEqual(message.android, { priority: 'HIGH' });
	assert.equal(message.notification, undefined, 'data only, never a notification the system draws');
	assert.deepEqual(message.data, { n: quiet.id, p: '1', t: 'Notification', b: 'You have a new notification', u: '/bank', l: 'warn', g: 'bank' });
	assert.equal(fcm.sends()[0]!.headers.authorization, 'Bearer token-1');

	const loud = await running.send.send({ to: { user }, title: 'Build done', body: 'green', level: 'warn', private: false });
	const data = (fcm.sends()[2]!.body as { message: { data: Record<string, string> } }).message.data;
	assert.equal(data.t, 'Build done');
	assert.equal(data.b, 'green');
	assert.equal(data.p, '0');
	assert.equal(data.n, loud.id);
	assert.equal(fcm.exchanges(), 1, 'the access token is exchanged once and cached');

	// The service says the second token belongs to no installed app: gone from the list.
	fcm.answer(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
	const partial = await running.send.send({ to: { user }, title: 'again', level: 'warn' });
	assert.equal((partial.delivery.push as { ok: boolean }).ok, false);
	assert.match((partial.delivery.push as { error: string }).error, /phone: fcm answered 404 UNREGISTERED/);
	assert.deepEqual(Object.keys(await devices.list(user)).sort(), ['laptop']);
	await running.stop();
	await fcm.stop();
});

test('the address is read off the user document by default, and from the configured function instead', async () => {
	const resend = await fake();
	const configured = await started({
		store: await storeWith('ada@example.com'), gate: asUser(user),
		config: sendConfig({ email: { resend: { key: 'k', from: 'site@example.com', endpoint: resend.url } }, address: (id: string) => `${id}@elsewhere.test` }),
	});
	await configured.send.send({ to: { user }, title: 'via the function', channels: ['email'] });
	assert.equal((resend.calls[0]!.body as { to: string }).to, 'ada@elsewhere.test');
	await configured.stop();
	await resend.stop();
});

test('the default html is the escaped title and body, and a given html and body cut go through as they are', async () => {
	const resend = await fake();
	const running = await started({
		store: await storeWith('ada@example.com'), gate: asUser(user),
		config: sendConfig({ email: { resend: { key: 'k', from: 'site@example.com', endpoint: resend.url } } }),
	});
	await running.send.send({ to: { user }, title: 'a < b', body: 'x & y', channels: ['email'] });
	const first = resend.calls[0]!.body as Record<string, string | undefined>;
	assert.equal(first.subject, 'a < b');
	assert.equal(first.text, 'x & y');
	assert.equal(first.html, '<p><strong>a &lt; b</strong></p><p>x &amp; y</p>');
	assert.equal(first.reply_to, undefined);
	await running.send.send({ to: { user }, title: 'x'.repeat(300), body: 'y'.repeat(3000), html: '<h1>mine</h1>', channels: ['email'] });
	const second = resend.calls[1]!.body as { subject: string; text: string; html: string };
	assert.equal(second.subject.length, 200);
	assert.equal(second.text.length, 2000);
	assert.equal(second.html, '<h1>mine</h1>');
	await running.stop();
	await resend.stop();
});

test('a send out of shape is invalid-notification with the fix on it', async () => {
	const running = await started({ store: await storeWith(null), gate: asUser(user) });
	const send = running.send.send.bind(running.send) as (options: unknown) => Promise<unknown>;
	for (const bad of [
		{ to: { user }, title: '' },
		{ to: { user }, title: '   ' },
		{ to: { user } },
		{ to: {}, title: 'x' },
		{ to: { email: 'not an address' }, title: 'x' },
		{ to: { user }, title: 'x', level: 'loud' },
		{ to: { user }, title: 'x', channels: ['sms'] },
		{ to: { user }, title: 'x', channels: 'inbox' },
		{ to: { user }, title: 'x', html: 3 },
		{ to: { user }, title: 'x', replyTo: 3 },
		{ to: { user }, title: 'x', body: 42 },
		{ to: { user }, title: 'x', url: 42 },
		{ to: { user }, title: 'x', tag: 42 },
		{ to: { user }, title: 'x', private: 'yes' },
		{ to: { user }, title: 'x', level: null },
		'not options',
	]) {
		await assert.rejects(send(bad), (error: unknown) => {
			assert.equal(reasonOf(error), 'invalid-notification', JSON.stringify(bad));
			assert.match(String((error as { fix?: unknown }).fix), /Send \{ to/);
			return true;
		});
	}
	await running.stop();
});

test('a configuration out of shape is invalid-config at load', async () => {
	for (const [config, detail] of [
		[{ levels: { info: ['sms'] } }, /levels\.info/],
		[{ levels: 'inbox' }, /levels "inbox"/],
		[{ perHour: 0 }, /perHour 0/],
		[{ timeoutMs: -1 }, /timeoutMs -1/],
		[{ outward: 'off' }, /outward "off"/],
		[{ private: 1 }, /private 1/],
		[{ address: 'ada@x.co' }, /address/],
		[{ email: { resend: { key: 'k' } } }, /email\.resend/],
		[{ email: 'smtp' }, /email "smtp"/],
		[{ push: { fcm: {} } }, /push\.fcm/],
		[{ push: true }, /push true/],
	] as const) {
		const failed: string[] = [];
		await assert.rejects(started({ store: null, config: sendConfig(config as Record<string, unknown>), failed }), (error: unknown) => {
			assert.equal(reasonOf(error), 'invalid-config', JSON.stringify(config));
			assert.match(String((error as { cause?: { message?: string } }).cause?.message ?? (error as Error).message), detail);
			return true;
		});
	}
	// A level list given for one level merges over the others.
	const running = await started({ store: await storeWith(null), gate: asUser(user), config: sendConfig({ levels: { info: [] } }) });
	const sent = await running.send.send({ to: { user }, title: 'nowhere' });
	assert.deepEqual(sent.delivery, {});
	const warn = await running.send.send({ to: { user }, title: 'still push', level: 'warn' });
	assert.deepEqual(Object.keys(warn.delivery), ['inbox', 'push']);
	await running.stop();
});

test('the address function\'s answer is an address or null, and anything else is the email channel\'s error', async () => {
	const resend = await fake();
	for (const [answered, expected] of [
		[42, /answered 42 rather than an email address/],
		[{ email: 'x@y.z' }, /answered \{"email":"x@y.z"\}/],
		['', /answered ""/],
	] as const) {
		const running = await started({
			store: await storeWith(null), gate: asUser(user),
			config: sendConfig({ email: { resend: { key: 'k', from: 'f@x.co', endpoint: resend.url } }, address: () => answered as unknown as string }),
		});
		const sent = await running.send.send({ to: { user }, title: 'to nobody', channels: ['email'] });
		assert.match((sent.delivery.email as { error: string }).error, expected);
		await running.stop();
	}
	const nobody = await started({ store: await storeWith(null), gate: asUser(user), config: sendConfig({ email: { resend: { key: 'k', from: 'f@x.co', endpoint: resend.url } }, address: () => null }) });
	assert.deepEqual((await nobody.send.send({ to: { user }, title: 'x', channels: ['email'] })).delivery.email, { ok: false, error: 'the user has no email address' });
	await nobody.stop();
	assert.equal(resend.calls.length, 0, 'nothing reached the service');
	await resend.stop();
});

test('a sender or pusher of the application\'s own is bounded by timeoutMs and answers one entry per device', async () => {
	const never = (): Promise<never> => new Promise(() => undefined);
	const running = await started({
		store: await storeWith('ada@example.com'), gate: asUser(user),
		config: sendConfig({ timeoutMs: 50, email: never, push: never }),
	});
	const devices = running.server.loader.get('notify/Devices') as { call(args: unknown, context: unknown): Promise<unknown> };
	await devices.call({ register: { device: 'a', platform: 'android', transport: 'fcm', endpoint: 'tok-a' } }, { user });
	await devices.call({ register: { device: 'b', platform: 'android', transport: 'fcm', endpoint: 'tok-b' } }, { user });
	const started_ = Date.now();
	const sent = await running.send.send({ to: { user }, title: 'hangs', level: 'error' });
	assert.ok(Date.now() - started_ < 1000, 'the send came back');
	assert.deepEqual(sent.delivery.email, { ok: false, error: 'the sender did not answer within 50 ms' });
	assert.deepEqual(sent.delivery.push, { ok: false, error: 'the pusher did not answer within 50 ms' });
	assert.deepEqual(JSON.parse((await itemsOf(running.store!))[0]!.delivery as string), sent.delivery, 'and the record is on the item');
	await running.stop();

	// Fewer answers than devices, more, and not a list at all.
	for (const [answer, expected] of [
		[[{ ok: true }], { ok: true, devices: 1, errors: ['b: no answer from the pusher'] }],
		[[{ ok: true }, { ok: true }, { ok: true }], { ok: true, devices: 2 }],
		['done', { ok: false, error: 'a: no answer from the pusher; b: no answer from the pusher' }],
		[[{ ok: false, error: 'busy' }, 7], { ok: false, error: 'a: busy; b: no answer from the pusher' }],
	] as const) {
		const odd = await started({ store: await storeWith(null), gate: asUser(user), config: sendConfig({ push: async () => answer as never }) });
		const d = odd.server.loader.get('notify/Devices') as { call(args: unknown, context: unknown): Promise<unknown> };
		await d.call({ register: { device: 'a', platform: 'android', transport: 'fcm', endpoint: 'tok-a' } }, { user });
		await d.call({ register: { device: 'b', platform: 'android', transport: 'fcm', endpoint: 'tok-b' } }, { user });
		assert.deepEqual((await odd.send.send({ to: { user }, title: 'x', channels: ['push'] })).delivery.push, expected, JSON.stringify(answer));
		await odd.stop();
	}
});

test('the defaults are the ones the README states, and the hundredth send is the last one this hour', async () => {
	const send = await import('../src/modules/Send.ts');
	assert.deepEqual(send.defaults, {
		levels: { info: ['inbox'], warn: ['inbox', 'push'], error: ['inbox', 'push', 'email'] },
		email: null, push: null, perHour: 100, outward: true, private: true, address: null, timeoutMs: 10_000,
	});
	assert.deepEqual((await import('../src/modules/Inbox.ts')).defaults, { keep: 200, idleMs: 60_000 });
	assert.deepEqual((await import('../src/modules/Devices.ts')).defaults, { perUser: 20, endpointBytes: 1024 });
	const running = await started({ store: await storeWith(null), gate: asUser(user) });
	for (let n = 0; n < 100; n += 1) await running.send.send({ to: { user }, title: `bulk ${String(n)}` });
	await assert.rejects(running.send.send({ to: { user }, title: 'one over' }), (error: unknown) => reasonOf(error) === 'capped');
	await running.stop();
});
