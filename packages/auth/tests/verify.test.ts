// auth/Verify: a one-time link by mail, and the name `verified` once it is clicked (design 290).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from '@aweftjs/store';

import type { AuthContext, Roles } from '../src/index.ts';
import type { Enter, UserDocument } from '../src/modules/Enter.ts';
import type { Session } from '../src/modules/Session.ts';
import type { Verify } from '../src/modules/Verify.ts';

import { jsonRequest, mailer, module, newStore, noRoles, request, tokenIn } from './helpers.ts';

const url = (token: string): string => `https://app.example/verify?token=${token}`;

const signUp = async (store: Store, email: string): Promise<string> => {
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': {} });
	const outcome = await enter.enter(email, 'correct horse');
	assert.ok('user' in outcome);
	return outcome.user;
};

const asUser = (user: string | null): AuthContext => ({ user, session: user === null ? null : 'AAAAAAAAAAAAAAAAAAAAAA', address: '1.1.1.1' });

const verifiedOf = async (store: Store, user: string): Promise<boolean> => {
	const handle = await store.open(`user:${user}`);
	const held = (handle.root as UserDocument).emailVerified;
	await store.close(handle);
	return held;
};

test('send writes a link and mails it through notify with the configured url; confirm takes it once, writes emailVerified and grants verified', async () => {
	const store = newStore();
	const mail = mailer();
	const { instance: roles } = await module<Roles>('Roles', store);
	const { instance: verify } = await module<Verify>('Verify', store, { 'auth/Roles': roles, 'notify/Send': mail }, { url });
	const ada = await signUp(store, 'ada@example.com');
	assert.equal(verify.public, true);
	assert.equal(await verifiedOf(store, ada), false);

	assert.deepEqual(await verify.send(ada), { ok: true });
	assert.equal(mail.sent.length, 1);
	const [one] = mail.sent;
	assert.equal(one!.user, ada);
	assert.equal(one!.title, 'Verify your email address');
	assert.deepEqual(one!.channels, ['email']);
	const token = tokenIn(one!.body);
	assert.match(token, /^[A-Za-z0-9_-]{22}$/, 'a token of the battery\'s own shape');
	assert.ok(one!.html.includes(`<a href="https://app.example/verify?token=${token}">`), 'the html carries the link as a link');
	assert.notEqual(await store.head(`verify:${token}`), 0, 'the link document exists');
	assert.deepEqual(await verify.confirm([token]), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] }, 'a token is a string, not a list holding one');
	assert.notEqual(await store.head(`verify:${token}`), 0, 'and the link still stands');

	assert.deepEqual(await verify.confirm(token), { user: ada });
	assert.equal(await verifiedOf(store, ada), true);
	assert.equal(await roles.may(ada, 'verified'), true, 'the name is granted');
	assert.equal(await store.head(`verify:${token}`), 0, 'and the link is gone');
	assert.deepEqual(await verify.confirm(token), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] }, 'a second use');
	assert.deepEqual(await verify.confirm('not a token'), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] });

	assert.deepEqual(await verify.confirm(undefined), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] });
	assert.deepEqual(await verify.send(ada), { refused: [{ code: 'verified', message: 'this email is already verified' }] }, 'nothing more to verify');
	assert.equal(mail.sent.length, 1);
	verify.stop();
	await store.stop();
});

test('a link past its lifetime is refused and swept; a mailer that fails or skips is refused as mail and the link still stands', async () => {
	const store = newStore();
	const mail = mailer();
	const { instance: roles } = await module<Roles>('Roles', store);
	const { instance: verify } = await module<Verify>('Verify', store, { 'auth/Roles': roles, 'notify/Send': mail }, { url, verifyMs: 30 });
	const ada = await signUp(store, 'ada@example.com');

	await verify.send(ada);
	const token = tokenIn(mail.sent[0]!.body);
	await new Promise((done) => setTimeout(done, 40));
	assert.deepEqual(await verify.confirm(token), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] }, 'expired');
	assert.equal(await verifiedOf(store, ada), false);

	mail.answer({ ok: false, error: 'the provider said no' });
	const failed = await verify.send(ada);
	assert.deepEqual(failed, { refused: [{ code: 'mail', message: 'the mail could not be sent: the provider said no' }] });
	const standing = tokenIn(mail.sent[1]!.body);
	assert.notEqual(await store.head(`verify:${standing}`), 0, 'the link is kept for the next try');
	mail.answer({ skipped: 'no address' });
	assert.deepEqual(await verify.send(ada), { refused: [{ code: 'mail', message: 'the mail could not be sent: no address' }] });
	mail.answer(undefined);
	assert.deepEqual(await verify.send(ada), { refused: [{ code: 'mail', message: 'the mail could not be sent: the mailer tried no email channel' }] });
	mail.answer('yes');
	assert.deepEqual(await verify.send(ada), { refused: [{ code: 'mail', message: 'the mail could not be sent: the mailer tried no email channel' }] }, 'a shape notify never answers is the same refusal, not a throw');
	mail.answer({ ok: false });
	assert.deepEqual(await verify.send(ada), { refused: [{ code: 'mail', message: 'the mail could not be sent: the mailer gave no reason' }] });
	mail.fail('capped');
	assert.deepEqual(await verify.send(ada), { refused: [{ code: 'mail', message: 'the mail could not be sent: capped' }] }, 'a throw is the same refusal');
	verify.stop();
	await store.stop();
});

