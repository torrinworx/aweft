// auth/Google: the code flow with PKCE, and auth/Enter's enterConfirmed behind it (design 318).
// Google is stood in for by the module's `fetch`, so every case runs with no network.

import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Store } from '@aweftjs/store';

import type { AuthContext, SignUp } from '../src/index.ts';
import type { Enter, UserDocument } from '../src/modules/Enter.ts';
import type { Google, GoogleFetch } from '../src/modules/Google.ts';
import type { Roles } from '../src/modules/Roles.ts';
import type { Session } from '../src/modules/Session.ts';

import { module, newStore, request } from './helpers.ts';

const CLIENT = 'client-1.apps.googleusercontent.com';
const CALLBACK = 'https://app.test/api/auth/google/callback';
const CONTEXT: AuthContext = { user: null, session: null, address: '127.0.0.1' };

/** An ID token as Google's token endpoint hands one out: three base64url parts, the middle the claims. */
const idToken = (claims: Record<string, unknown>): string =>
	['{"alg":"RS256"}', JSON.stringify(claims), 'signature'].map((part) => Buffer.from(part).toString('base64url')).join('.');

const claimsFor = (email: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
	iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600,
	email, email_verified: true, name: 'Ada Lovelace', ...extra,
});

interface Rig {
	store: Store;
	google: Google;
	enter: Enter;
	roles: Roles;
	session: Session;
	/** What the stand-in token endpoint was sent, one form body per call. */
	sent: URLSearchParams[];
	/** What the stand-in answers next: claims for an ID token, or a failure. */
	next: { value: Record<string, unknown> | 'fail' | 'throw' | 'no-token' };
}

const rig = async (enterConfig: Record<string, unknown> = {}): Promise<Rig> => {
	const store = newStore();
	const { instance: roles } = await module<Roles>('Roles', store);
	const { instance: session } = await module<Session>('Session', store);
	const { instance: enter } = await module<Enter>('Enter', store, { 'auth/Session': session, 'auth/Roles': roles }, enterConfig);
	const sent: URLSearchParams[] = [];
	const next: Rig['next'] = { value: claimsFor('ada@example.com') };
	const fetch: GoogleFetch = async (url, init) => {
		assert.equal(url, 'https://oauth2.googleapis.com/token');
		sent.push(new URLSearchParams(init.body));
		const answer = next.value;
		if (answer === 'throw') throw new Error('the network is down');
		if (answer === 'fail') return { ok: false, json: async () => ({ error: 'invalid_grant' }) };
		return { ok: true, json: async () => (answer === 'no-token' ? {} : { id_token: idToken(answer) }) };
	};
	const { instance: google } = await module<Google>('Google', store, { 'auth/Session': session, 'auth/Enter': enter }, {
		clientId: CLIENT, clientSecret: 'secret-1', callback: CALLBACK, fetch,
	});
	return { store, google, enter, roles, session, sent, next };
};

const route = (google: Google, name: string): (request: Request, context: AuthContext) => Promise<Response> => google.routes[name]!;

/** Start a flow and answer the callback with the state and cookie it handed out. */
const start = async (google: Google, returnTo?: string): Promise<{ location: URL; cookie: string; state: string }> => {
	const answer = await route(google, 'GET /api/auth/google')(request(`/api/auth/google${returnTo === undefined ? '' : `?return=${encodeURIComponent(returnTo)}`}`), CONTEXT);
	assert.equal(answer.status, 302);
	const location = new URL(answer.headers.get('location')!);
	const cookie = answer.headers.get('set-cookie')!;
	return { location, cookie, state: location.searchParams.get('state')! };
};

const callback = async (google: Google, query: Record<string, string>, cookie?: string): Promise<{ status: number; location: string; cookies: string[] }> => {
	const answer = await route(google, 'GET /api/auth/google/callback')(
		request(`/api/auth/google/callback?${new URLSearchParams(query).toString()}`, cookie === undefined ? {} : { headers: { cookie } }),
		CONTEXT,
	);
	return { status: answer.status, location: answer.headers.get('location')!, cookies: answer.headers.getSetCookie() };
};

const flowValue = (setCookie: string): string => setCookie.slice(0, setCookie.indexOf(';'));

const userOf = async (store: Store, id: string): Promise<UserDocument> => {
	const handle = await store.open(`user:${id}`);
	const held = { ...(handle.root as UserDocument) };
	await store.close(handle);
	return held;
};

