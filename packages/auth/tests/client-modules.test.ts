// The battery on the page: the source, the session module over a connection, and the form.
//
// Every case here loads the modules through a real loader, the way a stage does, so what is
// under test is the source and the wiring as an application meets it (design 245). The server
// behind them is the real battery over the in-memory socket pair the other suites use.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClient } from '@aweftjs/client';
import type { Client } from '@aweftjs/client';
import { codecError } from '@aweftjs/codec';
import { mutable } from '@aweftjs/core';
import { createDocument } from '@aweftjs/dom';
import { createRouter } from '@aweftjs/dom/router';
import type { LightElement, NodeLike } from '@aweftjs/dom';
import { createLoader, fromBundle } from '@aweftjs/modules';
import type { Source } from '@aweftjs/modules';
import { createServer } from '@aweftjs/server';
import { Stage, StageContext, context, h, isText, mount, render, textOf } from '@aweftjs/ui';

import { auth } from '../src/index.ts';
import { authClient } from '../src/client.ts';
import type { Auth } from '../src/client.ts';

import { fakeListener, newStore, page, reasonOf, settle } from './helpers.ts';

const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://app.test';

/** Every element under a node, in order. */
const elements = (from: NodeLike | null): LightElement[] => {
	const found: LightElement[] = [];
	for (let node = from; node !== null; node = node.nextSibling) {
		if (node.nodeType === 1) found.push(node as LightElement);
		found.push(...elements(node.firstChild));
	}
	return found;
};

const byName = (root: NodeLike | null, name: string): LightElement =>
	elements(root).find((node) => node.getAttribute('name') === name)!;

const byTag = (root: NodeLike | null, tag: string): LightElement =>
	elements(root).find((node) => node.localName === tag)!;

/** Deliver one event the way the host would, with the element as its target. */
const fire = (element: LightElement, type: string, extra: Record<string, unknown> = {}): void => {
	(element as unknown as { dispatchEvent(event: unknown): boolean })
		.dispatchEvent({ type, target: element, ...extra });
};

/** A source of extra files, for a configuration over a battery module or a stand-in for one. */
const extra = (map: Readonly<Record<string, Record<string, unknown>>>): Source =>
	fromBundle(map as never, { prefix: '' });

test('the client source lists the four modules a page puts on a stage', async () => {
	const names = (await authClient.candidates()).map((candidate) => candidate.name).sort();
	assert.deepEqual(names, ['auth/Reset', 'auth/Session', 'auth/SignIn', 'auth/Verify']);
});

test('auth/Session is createAuth over the client the loader was given', async () => {
	const store = newStore();
	const listening = fakeListener();
	const server = createServer({ sources: [auth], store, gate: 'auth/Gate', listener: listening.listener });
	await server.start();
	const seams = page(listening.handlers);
	const client = createClient({ url: 'ws://app.test/', open: seams.open, reconnect: false });

	// The two settings the module takes come in as configuration, from a file that carries only
	// `config` in an earlier source, which is how any battery module is configured.
	const loader = createLoader({
		sources: [extra({ 'auth/Session.ts': { config: { origin: ORIGIN, fetch: seams.fetch } } }), authClient],
		props: { client },
	});
	const session = (await loader.load(['auth/Session']))['auth/Session'] as Auth;

	await settle();
	assert.equal(session.user.get(), null, 'the connection answered, and it is nobody');
	const entered = await session.enter('ada@example.com', PASSWORD);
	assert.ok('user' in entered && entered.created, 'signing up through the module made an account');
	assert.equal(session.user.get(), (entered as { user: string }).user, 'and the page reads the id');

	// The loader's unload is what stops it: `stop` on the instance is the module contract's.
	await loader.unload('auth/Session');
	await assert.rejects(() => session.check('ada@example.com'), (error: unknown) => reasonOf(error) === 'stopped');

	client.close();
	await server.stop();
	await store.stop();
});

test('handed no client, auth/Session is anonymous at once and nothing waits', async () => {
	// A static render has no socket, so identity is a known answer rather than a pending one: a
	// factory that awaits `user` used to never return, and `render` waits on every pending promise,
	// so the whole render hung (design 245).
	const loader = createLoader({ sources: [authClient] });
	const session = (await loader.load(['auth/Session']))['auth/Session'] as Auth;

	assert.equal(session.user.get(), null, 'nobody, from the first read, with nothing to wait for');

	// What a gate does: wait for the first answer that is not `undefined`. There is one already.
	let answered: string | null | undefined = 'unset';
	const waiting = new Promise<void>((done) => {
		const held = session.user.get();
		if (held !== undefined) {
			answered = held;
			done();
		}
	});
	await waiting;
	assert.equal(answered, null, 'so a gate awaiting identity refuses rather than hanging');

	const refusal = await session.state().ready.then(() => 'shared', reasonOf);
	assert.equal(refusal, 'anonymous', 'the state document is refused the way an anonymous connection is');

	// The three calls that need a connection say so, rather than waiting for one that never comes.
	for (const call of [
		() => session.enter('ada@example.com', PASSWORD),
		() => session.leave(),
		() => session.check('ada@example.com'),
	]) {
		await assert.rejects(call, (error: unknown) => {
			assert.equal(reasonOf(error), 'no-client');
			assert.match(String((error as { fix: string }).fix), /createClient/);
			return true;
		});
	}
	await loader.unload('auth/Session');
});

