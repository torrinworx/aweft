// auth/Enter: sign in, or sign up when the email is new, never storing the password
// (design 074).

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from '@aweftjs/store';

import type { AuthContext } from '../src/index.ts';
import type { Enter, UserDocument } from '../src/modules/Enter.ts';
import type { Session } from '../src/modules/Session.ts';

import { jsonRequest, module, newStore, request } from './helpers.ts';

const stubSession = () => {
	const issued: string[] = [];
	const session = {
		issue: async (user: string) => { issued.push(user); return 'AAAAAAAAAAAAAAAA'; },
		setCookie: (token: string | null) => `session=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax`,
	} as unknown as Session;
	return { session, issued };
};

test('sign-up creates the user document with a hash and never the password; sign-in verifies it', async () => {
	const store = newStore();
	const { session } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	assert.equal(enter.public, true);

	const up = await enter.enter('  Ada@Example.COM ', 'correct horse');
	assert.ok('user' in up && up.created === true);
	const held = await store.open(`user:${up.user}`);
	const doc = held.root as UserDocument;
	assert.equal(doc.email, 'ada@example.com', 'the address is stored normalised');
	assert.equal(doc.name, null);
	assert.equal(doc.emailVerified, false);
	assert.equal(typeof doc.createdAt, 'number');
	assert.equal(doc.modifiedAt, doc.createdAt);
	assert.match(doc.password, /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/, 'the hash carries its parameters and salt');
	assert.ok(!doc.password.includes('correct horse'));
	await store.close(held);

	const again = await enter.enter('ada@example.com', 'correct horse');
	assert.deepEqual(again, { user: up.user, created: false });
	const wrong = await enter.enter('ada@example.com', 'wrong horse');
	assert.ok('refused' in wrong && wrong.refused[0]!.code === 'password');
	const other = await enter.enter('bo@example.com', 'correct horse');
	assert.ok('user' in other && other.created === true && other.user !== up.user, 'a new email is a new user');
	await store.stop();
});

test('two hashes of one password differ, and a document whose hash is not a hash never verifies', async () => {
	const store = newStore();
	const { session } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const a = await enter.enter('a@example.com', 'same');
	const b = await enter.enter('b@example.com', 'same');
	const [ha, hb] = await Promise.all(['user' in a ? a.user : '', 'user' in b ? b.user : ''].map(async (id) => {
		const held = await store.open(`user:${id}`);
		const hash = (held.root as UserDocument).password;
		await store.close(held);
		return hash;
	}));
	assert.notEqual(ha, hb, 'a fresh salt per hash');

	const held = await store.open('user:' + ('user' in a ? a.user : ''));
	const [, N, r, p, salt, hash] = ha!.split('$');
	// Every way the stored text can fail to be a hash of this battery's, and one that is a hash
	// whose parameters scrypt itself refuses: none of them verifies, and none throws.
	for (const broken of [
		'not a hash', 42, null, `bcrypt$${N}$${r}$${p}$${salt}$${hash}`, 'scrypt', `scrypt$${N}$${r}$${p}$${salt}`, `scrypt$${N}$${r}$${p}$${salt}$`,
		`scrypt$3$${r}$${p}$${salt}$${hash}`,
	]) {
		(held.root as Record<string, unknown>).password = broken;
		await store.settled(held);
		const outcome = await enter.enter('a@example.com', 'same');
		assert.ok('refused' in outcome, JSON.stringify(broken));
	}
	await store.close(held);
	await store.stop();
});

test('POST /api/session signs up with 201 and in with 200, sets the cookie, and refuses the rest by status', async () => {
	const store = newStore();
	const { session, issued } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session });
	const route = enter.routes['POST /api/session']!;
	const anonymous = { user: null, session: null };

	const up = await route(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'correct horse' }), anonymous);
	assert.equal(up.status, 201);
	const made = await up.json() as { user: string; created: boolean };
	assert.equal(made.created, true);
	assert.deepEqual(up.headers.getSetCookie(), ['session=AAAAAAAAAAAAAAAA; Path=/; HttpOnly; SameSite=Lax']);
	assert.deepEqual(issued, [made.user]);

	const back = await route(jsonRequest('/api/session', 'POST', { email: 'ADA@example.com', password: 'correct horse' }), anonymous);
	assert.equal(back.status, 200);
	assert.deepEqual(await back.json(), { user: made.user, created: false });

	const wrong = await route(jsonRequest('/api/session', 'POST', { email: 'ada@example.com', password: 'wrong horse' }), anonymous);
	assert.equal(wrong.status, 401);
	assert.deepEqual(await wrong.json(), { reasons: [{ code: 'password', message: 'the password is wrong' }] });
	assert.equal(issued.length, 2, 'nothing was issued for the refusal');

	for (const [body, code] of [
		[{ email: 'not an email', password: 'pw' }, 'email'],
		[{ password: 'pw' }, 'email'],
		[{ email: 'x@y.z', password: '' }, 'password'],
		[{ email: 'x@y.z' }, 'password'],
		[[1, 2], 'email'],
	] as const) {
		const bad = await route(jsonRequest('/api/session', 'POST', body), anonymous);
		assert.equal(bad.status, 400, JSON.stringify(body));
		assert.equal((await bad.json() as { reasons: { code: string }[] }).reasons[0]!.code, code);
	}
	const notJson = await route(request('/api/session', { method: 'POST', body: 'email=x' }), anonymous);
	assert.equal(notJson.status, 400);
	await store.stop();
});

