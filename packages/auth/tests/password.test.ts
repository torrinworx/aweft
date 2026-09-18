// auth/Password: change with the current password, forgot by mail, reset by the link
// (design 290).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from '@aweftjs/store';

import type { AuthContext } from '../src/index.ts';
import type { Enter } from '../src/modules/Enter.ts';
import type { Password } from '../src/modules/Password.ts';
import type { Session } from '../src/modules/Session.ts';

import { jsonRequest, mailRefused, mailer, module, newStore, request, tokenIn, withCookie } from './helpers.ts';

const url = (token: string): string => `https://app.example/reset?token=${token}`;

/** The three real modules the password module leans on, over one store. */
const boot = async (store: Store, config: Record<string, unknown> = {}) => {
	const mail = mailer();
	const { instance: session } = await module<Session>('Session', store);
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const { instance: password } = await module<Password>('Password', store, { 'auth/Session': session, 'auth/Enter': enter, 'notify/Send': mail }, { url, ...config });
	const signUp = async (email: string, secret = 'correct horse'): Promise<{ user: string; token: string }> => {
		const outcome = await enter.enter(email, secret);
		assert.ok('user' in outcome);
		return { user: outcome.user, token: await session.issue(outcome.user) };
	};
	const signsIn = async (email: string, secret: string): Promise<boolean> => !('refused' in await enter.enter(email, secret));
	const live = async (token: string): Promise<boolean> => {
		const who = await session.whoIs(withCookie('/', `session=${token}`));
		return 'context' in who && who.context.user !== null;
	};
	return { mail, session, enter, password, signUp, signsIn, live, stop: () => { password.stop(); return session.stop(); } };
};

const asUser = (user: string | null, session: string | null = null, address = '1.1.1.1'): AuthContext => ({ user, session, address });

test('change needs the current password and a new one the rules take, rehashes, and ends every other session of the person', async () => {
	const store = newStore();
	const b = await boot(store);
	const ada = await b.signUp('ada@example.com');
	const second = await b.session.issue(ada.user);
	const bob = await b.signUp('bob@example.com');
	assert.equal(b.password.public, true);

	assert.deepEqual(await b.password.change(ada.user, 'wrong horse', 'battery staple'), { refused: [{ code: 'password', message: 'the current password is wrong' }] });
	assert.deepEqual(await b.password.change(ada.user, undefined, 'battery staple'), { refused: [{ code: 'password', message: 'the current password is wrong' }] });
	assert.deepEqual(await b.password.change(ada.user, 'correct horse', 'short'), { refused: [{ code: 'password', message: 'password is 8 to 256 characters' }] }, 'the rules of auth/Enter');
	assert.deepEqual(await b.password.change('u_nobody', 'correct horse', 'battery staple'), { refused: [{ code: 'password', message: 'the current password is wrong' }] });
	assert.equal(await b.signsIn('ada@example.com', 'correct horse'), true, 'nothing changed on the way to a refusal');

	assert.deepEqual(await b.password.change(ada.user, 'correct horse', 'battery staple', ada.token), { ok: true });
	assert.equal(await b.signsIn('ada@example.com', 'correct horse'), false, 'the old password is gone');
	assert.equal(await b.signsIn('ada@example.com', 'battery staple'), true);
	assert.equal(await b.live(ada.token), true, 'the session that asked is kept');
	assert.equal(await b.live(second), false, 'the other one is over');
	assert.equal(await b.live(bob.token), true, 'and nobody else was touched');
	await b.stop();
	await store.stop();
});