test('a client that is not one is refused as no-client, with the fix on the error', async () => {
	const loader = createLoader({ sources: [authClient], props: { client: { ask: () => undefined } } });
	await assert.rejects(
		() => loader.load(['auth/Session']),
		(error: unknown) => {
			const cause = (error as { cause?: unknown }).cause;
			assert.equal(reasonOf(cause), 'no-client');
			assert.match(String((cause as { fix: string }).fix), /createClient/);
			return true;
		},
	);
});

test('auth/SignIn calls enter, and shows the refusal it answers with', async () => {
	const calls: [string, string][] = [];
	let answer: unknown = { refused: [{ code: 'password', message: 'the password is wrong' }] };
	const loader = createLoader({
		sources: [
			extra({
				'auth/Session.ts': {
					default: () => ({
						enter: async (email: string, password: string) => {
							calls.push([email, password]);
							if (answer === 'throw') throw new Error('the server is down');
							return answer;
						},
					}),
				},
			}),
			authClient,
		],
	});

	const act = (await loader.load(['auth/SignIn']))['auth/SignIn'] as {
		title: unknown;
		component: () => unknown;
	};
	assert.ok(isText(act.title), 'the act names itself for the live region, as a text token');
	assert.equal(textOf(context(), act.title), 'Sign in');

	const document = createDocument();
	const stop = mount(document.body as never, h(act.component, {}));

	const email = byName(document.body.firstChild, 'email');
	const password = byName(document.body.firstChild, 'password');
	assert.equal(password.getAttribute('type'), 'password', 'the password is typed as one');

	(email as unknown as Record<string, unknown>)['value'] = 'ada@example.com';
	fire(email, 'input');
	(password as unknown as Record<string, unknown>)['value'] = 'wrong';
	fire(password, 'input');
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();

	assert.deepEqual(calls, [['ada@example.com', 'wrong']], 'the submit is one call to enter');
	assert.match(document.body.textContent ?? '', /the password is wrong/,
		'and the refusal is on the form where the person can read it');

	// A refusal that named no field is still readable: it goes on the form's own alert line.
	answer = { refused: [{ code: 'locked', message: 'this account is locked' }] };
	fire(byTag(document.body.firstChild, 'form'), 'submit', { preventDefault: () => undefined });
	await settle();
	assert.equal(calls.length, 2, 'the Enter key reaches the form\'s own handler');
	assert.match(document.body.textContent ?? '', /this account is locked/);

	// The route itself failing is not a refusal, and the person still has to be told something.
	answer = 'throw';
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.match(document.body.textContent ?? '', /the server is down/, 'a throw from enter is shown too');

	answer = { user: 'u1', created: false };
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.equal(calls.length, 4, 'a fourth submit is a fourth call');
	assert.doesNotMatch(document.body.textContent ?? '', /locked|down|wrong/,
		'and a success clears what the last refusal said');

	stop();
	await loader.unload('auth/SignIn');
});

test('auth/SignIn calls the retry it was handed once enter succeeds, and not on a refusal', async () => {
	// The form still picks no URL. What it does is tell the stage the reason has stopped holding,
	// so the act the URL chose is built again at the address the visitor asked for (design 244).
	let answer: unknown = { refused: [{ code: 'password', message: 'the password is wrong' }] };
	const loader = createLoader({
		sources: [
			extra({ 'auth/Session.ts': { default: () => ({ enter: async () => answer }) } }),
			authClient,
		],
	});

	const act = (await loader.load(['auth/SignIn']))['auth/SignIn'] as {
		component: (props: { retry?: () => void }) => unknown;
	};

	let retries = 0;
	const document = createDocument();
	const stop = mount(document.body as never, h(act.component, { retry: () => { retries += 1; } }));

	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.equal(retries, 0, 'a refusal leaves the visitor on the form');
	assert.match(document.body.textContent ?? '', /the password is wrong/);

	answer = { user: 'u1', created: true };
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.equal(retries, 1, 'and signing up asks for the act the URL chose');

	stop();
	await loader.unload('auth/SignIn');
});