// --- the bounds on the route (design 275) ------------------------------------------------------

const routeOf = async (config: Record<string, unknown> = {}) => {
	const store = newStore();
	const { session } = stubSession();
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session }, config);
	return { store, route: enter.routes['POST /api/session']! };
};
const from = (address: string | undefined): AuthContext => ({ user: null, session: null, address });
const post = (email: string, password: string): Request => jsonRequest('/api/session', 'POST', { email, password });
const users = async (store: Store, email: string): Promise<number> =>
	(await store.find({ where: [{ field: 'email', op: 'eq', value: email }] })).length;

test('a password under the floor or over the ceiling is refused before anything is hashed, and any composition of eight is taken', async () => {
	const { store, route } = await routeOf();
	const short = await route(post('ada@example.com', 'sevench'), from('1.1.1.1'));
	assert.equal(short.status, 400);
	assert.deepEqual(await short.json(), { reasons: [{ code: 'password', message: 'password is 8 to 256 characters' }] });
	assert.equal((await route(post('ada@example.com', 'x'.repeat(257)), from('1.1.1.1'))).status, 400);
	assert.equal(await users(store, 'ada@example.com'), 0, 'nothing was made for a refused password');
	assert.equal((await route(post('ada@example.com', 'x'.repeat(256)), from('1.1.1.1'))).status, 201, 'exactly the ceiling');
	assert.equal((await route(post('bo@example.com', '        '), from('1.1.1.1'))).status, 201, 'eight spaces');
	assert.equal((await route(post('cy@example.com', '🧵🧵🧵🧵🧵🧵🧵🧵'), from('1.1.1.1'))).status, 201, 'eight characters, counted as characters and not code units');
	assert.equal((await route(post('di@example.com', 'a'.repeat(7) + '🧵'), from('1.1.1.1'))).status, 201);
	await store.stop();
});

test('the sixth attempt on one email in the window is 429 with Retry-After whatever the password, and a success clears the count', async () => {
	const { store, route } = await routeOf({ attemptsWindowMs: 60_000 });
	assert.equal((await route(post('ada@example.com', 'correct horse'), from('1.1.1.1'))).status, 201, 'the sign-up counts and then clears');
	for (let i = 0; i < 5; i++) assert.equal((await route(post('ada@example.com', 'wrong horse'), from('1.1.1.1'))).status, 401, `wrong attempt ${String(i + 1)}`);
	const sixth = await route(post('ADA@example.com ', 'correct horse'), from('2.2.2.2'));
	assert.equal(sixth.status, 429, 'the right password, another address and another spelling of the email change nothing');
	assert.equal(sixth.headers.get('retry-after'), '60');
	assert.deepEqual(await sixth.json(), { reasons: [{ code: 'attempts', message: 'too many sign-in attempts; wait and try again' }] });
	assert.equal((await route(post('bo@example.com', 'correct horse'), from('1.1.1.1'))).status, 201, 'another email has its own count');
	await store.stop();

	const cleared = await routeOf({ attemptsPerEmail: 2, attemptsWindowMs: 60_000 });
	assert.equal((await cleared.route(post('ada@example.com', 'correct horse'), from('1.1.1.1'))).status, 201);
	assert.equal((await cleared.route(post('ada@example.com', 'wrong horse'), from('1.1.1.1'))).status, 401);
	assert.equal((await cleared.route(post('ada@example.com', 'correct horse'), from('1.1.1.1'))).status, 200, 'the second, and it clears');
	assert.equal((await cleared.route(post('ada@example.com', 'wrong horse'), from('1.1.1.1'))).status, 401, 'counting from nothing again');
	assert.equal((await cleared.route(post('ada@example.com', 'wrong horse'), from('1.1.1.1'))).status, 401);
	assert.equal((await cleared.route(post('ada@example.com', 'correct horse'), from('1.1.1.1'))).status, 429);
	await cleared.store.stop();
});

test('requests from one address are counted whatever the emails, twenty a window with nothing set, and another address goes on', async () => {
	const { store, route } = await routeOf({ attemptsPerAddress: 3, attemptsWindowMs: 60_000 });
	for (let i = 0; i < 3; i++) assert.equal((await route(post(`u${String(i)}@example.com`, 'correct horse'), from('9.9.9.9'))).status, 201);
	const over = await route(post('u9@example.com', 'correct horse'), from('9.9.9.9'));
	assert.equal(over.status, 429);
	assert.equal(over.headers.get('retry-after'), '60');
	assert.equal(await users(store, 'u9@example.com'), 0, 'nothing was made');
	assert.equal((await route(post('u9@example.com', 'correct horse'), from('8.8.8.8'))).status, 201);
	assert.equal((await route(post('u10@example.com', 'correct horse'), from(undefined))).status, 201, 'no address counts as one address');
	await store.stop();

	const shipped = await routeOf();
	for (let i = 0; i < 20; i++) assert.equal((await shipped.route(post(`u${String(i)}@example.com`, 'correct horse'), from('9.9.9.9'))).status, 201);
	assert.equal((await shipped.route(post('u20@example.com', 'correct horse'), from('9.9.9.9'))).status, 429, 'the twenty-first');
	await shipped.store.stop();
});

