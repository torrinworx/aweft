// The client half: each source recorded through a fake window, the console put back, a private
// slot never carried, an input value never carried, and the socket never touched (design 261).

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject, mutable, observer } from '@aweftjs/core';
import type { Client, Handle } from '@aweftjs/client';

import { createLog } from '../src/client.ts';
import type { Batch, Entry, WindowLike } from '../src/client.ts';

/** A window whose listeners a test fires by hand, with a console and a beacon it can read. */
const fakeWindow = () => {
	const listeners = new Map<string, ((event: unknown) => void)[]>();
	const docListeners = new Map<string, ((event: unknown) => void)[]>();
	const add = (map: Map<string, ((event: unknown) => void)[]>) => (type: string, fn: (event: unknown) => void) => {
		const held = map.get(type) ?? [];
		held.push(fn);
		map.set(type, held);
	};
	const console = { errors: [] as unknown[][], warns: [] as unknown[][], error(...a: unknown[]) { this.errors.push(a); }, warn(...a: unknown[]) { this.warns.push(a); } };
	const beacons: { url: string; body: string }[] = [];
	const win: WindowLike = {
		addEventListener: add(listeners) as never,
		removeEventListener: (() => {}) as never,
		document: { addEventListener: add(docListeners) as never, removeEventListener: (() => {}) as never },
		location: { origin: 'http://app.test' },
		navigator: {
			userAgent: 'Test/1.0', userAgentData: { brands: [{ brand: 'Test', version: '1' }], platform: 'Linux', mobile: false },
			language: 'en', maxTouchPoints: 0,
			sendBeacon: (url: string, data: unknown) => { beacons.push({ url, body: String(data) }); return true; },
		},
		screen: { width: 1920, height: 1080 }, innerWidth: 900, innerHeight: 700, devicePixelRatio: 2,
		matchMedia: (q: string) => ({ matches: q.includes('dark') }),
		console,
	};
	const fire = (type: string, event: unknown, on: 'window' | 'document' = 'window') =>
		((on === 'window' ? listeners : docListeners).get(type) ?? []).forEach((fn) => fn(event));
	return { win, fire, console, beacons };
};

/** A fake client whose share, ask and status a test drives. */
const fakeClient = () => {
	const status = mutable<'connecting' | 'open' | 'closed'>('connecting');
	const asks: { name: string; args: unknown }[] = [];
	const shared = new Map<string, object>();
	const client: Client = {
		status,
		ask: async (name, args) => { asks.push({ name, args }); if (name === 'app/Fail') throw Object.assign(new Error('no'), { reason: 'refused' }); return 'ok'; },
		share: <T extends object>(name: string, document?: T): Handle<T> => {
			const doc = (document ?? createObject<Record<string, unknown>>({})) as T;
			shared.set(name, doc);
			return { document: doc, ready: Promise.resolve(doc), stop: () => {} };
		},
		reconnect: () => {}, close: () => {},
	};
	return { client, status, asks, shared };
};

const drain = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };

test('the sources are recorded: error, rejection, console, click, key, status, and browser facts at start', async () => {
	const { win, fire, console } = fakeWindow();
	const { client, status } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: win, fetch: async () => new Response(), build: 'abc' });
	log.each((e) => seen.push(e));

	fire('error', { message: 'boom', filename: 'a.js', lineno: 5, error: Object.assign(new Error('boom'), { stack: 'at a.js:5' }) });
	fire('unhandledrejection', { reason: Object.assign(new Error('nope'), { stack: 'at b.js:2' }) });
	console.error('bad', { x: 1 });
	fire('click', { target: { tagName: 'BUTTON', textContent: 'Save', getAttribute: () => null } }, 'document');
	status.set('open');
	await drain();

	const kinds = seen.map((e) => e.kind);
	assert.ok(kinds.includes('error') && kinds.includes('rejection') && kinds.includes('console') && kinds.includes('input') && kinds.includes('status'));
	assert.equal(seen.find((e) => e.kind === 'error')?.message, 'boom');
	assert.equal(seen.find((e) => e.kind === 'console')?.level, 'error');
	assert.equal(console.errors.length, 1, 'the real console still ran');
	log.stop();
});