test('auth/SignIn handed no retry signs in and does nothing more', async () => {
	// The act on a URL of its own is not standing in for anything, so there is nothing to rebuild.
	const loader = createLoader({
		sources: [
			extra({ 'auth/Session.ts': { default: () => ({ enter: async () => ({ user: 'u1', created: false }) }) } }),
			authClient,
		],
	});
	const act = (await loader.load(['auth/SignIn']))['auth/SignIn'] as { component: (props: object) => unknown };
	const document = createDocument();
	const stop = mount(document.body as never, h(act.component, {}));

	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.doesNotMatch(document.body.textContent ?? '', /is not a function|undefined/,
		'the form survives a success with no retry on its props');

	stop();
	await loader.unload('auth/SignIn');
});

test('a static render of a gated act finishes, and the sign-in act is what its markup holds', async () => {
	// The failure this guards against: over a client that never opened, a gate awaiting identity
	// never returned, `render` waits on every promise a component handed `pending`, and this
	// render was still running after six seconds (design 245).
	const site = extra({
		'site/Gate.ts': {
			deps: ['auth/Session'],
			default: ({ imports }: { imports: Readonly<Record<string, unknown>> }) => ({
				require: async (): Promise<string> => {
					const session = imports['Session'] as Auth;
					const held = session.user.get();
					// `undefined` is not an answer, and `null` is: only the first is waited for.
					const who = held !== undefined ? held : await new Promise<string | null>((done) => {
						const off = session.user.watch((now) => {
							if (now === undefined) return;
							off();
							done(now);
						});
					});
					if (who === null) {
						throw codecError('anonymous', 'this page is for a signed-in user', 'Sign in first.');
					}
					return who;
				},
			}),
		},
		'notes/Page.ts': {
			deps: ['site/Gate'],
			default: async ({ imports }: { imports: Readonly<Record<string, unknown>> }) => {
				await (imports['Gate'] as { require(): Promise<string> }).require();
				return { component: (): unknown => h('main', { id: 'notes' }, 'notes') };
			},
		},
	});

	const markup = await render(h(StageContext, {
		router: createRouter({ url: '/notes' }),
		sources: [site, authClient],
		acts: { notes: 'notes/Page', join: 'auth/SignIn' },
		refused: 'join',
	} as never, h(Stage, {})), { context: context() });

	assert.match(markup, /aria-label="Sign in"/, 'the refused act is what a static render of a gated page holds');
	assert.doesNotMatch(markup, /id="notes"/, 'and the page behind the gate is not in the markup');
});

/** A stage value with the parameters and query given, the way an act reads them off its prop. */
const stageOf = (params: Record<string, string>, query: Record<string, string> = {}): unknown =>
	({ params: { get: () => params }, query: { get: () => query } });

test('auth/Verify with a token takes it as it mounts and says what happened; without one it offers a signed-in person the mail', async () => {
	const calls: unknown[][] = [];
	let answer: unknown = { ok: true };
	const who = mutable<string | null | undefined>(null);
	const loader = createLoader({
		sources: [
			extra({ 'auth/Session.ts': { default: () => ({ user: who, verify: async (...args: unknown[]) => { calls.push(args); if (answer === 'throw') throw new Error('the server is down'); return answer; } }) } }),
			authClient,
		],
	});
	const act = (await loader.load(['auth/Verify']))['auth/Verify'] as { title: unknown; component: (props: unknown) => unknown };
	assert.equal(textOf(context(), act.title), 'Verify your email');

	// The token in the act's own parameter.
	let document = createDocument();
	let stop = mount(document.body as never, h(act.component, { stage: stageOf({ token: 'AAAAAAAAAAAAAAAAAAAAAA' }) }));
	await settle();
	assert.deepEqual(calls, [['AAAAAAAAAAAAAAAAAAAAAA']], 'taken as it mounted');
	assert.match(document.body.textContent ?? '', /Your email address is verified/);
	stop();

	// The token in the query, and a refusal shown.
	answer = { refused: [{ code: 'token', message: 'this link is not one that can be used' }] };
	document = createDocument();
	stop = mount(document.body as never, h(act.component, { stage: stageOf({}, { token: 'BBBBBBBBBBBBBBBBBBBBBB' }) }));
	await settle();
	assert.deepEqual(calls[1], ['BBBBBBBBBBBBBBBBBBBBBB']);
	assert.match(document.body.textContent ?? '', /not one that can be used/);
	stop();

	// No token: anonymous is told to sign in and the button is off; signed in, the button sends.
	answer = { ok: true };
	document = createDocument();
	stop = mount(document.body as never, h(act.component, { stage: stageOf({}) }));
	await settle();
	assert.equal(calls.length, 2, 'nothing is sent by itself');
	assert.match(document.body.textContent ?? '', /Sign in first/);
	const button = byTag(document.body.firstChild, 'button');
	assert.equal(button.getAttribute('disabled') !== null || (button as unknown as { disabled?: boolean }).disabled === true, true, 'off while anonymous');
	who.set('u_1');
	await settle();
	assert.match(document.body.textContent ?? '', /We will send a link/);
	fire(button, 'click');
	await settle();
	assert.deepEqual(calls[2], [], 'the send is verify with no token');
	assert.match(document.body.textContent ?? '', /on its way/);
	stop();

	answer = 'throw';
	document = createDocument();
	stop = mount(document.body as never, h(act.component, { stage: stageOf({}, { token: 'CCCCCCCCCCCCCCCCCCCCCC' }) }));
	await settle();
	assert.match(document.body.textContent ?? '', /the server is down/, 'a throw is shown too');
	stop();
	await loader.unload('auth/Verify');
});