test('forgot answers ok for any address, mails a link only to a known one, and reset takes the link once, sets the password and ends every session', async () => {
	const store = newStore();
	const b = await boot(store);
	const ada = await b.signUp('ada@example.com');
	const second = await b.session.issue(ada.user);

	assert.deepEqual(await b.password.forgot('nobody@example.com'), { ok: true });
	assert.equal(b.mail.sent.length, 0, 'an address nobody has gets no mail');
	assert.deepEqual(await b.password.forgot('  Ada@Example.com '), { ok: true });
	assert.equal(b.mail.sent.length, 1);
	assert.equal(b.mail.sent[0]!.user, ada.user);
	assert.equal(b.mail.sent[0]!.title, 'Reset your password');
	const token = tokenIn(b.mail.sent[0]!.body);
	assert.ok(b.mail.sent[0]!.html.includes(`<a href="https://app.example/reset?token=${token}">`));

	assert.deepEqual(await b.password.reset('nope', 'battery staple'), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] });
	assert.deepEqual(await b.password.reset(token, 'short'), { refused: [{ code: 'password', message: 'password is 8 to 256 characters' }] });
	assert.notEqual(await store.head(`reset:${token}`), 0, 'a refused password burns no link');
	assert.deepEqual(await b.password.reset(token, 'battery staple'), { user: ada.user });
	assert.equal(await b.signsIn('ada@example.com', 'battery staple'), true);
	assert.equal(await b.signsIn('ada@example.com', 'correct horse'), false);
	assert.equal(await b.live(ada.token), false, 'every session is over');
	assert.equal(await b.live(second), false);
	assert.deepEqual(await b.password.reset(token, 'battery staple'), { refused: [{ code: 'taken', message: 'this link has already been used' }] }, 'a second use is told apart from a link that never was (design 294)');
	assert.deepEqual(await b.password.reset(token, 'short'), { refused: [{ code: 'taken', message: 'this link has already been used' }] }, 'and it is refused before the password is looked at');
	assert.notEqual(await store.head(`reset:${token}`), 0, 'the link stays, marked, until its end');

	b.mail.answer({ ok: false, error: 'down' });
	assert.deepEqual(await b.password.forgot('ada@example.com'), { refused: [mailRefused('down')] });
	await b.stop();
	await store.stop();
});

test('the change route is 401 anonymous or wrong, 400 for a new password the rules refuse, 429 past the attempts, 200 keeping the asking session', async () => {
	const store = newStore();
	const b = await boot(store, { attemptsPerUser: 2 });
	const ada = await b.signUp('ada@example.com');
	const other = await b.session.issue(ada.user);
	const route = b.password.routes['POST /api/password']!;

	assert.equal((await route(jsonRequest('/api/password', 'POST', { current: 'correct horse', password: 'battery staple' }), asUser(null))).status, 401);
	const wrong = await route(jsonRequest('/api/password', 'POST', { current: 'wrong', password: 'battery staple' }), asUser(ada.user, ada.token));
	assert.equal(wrong.status, 401);
	assert.deepEqual(await wrong.json(), { reasons: [{ code: 'password', message: 'the current password is wrong' }] });
	const short = await route(jsonRequest('/api/password', 'POST', { current: 'correct horse', password: 'short' }), asUser(ada.user, ada.token));
	assert.equal(short.status, 400);
	const third = await route(jsonRequest('/api/password', 'POST', { current: 'wrong', password: 'battery staple' }), asUser(ada.user, ada.token));
	assert.equal(third.status, 429, 'the current password is counted like a sign-in');
	assert.match(third.headers.get('retry-after') ?? '', /^\d+$/);

	const { instance: fresh } = await module<Password>('Password', store, { 'auth/Session': b.session, 'auth/Enter': b.enter, 'notify/Send': b.mail }, { url });
	const ok = await fresh.routes['POST /api/password']!(jsonRequest('/api/password', 'POST', { current: 'correct horse', password: 'battery staple' }), asUser(ada.user, ada.token));
	assert.equal(ok.status, 200);
	assert.deepEqual(await ok.json(), { ok: true });
	assert.equal(await b.live(ada.token), true);
	assert.equal(await b.live(other), false);
	assert.equal((await fresh.routes['POST /api/password']!(request('/api/password', { method: 'POST', body: '{' }), asUser(ada.user, ada.token))).status, 401, 'no body is no current password');
	fresh.stop();
	await b.stop();
	await store.stop();
});