test('hashing in flight is bounded: past the bound the route answers 503 with Retry-After and starts no hash', async () => {
	const { store, route } = await routeOf({ hashesInFlight: 2, attemptsPerAddress: 100 });
	const answers = await Promise.all([0, 1, 2, 3, 4].map((i) => route(post(`u${String(i)}@example.com`, 'correct horse'), from('1.1.1.1'))));
	assert.deepEqual(answers.map((a) => a.status).sort(), [201, 201, 503, 503, 503]);
	const busy = answers.find((a) => a.status === 503)!;
	assert.equal(busy.headers.get('retry-after'), '1');
	assert.deepEqual(await busy.json(), { reasons: [{ code: 'busy', message: 'too many sign-ins are being checked; try again in a moment' }] });
	let made = 0;
	for (let i = 0; i < 5; i++) made += await users(store, `u${String(i)}@example.com`);
	assert.equal(made, 2, 'the three refused were never hashed or stored');
	assert.equal((await route(post('u9@example.com', 'correct horse'), from('1.1.1.1'))).status, 201, 'room again once those finished');
	await store.stop();
});

test('refusePassword is asked after the counts, sync or async, and a true refuses with 400', async () => {
	const asked: string[] = [];
	const { store, route } = await routeOf({ refusePassword: (p: string) => { asked.push(p); return p === 'password1'; } });
	const refused = await route(post('ada@example.com', 'password1'), from('1.1.1.1'));
	assert.equal(refused.status, 400);
	assert.deepEqual(await refused.json(), { reasons: [{ code: 'password', message: 'that password is not allowed here' }] });
	assert.equal((await route(post('ada@example.com', 'correct horse'), from('1.1.1.1'))).status, 201);
	assert.deepEqual(asked, ['password1', 'correct horse']);
	assert.equal(await users(store, 'ada@example.com'), 1);
	await store.stop();

	const async = await routeOf({ refusePassword: async () => true });
	assert.equal((await async.route(post('ada@example.com', 'correct horse'), from('1.1.1.1'))).status, 400);
	await async.store.stop();
});

test('a setting that is not a positive number, a ceiling under the floor, or a refusePassword that is not a function is refused when the module is made', async () => {
	const store = newStore();
	const { session } = stubSession();
	for (const config of [
		{ attemptsPerEmail: 0 }, { attemptsPerAddress: -1 }, { attemptsWindowMs: 'soon' }, { attemptsWindowMs: 2_147_483_648 },
		{ hashesInFlight: 0 }, { passwordMin: 0 }, { passwordMax: 4 }, { refusePassword: 'no' },
	]) {
		await assert.rejects(module<Enter>('Enter', store, { 'auth/Session': session }, config), /invalid-config|invalid-limit/, JSON.stringify(config));
	}
	await store.stop();
});

test('checkPassword answers the reasons the route would refuse with: not text, outside the length, or refused by refusePassword, in that order', async () => {
	const store = newStore();
	const { session } = stubSession();
	const asked: unknown[] = [];
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session }, { passwordMin: 4, passwordMax: 6, refusePassword: (p: string) => { asked.push(p); return p === 'nope1'; } });
	assert.deepEqual(await enter.checkPassword(undefined), [{ code: 'password', message: 'password is text' }]);
	assert.deepEqual(await enter.checkPassword(''), [{ code: 'password', message: 'password is text' }]);
	assert.deepEqual(await enter.checkPassword('abc'), [{ code: 'password', message: 'password is 4 to 6 characters' }]);
	assert.deepEqual(await enter.checkPassword('abcdefg'), [{ code: 'password', message: 'password is 4 to 6 characters' }]);
	assert.deepEqual(asked, [], 'refusePassword is not asked about a password the shape refuses');
	assert.deepEqual(await enter.checkPassword('nope1'), [{ code: 'password', message: 'that password is not allowed here' }]);
	assert.deepEqual(await enter.checkPassword('fine1'), []);
	assert.deepEqual(asked, ['nope1', 'fine1']);
	await store.stop();
});

test('sign-up hands the new user to auth/Roles for the first grant, and sign-in does not', async () => {
	const store = newStore();
	const { session } = stubSession();
	const offered: string[] = [];
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session, 'auth/Roles': { first: async (user: string) => { offered.push(user); return true; } } });
	const up = await enter.enter('ada@example.com', 'correct horse');
	assert.ok('user' in up && up.created);
	assert.deepEqual(offered, [up.user]);
	await enter.enter('ada@example.com', 'correct horse');
	assert.deepEqual(offered, [up.user], 'a sign-in offers nobody');
	await store.stop();
});