test('POST /api/verify/send is 401 anonymous, 200 sent, 409 already verified, 429 past the counts, 502 when the mail did not go; POST /api/verify takes the token', async () => {
	const store = newStore();
	const mail = mailer();
	const { instance: roles } = await module<Roles>('Roles', store);
	const { instance: verify } = await module<Verify>('Verify', store, { 'auth/Roles': roles, 'notify/Send': mail }, { url, sendsPerUser: 2, resendMs: 1 });
	const ada = await signUp(store, 'ada@example.com');
	const sendRoute = verify.routes['POST /api/verify/send']!;
	const takeRoute = verify.routes['POST /api/verify']!;

	assert.equal((await sendRoute(request('/api/verify/send', { method: 'POST' }), asUser(null))).status, 401);
	const first = await sendRoute(request('/api/verify/send', { method: 'POST' }), asUser(ada));
	assert.equal(first.status, 200);
	assert.deepEqual(await first.json(), { ok: true });
	await new Promise((done) => setTimeout(done, 5));
	assert.equal((await sendRoute(request('/api/verify/send', { method: 'POST' }), asUser(ada))).status, 200, 'a second, past the resend gap');
	const third = await sendRoute(request('/api/verify/send', { method: 'POST' }), asUser(ada));
	assert.equal(third.status, 429, 'a third in the window');
	assert.deepEqual(await third.json(), { reasons: [{ code: 'attempts', message: 'too many verification mails; wait and try again' }] });
	assert.match(third.headers.get('retry-after') ?? '', /^\d+$/);
	assert.equal(mail.sent.length, 2);

	const bad = await takeRoute(jsonRequest('/api/verify', 'POST', { token: 'nope' }), asUser(null));
	assert.equal(bad.status, 400);
	assert.deepEqual(await bad.json(), { reasons: [{ code: 'token', message: 'this link is not one that can be used' }] });
	assert.equal((await takeRoute(request('/api/verify', { method: 'POST', body: 'not json' }), asUser(null))).status, 400, 'no body is no token');
	const taken = await takeRoute(jsonRequest('/api/verify', 'POST', { token: tokenIn(mail.sent[1]!.body) }), asUser(null));
	assert.equal(taken.status, 200, 'anyone with the link takes it');
	assert.deepEqual(await taken.json(), { user: ada });
	assert.equal((await takeRoute(jsonRequest('/api/verify', 'POST', { token: tokenIn(mail.sent[0]!.body) }), asUser(null))).status, 200, 'an earlier link still stands');

	const { instance: fresh } = await module<Verify>('Verify', store, { 'auth/Roles': roles, 'notify/Send': mail }, { url });
	assert.equal((await fresh.routes['POST /api/verify/send']!(request('/api/verify/send', { method: 'POST' }), asUser(ada))).status, 409);
	const bob = await signUp(store, 'bob@example.com');
	mail.answer({ ok: false, error: 'down' });
	const down = await fresh.routes['POST /api/verify/send']!(request('/api/verify/send', { method: 'POST' }), asUser(bob));
	assert.equal(down.status, 502);
	assert.deepEqual(await down.json(), { reasons: [{ code: 'mail', message: 'the mail could not be sent: down' }] });
	verify.stop();
	fresh.stop();
	await store.stop();
});

test('a resend inside the gap is 429 with the gap left, whatever the daily count', async () => {
	const store = newStore();
	const mail = mailer();
	const { instance: verify } = await module<Verify>('Verify', store, { 'auth/Roles': noRoles, 'notify/Send': mail }, { url, resendMs: 60_000 });
	const ada = await signUp(store, 'ada@example.com');
	const sendRoute = verify.routes['POST /api/verify/send']!;
	assert.equal((await sendRoute(request('/api/verify/send', { method: 'POST' }), asUser(ada))).status, 200);
	const soon = await sendRoute(request('/api/verify/send', { method: 'POST' }), asUser(ada));
	assert.equal(soon.status, 429);
	assert.ok(Number(soon.headers.get('retry-after')) <= 60);
	verify.stop();
	await store.stop();
});

test('url is required, subject is text, and every number is above zero, or the module is refused when it is made', async () => {
	const store = newStore();
	const mail = mailer();
	await assert.rejects(module<Verify>('Verify', store, { 'auth/Roles': noRoles, 'notify/Send': mail }), /invalid-config/, 'no url');
	for (const config of [{ url: 'https://app.example/verify' }, { url, subject: '' }, { url, verifyMs: 0 }, { url, sendsPerUser: -1 }, { url, resendMs: 'soon' }, { url, sweepMs: Infinity }]) {
		await assert.rejects(module<Verify>('Verify', store, { 'auth/Roles': noRoles, 'notify/Send': mail }, config), /invalid-config|invalid-limit/, JSON.stringify(config));
	}
	const { instance: made } = await module<Verify>('Verify', store, { 'auth/Roles': noRoles, 'notify/Send': mail }, { url });
	assert.equal(made.public, true);
	made.stop();
	await store.stop();
});