test('a keydown records a non-character key, never a character, and never a password field\'s key', () => {
	const { win, fire } = fakeWindow();
	const { client } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	log.each((e) => seen.push(e));
	const field = { tagName: 'INPUT', type: 'text', getAttribute: (n: string) => (n === 'aria-label' ? 'Email' : null) };
	const secret = { tagName: 'INPUT', type: 'password', getAttribute: () => null };
	fire('keydown', { target: field, key: 'Enter' }, 'document');
	fire('keydown', { target: field, key: 'a' }, 'document');
	fire('keydown', { target: secret, key: 'Enter' }, 'document');
	// An emoji is two UTF-16 units but one code point: a typed character, never recorded.
	fire('keydown', { target: field, key: '\uD83D\uDE00' }, 'document');
	// A base letter with its combining marks, as a layout can hand a typed character: never recorded.
	fire('keydown', { target: field, key: 'e\u0323\u0302' }, 'document');
	fire('keydown', { target: field, key: 'ArrowLeft' }, 'document');
	const keys = seen.filter((e) => e.kind === 'input').map((e) => e.key);
	assert.deepEqual(keys, ['Enter', undefined, undefined, undefined, undefined, 'ArrowLeft']);
	assert.equal(seen[0]!.label, 'Email');
	assert.equal(seen[2]!.field, 'password');
	log.stop();
});

test('a commit is recorded as its shape, and a private underscore slot is never in it', async () => {
	const { win } = fakeWindow();
	const { client, shared } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	log.each((e) => seen.push(e));
	const board = log.client.share<Record<string, unknown>>('board', createObject({ title: 'a', _secret: 'x', nested: createObject({ note: 'n', _token: 't' }) }));
	await board.ready;
	await drain();
	const doc = shared.get('board') as Record<string, unknown>;
	const nested = doc.nested as Record<string, unknown>;
	doc.title = 'b';       // a root slot
	doc._secret = 'y';     // a private root slot
	nested.note = 'm';     // a slot one deeper, which only a run reaches
	nested._token = 'u';   // a private slot one deeper
	await drain();
	const paths = seen.filter((e) => e.kind === 'commit').flatMap((e) => String(e.paths).split(', '));
	assert.ok(paths.includes('title'), 'a root slot is recorded');
	assert.ok(paths.includes('nested.note'), 'a slot at depth is recorded (the run reaches every depth)');
	assert.ok(!paths.some((path) => path.includes('_secret') || path.includes('_token')), 'no private slot at any depth is a path');
	assert.ok(!String(seen.map((e) => JSON.stringify(e)).join()).includes('_secret'));
	assert.ok(!String(seen.map((e) => JSON.stringify(e)).join()).includes('_token'));
	log.stop();
});

test('a batch goes over fetch, never over the socket, and carries the browser facts once', async () => {
	const { win } = fakeWindow();
	const { client, status } = fakeClient();
	const posted: Batch[] = [];
	const log = createLog(client, {
		window: win, build: 'abc', flushMs: 5,
		fetch: async (url, init) => { assert.equal(url, 'http://app.test/api/logs'); posted.push(JSON.parse(init.body) as Batch); return new Response(); },
	});
	status.set('open');   // a status entry to send
	await log.flush();
	assert.equal(posted.length, 1);
	assert.equal(posted[0]!.visit, log.visit);
	assert.equal(posted[0]!.build, 'abc');
	assert.deepEqual(posted[0]!.browser?.ua, 'Test/1.0');
	assert.equal(posted[0]!.browser?.scheme, 'dark');
	// A second batch does not repeat the facts.
	log.write({ kind: 'note' });
	await log.flush();
	assert.equal(posted[1]!.build, undefined);
	assert.equal(posted[1]!.browser, undefined);
	log.stop();
});

test('pagehide sends the last batch by beacon, marked ended', () => {
	const { win, fire, beacons } = fakeWindow();
	const { client } = fakeClient();
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	log.write({ kind: 'note' });
	fire('pagehide', {});
	assert.equal(beacons.length, 1);
	const batch = JSON.parse(beacons[0]!.body) as Batch;
	assert.equal(batch.ended, true);
	assert.equal(batch.visit, log.visit);
	log.stop();
});

test('each socket that opens is told the visit, through the plain client so it is not itself an entry', async () => {
	const { win } = fakeWindow();
	const { client, status, asks } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	log.each((e) => seen.push(e));
	status.set('open');
	await drain();
	status.set('connecting');
	status.set('open');
	await drain();
	const told = asks.filter((a) => a.name === 'logs/Visits');
	assert.equal(told.length, 2, 'once per open');
	assert.deepEqual(told[0]!.args, { visit: log.visit });
	assert.equal(seen.filter((e) => e.kind === 'ask').length, 0, 'the telling is not recorded as an ask');
	log.stop();
});