test('auth/Reset without a token asks for the address and calls forgot; with one it asks for the password and calls reset', async () => {
	const forgot: unknown[][] = [];
	const reset: unknown[][] = [];
	let answer: unknown = { ok: true };
	const loader = createLoader({
		sources: [
			extra({ 'auth/Session.ts': { default: () => ({
				forgot: async (...args: unknown[]) => { forgot.push(args); return answer; },
				reset: async (...args: unknown[]) => { reset.push(args); return answer; },
			}) } }),
			authClient,
		],
	});
	const act = (await loader.load(['auth/Reset']))['auth/Reset'] as { title: unknown; component: (props: unknown) => unknown };
	assert.equal(textOf(context(), act.title), 'Reset your password');

	let document = createDocument();
	let stop = mount(document.body as never, h(act.component, { stage: stageOf({}) }));
	const email = byName(document.body.firstChild, 'email');
	assert.equal(byName(document.body.firstChild, 'password'), undefined, 'no password field without a token');
	(email as unknown as Record<string, unknown>)['value'] = 'ada@example.com';
	fire(email, 'input');
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.deepEqual(forgot, [['ada@example.com']]);
	assert.match(document.body.textContent ?? '', /a link is on its way/);
	stop();

	answer = { refused: [{ code: 'email', message: 'email is an address' }] };
	document = createDocument();
	stop = mount(document.body as never, h(act.component, { stage: stageOf({}) }));
	fire(byTag(document.body.firstChild, 'form'), 'submit', { preventDefault: () => undefined });
	await settle();
	assert.equal(forgot.length, 2, 'the Enter key reaches the form\'s own handler');
	assert.match(document.body.textContent ?? '', /email is an address/, 'the refusal is under the field');
	stop();

	answer = { ok: true };
	document = createDocument();
	stop = mount(document.body as never, h(act.component, { stage: stageOf({ token: 'AAAAAAAAAAAAAAAAAAAAAA' }) }));
	const password = byName(document.body.firstChild, 'password');
	assert.equal(password.getAttribute('type'), 'password');
	assert.equal(byName(document.body.firstChild, 'email'), undefined, 'no email field with a token');
	(password as unknown as Record<string, unknown>)['value'] = 'new horse battery';
	fire(password, 'input');
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.deepEqual(reset, [['AAAAAAAAAAAAAAAAAAAAAA', 'new horse battery']]);
	assert.match(document.body.textContent ?? '', /Your password is set/);
	stop();

	answer = { refused: [{ code: 'token', message: 'this link is not one that can be used' }] };
	document = createDocument();
	stop = mount(document.body as never, h(act.component, { stage: stageOf({}, { token: 'BBBBBBBBBBBBBBBBBBBBBB' }) }));
	fire(byTag(document.body.firstChild, 'button'), 'click');
	await settle();
	assert.deepEqual(reset[1], ['BBBBBBBBBBBBBBBBBBBBBB', '']);
	assert.match(document.body.textContent ?? '', /not one that can be used/, 'a reason about no field goes on the alert line');
	stop();
	await loader.unload('auth/Reset');
});

test('a static render of the three acts finishes with no connection, and holds their forms', async () => {
	const loader = createLoader({ sources: [authClient] });
	for (const [name, expected] of [['auth/Verify', /Sign in first/], ['auth/Reset', /Email/]] as const) {
		const act = (await loader.load([name]))[name] as { component: (props: unknown) => unknown };
		const html = await render(h(act.component, { stage: stageOf({}) }));
		assert.match(html, expected, name);
	}
});