test('the forgot route is 400 for text that is not an address, 200 whatever the address, 429 per email and per address, 502 when the mail did not go; the reset route takes the link', async () => {
	const store = newStore();
	const b = await boot(store, { forgotPerEmail: 2, forgotPerAddress: 3 });
	const ada = await b.signUp('ada@example.com');
	const forgot = b.password.routes['POST /api/password/forgot']!;
	const reset = b.password.routes['POST /api/password/reset']!;

	assert.equal((await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'not an address' }), asUser(null))).status, 400);
	assert.equal((await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'nobody@example.com' }), asUser(null))).status, 200);
	assert.equal(b.mail.sent.length, 0);
	assert.equal((await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'ada@example.com' }), asUser(null))).status, 200);
	assert.equal((await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'ada@example.com' }), asUser(null))).status, 200);
	const byEmail = await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'ada@example.com' }), asUser(null));
	assert.equal(byEmail.status, 429, 'the third for one email');
	assert.deepEqual(await byEmail.json(), { reasons: [{ code: 'attempts', message: 'too many attempts; wait and try again' }] });
	assert.equal((await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'x@example.com' }), asUser(null))).status, 429, 'the fourth from one address, whatever the email');
	assert.equal((await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'x@example.com' }), asUser(null, null, '2.2.2.2'))).status, 200, 'another address goes on');
	assert.equal(b.mail.sent.length, 2);

	b.mail.answer({ ok: false, error: 'down' });
	const down = await forgot(jsonRequest('/api/password/forgot', 'POST', { email: 'ada@example.com' }), asUser(null, null, '3.3.3.3'));
	assert.equal(down.status, 429, 'the email count stands whatever the address');
	b.mail.answer({ ok: true });

	const token = tokenIn(b.mail.sent[1]!.body);
	const bad = await reset(jsonRequest('/api/password/reset', 'POST', { token, password: 'short' }), asUser(null));
	assert.equal(bad.status, 400);
	assert.deepEqual(await bad.json(), { reasons: [{ code: 'password', message: 'password is 8 to 256 characters' }] });
	const done = await reset(jsonRequest('/api/password/reset', 'POST', { token, password: 'battery staple' }), asUser(null));
	assert.equal(done.status, 200);
	assert.deepEqual(await done.json(), { user: ada.user });
	const used = await reset(jsonRequest('/api/password/reset', 'POST', { token, password: 'battery staple' }), asUser(null));
	assert.equal(used.status, 400, 'used');
	assert.deepEqual(await used.json(), { reasons: [{ code: 'taken', message: 'this link has already been used' }] });
	assert.equal(await b.live(ada.token), false);

	const { instance: fresh } = await module<Password>('Password', store, { 'auth/Session': b.session, 'auth/Enter': b.enter, 'notify/Send': b.mail }, { url });
	b.mail.answer({ ok: false, error: 'down' });
	const failed = await fresh.routes['POST /api/password/forgot']!(jsonRequest('/api/password/forgot', 'POST', { email: 'ada@example.com' }), asUser(null, null, '4.4.4.4'));
	assert.equal(failed.status, 502);
	assert.deepEqual(await failed.json(), { reasons: [mailRefused('down')] });
	fresh.stop();
	await b.stop();
	await store.stop();
});

test('a reset link past its lifetime is refused, and refusePassword on auth/Enter applies to a reset and a change', async () => {
	const store = newStore();
	const mail = mailer();
	const { instance: session } = await module<Session>('Session', store);
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session }, { refusePassword: (p: string) => p === 'password1' });
	const { instance: password } = await module<Password>('Password', store, { 'auth/Session': session, 'auth/Enter': enter, 'notify/Send': mail }, { url, resetMs: 30 });
	const outcome = await enter.enter('ada@example.com', 'correct horse');
	assert.ok('user' in outcome);

	assert.deepEqual(await password.change(outcome.user, 'correct horse', 'password1'), { refused: [{ code: 'password', message: 'that password is not allowed here' }] });
	await password.forgot('ada@example.com');
	const token = tokenIn(mail.sent[0]!.body);
	assert.deepEqual(await password.reset(token, 'password1'), { refused: [{ code: 'password', message: 'that password is not allowed here' }] });
	await new Promise((done) => setTimeout(done, 40));
	assert.deepEqual(await password.reset(token, 'battery staple'), { refused: [{ code: 'token', message: 'this link is not one that can be used' }] }, 'expired');
	password.stop();
	await session.stop();
	await store.stop();
});

test('url is required and the numbers are above zero, or the module is refused when it is made', async () => {
	const store = newStore();
	const mail = mailer();
	const { instance: session } = await module<Session>('Session', store);
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const imports = { 'auth/Session': session, 'auth/Enter': enter, 'notify/Send': mail };
	await assert.rejects(module<Password>('Password', store, imports), /invalid-config/, 'no url');
	for (const config of [{ url: 42 }, { url, subject: 7 }, { url, resetMs: 0 }, { url, forgotPerEmail: 0 }, { url, attemptsWindowMs: -1 }]) {
		await assert.rejects(module<Password>('Password', store, imports, config), /invalid-config|invalid-limit/, JSON.stringify(config));
	}
	await session.stop();
	await store.stop();
});