test('a fetch that throws is swallowed, and the recorder never throws into the page', async () => {
	const { win, fire } = fakeWindow();
	const { client } = fakeClient();
	const log = createLog(client, { window: win, fetch: async () => { throw new Error('offline'); } });
	log.write({ kind: 'note' });
	await assert.doesNotReject(log.flush());
	// A source firing after a throwing fetch still does not throw.
	assert.doesNotThrow(() => fire('error', { message: 'x' }));
	log.stop();
});

test('a recorded ask keeps its outcome, and the page still gets the answer or the throw', async () => {
	const { win } = fakeWindow();
	const { client } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	log.each((e) => seen.push(e));
	assert.equal(await log.client.ask('app/Ok'), 'ok');
	await assert.rejects(log.client.ask('app/Fail'));
	const asks = seen.filter((e) => e.kind === 'ask');
	assert.deepEqual(asks.map((e) => [e.name, e.ok]), [['app/Ok', true], ['app/Fail', false]]);
	assert.equal(asks[1]!.reason, 'refused');
	log.stop();
});

test('a router\'s url is recorded, and a window with no navigator records no browser facts', async () => {
	const { win } = fakeWindow();
	const bare: WindowLike = { addEventListener: win.addEventListener, removeEventListener: win.removeEventListener, location: { origin: 'http://app.test' } };
	const { client } = fakeClient();
	const url = mutable('/one');
	const posted: Batch[] = [];
	const log = createLog(client, { window: bare, router: { url }, fetch: async (_u, init) => { posted.push(JSON.parse(init.body) as Batch); return new Response(); } });
	// effect records the current URL at subscribe, then each change.
	url.set('/two');
	await log.flush();
	const urls = posted.flatMap((b) => b.entries.filter((e) => e.kind === 'url').map((e) => e.url));
	assert.deepEqual(urls, ['/one', '/two']);
	assert.equal(posted[0]!.browser, undefined, 'no navigator, no facts');
	log.stop();
});

test('with no sendBeacon, pagehide falls back to fetch', async () => {
	const { win, fire } = fakeWindow();
	const noBeacon: WindowLike = { ...win, navigator: { userAgent: 'X' } };
	const { client } = fakeClient();
	const posted: string[] = [];
	const log = createLog(client, { window: noBeacon, fetch: async (u) => { posted.push(u); return new Response(); } });
	log.write({ kind: 'note' });
	fire('pagehide', {});
	await drain();
	assert.deepEqual(posted, ['http://app.test/api/logs']);
	log.stop();
});

test('with no console, a page error is still recorded and stop is safe', async () => {
	const { win, fire } = fakeWindow();
	const noConsole: WindowLike = { ...win, console: undefined };
	const { client } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: noConsole, fetch: async () => new Response() });
	log.each((e) => seen.push(e));
	fire('error', { message: 'still caught' });
	assert.equal(seen.find((e) => e.kind === 'error')?.message, 'still caught');
	assert.doesNotThrow(() => log.stop());
});

test('a share can be stopped, and the recorder stops watching its commits', async () => {
	const { win } = fakeWindow();
	const { client, shared } = fakeClient();
	const seen: Entry[] = [];
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	log.each((e) => seen.push(e));
	const handle = log.client.share<Record<string, unknown>>('board', createObject({ title: 'a' }));
	await handle.ready;
	await drain();
	handle.stop();
	(shared.get('board') as Record<string, unknown>).title = 'b';
	await drain();
	assert.equal(seen.filter((e) => e.kind === 'commit').length, 0, 'no commit after stop');
	log.stop();
});


test('a console argument whose toString throws does not throw into the page', () => {
	const { win } = fakeWindow();
	const { client } = fakeClient();
	const log = createLog(client, { window: win, fetch: async () => new Response() });
	const seen: Entry[] = [];
	log.each((e) => seen.push(e));
	const nasty = { toString() { throw new Error('nope'); } };
	assert.doesNotThrow(() => win.console!.error('before', nasty));
	assert.equal(seen.find((e) => e.kind === 'console')?.level, 'error', 'the console entry was still recorded');
	log.stop();
});