test('auth/Google refuses a missing or wrong setting as it is made, naming the fix', async () => {
	const store = newStore();
	const imports = { 'auth/Session': {}, 'auth/Enter': {} };
	const base = { clientId: CLIENT, clientSecret: 's', callback: CALLBACK };
	for (const config of [{ clientId: null }, { clientSecret: '' }, { callback: null }, { callback: 'not a url' }, { callback: 'ftp://app.test/cb' }, { fetch: 'no' }]) {
		await assert.rejects(module('Google', store, imports, { ...base, ...config }), /invalid-config: auth\/Google was given/, JSON.stringify(config));
	}
});

test('the start route sends the browser to Google with a PKCE challenge, and binds the flow to it in a cookie', async () => {
	const { google } = await rig();
	const { location, cookie, state } = await start(google, '/notes?tab=2');
	assert.equal(`${location.origin}${location.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
	const query = location.searchParams;
	assert.equal(query.get('client_id'), CLIENT);
	assert.equal(query.get('redirect_uri'), CALLBACK);
	assert.equal(query.get('response_type'), 'code');
	assert.equal(query.get('scope'), 'openid email profile');
	assert.equal(query.get('code_challenge_method'), 'S256');
	assert.match(state, /^[A-Za-z0-9_-]{22}$/);
	assert.match(cookie, /^google_flow=[^;]+; Path=\/api\/auth\/google; HttpOnly; SameSite=Lax; Max-Age=600$/,
		'scoped to the two routes, unread by script, gone in ten minutes; no Secure over plain HTTP');
	const [held, verifier, path] = flowValue(cookie).slice('google_flow='.length).split('.');
	assert.equal(held, state, 'the cookie holds the state Google will hand back');
	assert.equal(query.get('code_challenge'), createHash('sha256').update(verifier!).digest('base64url'),
		'the challenge is the S256 of the verifier the cookie keeps (RFC 7636)');
	assert.equal(decodeURIComponent(path!), '/notes?tab=2');

	const secure = await route(google, 'GET /api/auth/google')(new Request('https://app.test/api/auth/google'), CONTEXT);
	assert.match(secure.headers.get('set-cookie')!, /; Secure$/, 'over TLS the cookie is Secure');
});

test('a return that is not a path on this site is the home page, so the flow never sends anyone to another host', async () => {
	const { google } = await rig();
	for (const [asked, kept] of [['//evil.test/x', '/'], ['/\\evil.test', '/'], ['https://evil.test', '/'], ['notes', '/'], [undefined, '/'], ['/ok', '/ok']] as const) {
		const { cookie } = await start(google, asked);
		assert.equal(decodeURIComponent(flowValue(cookie).split('.')[2]!), kept, String(asked));
	}
});

test('a new address Google confirmed makes an account with no password, confirmed and verified, and signs it in', async () => {
	const { store, google, roles, enter, sent } = await rig();
	const heard: string[] = [];
	enter.afterSignUp((user) => { heard.push(user); });
	const { cookie, state } = await start(google, '/forum?submit');
	const answer = await callback(google, { code: 'code-1', state }, flowValue(cookie));

	assert.equal(answer.status, 302);
	assert.equal(answer.location, '/forum?submit', 'back where the flow started, with nothing added');
	assert.equal(sent.length, 1);
	assert.equal(sent[0]!.get('code'), 'code-1');
	assert.equal(sent[0]!.get('client_secret'), 'secret-1');
	assert.equal(sent[0]!.get('redirect_uri'), CALLBACK);
	assert.equal(sent[0]!.get('code_verifier'), flowValue(cookie).split('.')[1], 'the verifier the start route kept is what proves the code');
	assert.match(answer.cookies[0]!, /^google_flow=; .*Max-Age=0/, 'the flow cookie is cleared');
	const session = answer.cookies.find((one) => one.startsWith('session='))!;
	assert.match(session, /^session=[A-Za-z0-9_-]{22}; Path=\/; HttpOnly; SameSite=Lax/, 'and a session is set');

	assert.equal(heard.length, 1, 'afterSignUp hears the account');
	const doc = await userOf(store, heard[0]!);
	assert.equal(doc.email, 'ada@example.com');
	assert.equal(doc.name, 'Ada Lovelace');
	assert.equal(doc.password, '', 'no password is set');
	assert.equal(doc.emailVerified, true);
	assert.equal(await roles.may(heard[0]!, 'verified'), true, 'and verified is granted');
	const typed = await enter.enter('ada@example.com', '');
	assert.ok('refused' in typed, 'no password signs in to it, the empty one included');
	await store.stop();
});

test('an address that already has an account signs in to that account, which is now confirmed', async () => {
	const { store, google, roles, enter } = await rig();
	const made = await enter.enter('ada@example.com', 'correct horse');
	assert.ok('user' in made);
	const heard: string[] = [];
	enter.afterSignUp((user) => { heard.push(user); });

	const { cookie, state } = await start(google);
	const answer = await callback(google, { code: 'c', state }, flowValue(cookie));
	assert.equal(answer.location, '/');
	assert.ok(answer.cookies.some((one) => one.startsWith('session=')));
	const doc = await userOf(store, made.user);
	assert.equal(doc.emailVerified, true, 'the address is confirmed now');
	assert.equal(doc.name, null, 'a name the person never gave the account is not written over an existing one');
	assert.equal(await roles.may(made.user, 'verified'), true);
	assert.deepEqual(heard, [], 'a sign-in is not a sign-up');
	assert.deepEqual(await enter.enter('ada@example.com', 'correct horse'), { user: made.user, created: false }, 'and the password still works');
	await store.stop();
});

test('the callback refuses what it cannot trust, and says why on the page that started it', async () => {
	const { store, google, next } = await rig();
	const failing = async (value: Rig['next']['value'], query: Record<string, string> = {}): Promise<string> => {
		next.value = value;
		const { cookie, state } = await start(google, '/join');
		const answer = await callback(google, { code: 'c', state, ...query }, flowValue(cookie));
		assert.ok(!answer.cookies.some((one) => one.startsWith('session=')), 'no session on a refusal');
		assert.match(answer.cookies[0]!, /^google_flow=; /, 'the flow is cleared either way');
		return answer.location;
	};
	assert.equal(await failing(claimsFor('a@example.com'), { error: 'access_denied' }), '/join?auth=cancelled');
	assert.equal(await failing('fail'), '/join?auth=google', 'the token endpoint said no');
	assert.equal(await failing('throw'), '/join?auth=google', 'the token endpoint was unreachable');
	assert.equal(await failing('no-token'), '/join?auth=google', 'an answer with no ID token');
	assert.equal(await failing(claimsFor('a@example.com', { aud: 'someone-else' })), '/join?auth=google', 'a token minted for another client');
	assert.equal(await failing(claimsFor('a@example.com', { iss: 'https://evil.test' })), '/join?auth=google', 'a token from another issuer');
	assert.equal(await failing(claimsFor('a@example.com', { exp: Math.floor(Date.now() / 1000) - 60 })), '/join?auth=google', 'an expired token');
	assert.equal(await failing(claimsFor('a@example.com', { email: undefined })), '/join?auth=google', 'a token with no email');
	assert.equal(await failing(claimsFor('a@example.com', { email_verified: false })), '/join?auth=unverified', 'an address Google has not confirmed');
	const { state } = await start(google, '/join');
	assert.equal((await callback(google, { state })).location, '/?auth=google', 'no flow cookie: this browser never started it');
	const { cookie } = await start(google, '/join');
	assert.equal((await callback(google, { code: 'c', state: 'AAAAAAAAAAAAAAAAAAAAAA' }, flowValue(cookie))).location, '/?auth=google',
		'a state that is not this browser\'s flow');
	const begun = await start(google, '/join');
	assert.equal((await callback(google, { state: begun.state }, flowValue(begun.cookie))).location, '/join?auth=google', 'no code');
	await store.stop();
});

test('the application\'s sign-up rule closes the door to a Google sign-up, and a sign-in never asks it', async () => {
	const asked: SignUp[] = [];
	const { store, google, enter } = await rig({
		refuseSignUp: (signUp: SignUp) => { asked.push(signUp); return { code: 'invite', message: 'sign-up is by invitation' }; },
	});
	const { cookie, state } = await start(google, '/join');
	assert.equal((await callback(google, { code: 'c', state }, flowValue(cookie))).location, '/join?auth=invite');
	assert.equal(asked.length, 1);
	assert.equal(asked[0]!.email, 'ada@example.com');
	assert.deepEqual(asked[0]!.extra, {});
	assert.equal(asked[0]!.context, CONTEXT);
	assert.equal(await enter.enterConfirmed('bad', { context: CONTEXT }).then((one) => 'refused' in one && one.refused[0]!.code), 'email');
	await store.stop();
});

test('two confirmed admissions of one address at once make one account', async () => {
	const { store, enter } = await rig();
	const [a, b] = await Promise.all([
		enter.enterConfirmed('ada@example.com', { context: CONTEXT }),
		enter.enterConfirmed('Ada@Example.com', { context: CONTEXT }),
	]);
	assert.ok('user' in a && 'user' in b);
	assert.equal(a.user, b.user);
	assert.deepEqual([a.created, b.created], [true, false]);
	await store.stop();
});
