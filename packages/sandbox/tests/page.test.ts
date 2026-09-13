// The room on the page (designs 280 to 283), both halves in one process: a host `Room` under a
// stage in a light document, a fake frame that hands the posted port to `room()` over a second
// light document, and Node's own `MessageChannel` between them. Then the far end held by the
// test, so the host's side of the route is driven by writing the document the way a room does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { atomic, createObject, observer } from '@aweftjs/core';
import { type LightDocument, type LightElement, createDocument, toHtml } from '@aweftjs/dom';
import { type Entries, type Router, createRouter } from '@aweftjs/dom/router';
import { type ClientLike, type Report, createSandbox, iframe } from '@aweftjs/sandbox';
import { type Entered, enter } from '@aweftjs/sandbox/inside';
import { Room } from '@aweftjs/sandbox/page';
import { room } from '@aweftjs/sandbox/room';
import { fromMessagePort } from '@aweftjs/sync';
import { Stage, StageContext, h, mount } from '@aweftjs/ui';
import type { StageValue } from '@aweftjs/ui';

import { hooks } from './fixtures/room-ui.ts';
import { countingClient, document, grantsOf, reasonOf, until } from './helpers.ts';

const bundle = fileURLToPath(new URL('./fixtures/room-ui.ts', import.meta.url));

/** The page's markup without the live region and the mount markers. */
const textOf = (doc: LightDocument): string =>
	toHtml(doc.body.childNodes).replace(/<div aria-live[^>]*><\/div>/, '').replace(/<!--.?-->/g, '');

interface Frame extends LightElement {
	focused: number;
}

interface Port { close(): void }

/**
 * A light document whose iframes behave enough like a browser's for the runner: `load` fires
 * once `srcdoc` is set, and the port the host posts goes to `onPort`. Every port posted is
 * kept in `ports`, so a test can close the far end whatever else it left behind: an open
 * MessagePort holds the process, and a test that failed before its own stop would otherwise
 * end at the runner's cap rather than at its assertion.
 */
const pageWith = (onPort: (port: unknown) => void): { doc: LightDocument; frames: Frame[]; ports: Port[] } => {
	const doc = createDocument();
	const frames: Frame[] = [];
	const ports: Port[] = [];
	const original = doc.createElement.bind(doc);
	doc.createElement = (tag: string): LightElement => {
		const made = original(tag) as Frame;
		if (tag !== 'iframe') return made;
		frames.push(made);
		made.focused = 0;
		const own = made as unknown as Record<string, unknown>;
		const setAttribute = made.setAttribute.bind(made);
		own['setAttribute'] = (name: string, value: string): void => {
			setAttribute(name, value);
			if (name === 'srcdoc') queueMicrotask(() => { made.dispatchEvent({ type: 'load' }); });
		};
		own['focus'] = (): void => { made.focused += 1; };
		own['contentWindow'] = { postMessage: (_message: unknown, _origin: string, transfer: unknown[]) => { ports.push(transfer[0] as Port); onPort(transfer[0]); } };
		return made;
	};
	return { doc, frames, ports };
};

/** Close every port posted and stop the room when the test ends, however it ended. */
const leaving = (t: { after(fn: () => Promise<void> | void): void }, ports: Port[], ...stops: (() => Promise<unknown> | unknown)[]): void => {
	t.after(async () => {
		for (const stop of stops) await Promise.resolve(stop()).catch(() => undefined);
		for (const port of ports) port.close();
	});
};

/** The act module: two screens on a nested stage, the shared state, and hooks for the test. */
const ACT = `
	export const deps = ['test/Ui', 'app/Helper'];
	export default ({ imports, client, site }) => {
		const { h, Stage, StageContext, hooks } = imports.Ui;
		hooks.client = client;
		hooks.site = site;
		const First = (props) => { hooks.first = props.stage; return h('main', { id: 'first' }, imports.Helper.label('first')); };
		const Second = (props) => { hooks.second = props.stage; return h('main', { id: 'second' }, 'second'); };
		return {
			title: 'the act',
			component: (props) => {
				hooks.stage = props.stage;
				hooks.builds = (hooks.builds ?? 0) + 1;
				return h(StageContext, { acts: { '': First, second: Second } }, h(Stage, {}));
			},
			stop: () => { hooks.stopped = (hooks.stopped ?? 0) + 1; },
		};
	};`;

const HELPER = `export default () => ({ label: (text) => text });`;

test('the whole loop: a Room under a stage runs an act in a room, with documents, asks, the route, reports and the stop', async (t) => {
	for (const key of Object.keys(hooks)) delete hooks[key];
	const inside = createDocument();
	let handle: Promise<{ stop(): Promise<void> }> | null = null;
	const { doc: page, frames, ports } = pageWith((port) => {
		handle = room(port as never, { document: inside });
		handle.catch(() => {});
	});
	leaving(t, ports, async () => { await (await handle)?.stop(); });

	// Node's globalThis is no event target, so the frame's error listeners are exercised through a
	// stand-in installed for the length of the test; the console wrapper wraps a quiet one.
	const listeners = new Map<string, (event: unknown) => void>();
	const realm = globalThis as { addEventListener?: unknown; removeEventListener?: unknown };
	realm.addEventListener = (type: string, fn: (event: unknown) => void) => { listeners.set(type, fn); };
	realm.removeEventListener = (type: string) => { listeners.delete(type); };
	const heldError = console.error;
	console.error = () => {};
	t.after(() => {
		delete realm.addEventListener;
		delete realm.removeEventListener;
		console.error = heldError;
	});

	const modules = document({ 'app/Main': ACT, 'app/Helper': HELPER, 'app/Lone': `export default () => ({});` });
	const grants = grantsOf(['notes/Export']);
	const state = createObject<Record<string, unknown>>({ count: 0 });
	const asked: [string, unknown][] = [];
	const client = countingClient((name, args) => { asked.push([name, args]); return { echo: args }; }, 'open');
	const errors: Report[] = [];
	const lines: [string, string][] = [];
	const applied: string[] = [];

	const AppAct = (): unknown => h(Room, {
		inside: 'http://rooms.test/room.js', modules, grants, documents: { state }, client, act: 'app/Main',
		bundle, props: { site: 'reports' }, follow: true, focus: true, id: 'box',
		handlers: {
			error: (entry: Report) => { errors.push(entry); },
			console: (level: string, text: string) => { lines.push([level, text]); },
			applied: (name: string) => { applied.push(name); },
		},
	});
	const Other = (): unknown => h('main', { id: 'other' }, 'other');

	// A deep link: the page opens on the act's second screen.
	const router = createRouter({ url: '/app/3/second' });
	const stopPage = mount(page.body as never, h(StageContext, { router, acts: { 'app/:id': AppAct, other: Other } } as never, h(Stage, {})));
	t.after(() => { stopPage(); });
	await until('the act on its second screen', () => textOf(inside).includes('id="second"'));
	assert.equal(client.live, 1, 'the room follows the client\'s status with one effect');
	assert.equal(frames.length, 1, 'one frame per act instance');
	assert.equal((frames[0]!.parentNode as LightElement).getAttribute('id'), 'box', 'the frame is inside the room\'s element, which took the rest of the props');
	assert.match(frames[0]!.getAttribute('srcdoc') ?? '', /style-src 'unsafe-inline'/, 'a page in the room may paint');
	assert.match(frames[0]!.getAttribute('srcdoc') ?? '', /script-src 'unsafe-inline' data: http:\/\/rooms\.test/);
	assert.equal(frames[0]!.focused, 1, 'focus went to the frame once the room was up');
	assert.equal(hooks['site'], 'reports', 'the host\'s props reached the factory beside client');

	// A document named on the host is the same document in the room, both ways.
	const roomClient = hooks['client'] as ClientLike & { share<T extends object>(name: string): { ready: Promise<T> }; reconnect(): void; close(): void };
	const copy = await roomClient.share<typeof state>('state').ready;
	assert.equal(copy.count, 0);
	copy.count = 1;
	await until('the room write on the host', () => state.count === 1);
	state.count = 2;
	await until('the host write in the room', () => copy.count === 2);
	assert.throws(() => roomClient.share('secrets'), (e: Error) => reasonOf(e) === 'not-shared');

	// An ask goes through the page's client for a granted name and is refused for the rest.
	assert.deepEqual(await roomClient.ask('notes/Export', { month: '2026-09' }), { echo: { month: '2026-09' } });
	assert.deepEqual(asked, [['notes/Export', { month: '2026-09' }]]);
	await assert.rejects(roomClient.ask('notes/Secret'), (e) => reasonOf(e) === 'refused');
	assert.equal(roomClient.status.get(), 'open', 'the page client\'s status, mirrored');
	assert.throws(() => roomClient.reconnect(), (e: Error) => reasonOf(e) === 'not-in-room');
	assert.throws(() => roomClient.close(), (e: Error) => reasonOf(e) === 'not-in-room');

	// The page moves under the act and the room follows: the tail is the room's URL.
	router.push('/app/3');
	await until('the first screen', () => textOf(inside).includes('id="first"'));
	const first = hooks['first'] as StageValue;
	const before = String(router.key.get());

	// A push inside reaches the tree's router with the act's prefix: an open with history pushes
	// the URL the room is on, and closing it is a back the host honours because it pushed the entry.
	first.open({ name: 'second', history: true });
	await until('the page took the entry', () => String(router.key.get()) !== before);
	assert.equal(router.url.get(), '/app/3', 'the same URL, one entry down');
	await until('the second screen, opened', () => textOf(inside).includes('id="second"'));
	first.close();
	await until('back on the page', () => String(router.key.get()) === before);
	await until('the first screen again', () => textOf(inside).includes('id="first"'));

	// The act is keyed on the bare `*`, so a move inside the room is its nested stage's and the
	// act's component is built once: its state survives every screen change.
	router.push('/app/3/second');
	await until('the second screen, by the page', () => textOf(inside).includes('id="second"'));
	router.push('/app/3');
	await until('the first screen, by the page', () => textOf(inside).includes('id="first"'));
	assert.equal(hooks['builds'], 1, 'the act was built once across the inner moves');

	// What leaves the room as data, attributed to the act.
	assert.deepEqual([...listeners.keys()].sort(), ['error', 'unhandledrejection'], 'the frame forwards errors');
	listeners.get('error')!({ error: new TypeError('inside blew up'), message: 'Uncaught TypeError' });
	await until('the error on the host', () => errors.length === 1);
	assert.deepEqual([errors[0]!.kind, errors[0]!.message, errors[0]!.module], ['error', 'TypeError: inside blew up', 'app/Main']);
	console.error('from the act', 7);
	await until('the console line on the host', () => lines.length === 1);
	assert.deepEqual(lines, [['error', 'from the act 7']]);

	// An edit to a module the act depends on rebuilds the act on screen, from the new source.
	(modules['app/Helper'] as { source: string }).source = `export default () => ({ label: (text) => text + ' v2' });`;
	await until('the reload applied', () => applied.includes('app/Helper'));
	await until('the act rebuilt', () => textOf(inside).includes('first v2'));
	assert.equal(hooks['stopped'], 2, 'the act instance stopped for the reload and for the remount');
	(modules['app/Lone'] as { source: string }).source = `export default () => ({ changed: true });`;
	await new Promise((done) => setTimeout(done, 30));
	assert.ok(!applied.includes('app/Lone'), 'a module nothing loaded is not reloaded, so the act stays');
	// An entry leaving the document unloads the act, and nothing is rebuilt from nothing.
	const rebuilt = hooks['stopped'];
	delete modules['app/Helper'];
	await until('the unload applied', () => applied.filter((name) => name === 'app/Helper').length === 2);
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(hooks['stopped'], (rebuilt as number) + 1, 'the act was unloaded once and not loaded again');
	assert.ok(textOf(inside).includes('first v2'), 'what was on screen stays');
	modules['app/Helper'] = createObject({ source: HELPER });

	// Leaving the act stops the room: the frame is gone, the link is closed, and the sandbox's own
	// stop let go of the client's status cell.
	router.push('/other');
	await until('the other act', () => textOf(page).includes('id="other"'));
	assert.equal(frames[0]!.parentNode, null, 'the frame was removed');
	await until('the status effect released', () => client.live === 0);
	state.count = 3;
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(copy.count, 2, 'nothing crosses any more');
	stopPage();
	await (await handle!).stop();
	assert.equal(hooks['stopped'], 3, 'stopping the room unloads nothing more: the act was already gone');
});

test('a Room with no stage above runs the act on / and a room move changes nothing on the page', async (t) => {
	for (const key of Object.keys(hooks)) delete hooks[key];
	const inside = createDocument();
	let handle: Promise<{ stop(): Promise<void> }> | null = null;
	const Layout = (props: { children?: unknown[] }): unknown => h('section', { id: 'layout' }, ...(props.children ?? []));
	const { doc: page, ports } = pageWith((port) => { handle = room(port as never, { document: inside, template: Layout }); });
	const modules = document({ 'app/Main': ACT, 'app/Helper': HELPER });
	const stop = mount(page.body as never, h(Room, { inside: 'http://rooms.test/room.js', modules, grants: grantsOf(), act: 'app/Main', bundle }));
	leaving(t, ports, stop, async () => { await (await handle)?.stop(); });
	await until('the act', () => textOf(inside).includes('id="first"'));
	assert.match(textOf(inside), /<section id="layout">.*id="first"/, 'the template wraps the act');
	const first = hooks['first'] as StageValue;
	first.open({ name: 'second', history: true });
	await until('the second screen', () => textOf(inside).includes('id="second"'));
	first.close();
	await new Promise((done) => setTimeout(done, 30));
	assert.ok(textOf(inside).includes('id="second"'), 'with no page history the room\'s back goes nowhere');
	stop();
	await (await handle!).stop();
});

test('a sandbox the host refuses is raised as the page\'s own, and inside is resolved against the page', () => {
	const repo = fileURLToPath(new URL('../../../', import.meta.url));
	const program = fileURLToPath(new URL('./page-escapes.ts', import.meta.url));
	const run = spawnSync(process.execPath, ['--conditions=aweft-source', '--import', '@aweftjs/build/loader', program], { cwd: repo, encoding: 'utf8' });
	assert.equal(run.status, 0, run.stderr);
	const out = JSON.parse(run.stdout.trim().split('\n').at(-1)!) as { raised: string[]; policy: string; frames: number };
	assert.deepEqual(out.raised, ['reserved'], 'the refusal reached the page as an uncaught error, once, and the stop after it raised nothing');
	assert.equal(out.frames, 1, 'no frame for the refused room, one for the sound one');
	assert.match(out.policy, /script-src 'unsafe-inline' data: http:\/\/page\.test(;|$)/, 'the inside origin is the page\'s');
});

test('room refuses a compute room, which has no act to show', async (t) => {
	let port: unknown;
	const { doc, ports } = pageWith((posted) => { port = posted; });
	const runner = iframe({ inside: 'http://rooms.test/room.js', into: doc.body as never, document: doc as never });
	const sandbox = await createSandbox({ runner, modules: document({}), grants: grantsOf() });
	leaving(t, ports, () => sandbox.stop());
	await assert.rejects(room(port as never, { document: createDocument() }), (e) => reasonOf(e) === 'no-act');
	await sandbox.stop();
});

test('the iframe runner\'s stop ends a start still waiting on the frame', async () => {
	const doc = createDocument();
	const runner = iframe({ inside: 'http://rooms.test/room.js', into: doc.body as never, document: doc as never });
	const started = runner.start();
	started.catch(() => {});
	await runner.stop();
	await assert.rejects(started, (e) => reasonOf(e) === 'closed');
});

// --- the host's side of the route, with the far end held here (design 282) ------------------

/**
 * A page with a Room under `app/:id`, and the far end entered by the test. The page is unmounted
 * and the far end's port closed when the test ends, so a failed assertion ends the file.
 */
const hostRoute = async (t: { after(fn: () => Promise<void> | void): void }, url: string, router: Router = createRouter({ url })): Promise<{ page: LightDocument; router: Router; entered: Entered; stop: () => void }> => {
	let port: unknown;
	const { doc: page, ports } = pageWith((posted) => { port = posted; });
	const modules = document({});
	const AppAct = (): unknown => h(Room, { inside: 'http://rooms.test/room.js', modules, grants: grantsOf(), act: 'app/Main' });
	const Other = (): unknown => h('main', { id: 'other' }, 'other');
	const stop = mount(page.body as never, h(StageContext, { router, acts: { 'app/:id': AppAct, other: Other } } as never, h(Stage, {})));
	leaving(t, ports, stop);
	await until('the port', () => port !== undefined);
	const entered = await enter(fromMessagePort(port as never));
	return { page, router, entered, stop };
};

test('the host writes the tail with the page\'s query and key, and applies a room push, replace and back at its prefix', async (t) => {
	const { router, entered, stop } = await hostRoute(t, '/app/3/notes/7?tab=all#top');
	const route = entered.route!;
	assert.equal(route.url, '/notes/7?tab=all#top', 'the tail, with the query and hash the page has');
	assert.equal(route.key, String(router.key.get()));

	// The page moves under the act: one commit, after the router settled, never the old path
	// under the new key.
	const seen: [string, string][] = [];
	const stopSeen = observer(route).watch(() => { seen.push([route.url, route.key]); });
	router.push('/app/3/settings');
	await until('the move in the room', () => route.url === '/settings');
	assert.deepEqual(seen, [['/settings', String(router.key.get())]]);

	// A room push lands at the act's prefix, and the key comes back.
	const pushes = seen.length;
	atomic(() => { route.url = '/second'; route.move = 'push'; route.seq = 1; });
	await until('the page moved', () => router.url.get() === '/app/3/second');
	await until('the key came back', () => seen.length > pushes);
	assert.deepEqual(seen.at(-1), ['/second', String(router.key.get())], 'the key only: the URL was the room\'s own');
	const pushedKey = String(router.key.get());

	// A replace keeps the entry; a push of the index lands on the prefix itself, with a query.
	atomic(() => { route.url = '/second?x=1'; route.move = 'replace'; route.seq = 2; });
	await until('the replace', () => router.url.get() === '/app/3/second?x=1');
	assert.equal(String(router.key.get()), pushedKey, 'a replace keeps the entry');
	atomic(() => { route.url = '/?y=2'; route.move = 'push'; route.seq = 3; });
	await until('the index push', () => router.url.get() === '/app/3?y=2');

	// Back is honoured on an entry the host pushed for the room, twice here, and then refused:
	// the entry showing is the page's own.
	atomic(() => { route.move = 'back'; route.seq = 4; });
	await until('back once', () => router.url.get() === '/app/3/second?x=1');
	atomic(() => { route.move = 'back'; route.seq = 5; });
	await until('back twice', () => router.url.get() === '/app/3/settings');
	atomic(() => { route.move = 'back'; route.seq = 6; });
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(router.url.get(), '/app/3/settings', 'the room cannot walk the page back past where it was mounted');

	// A url that could leave the tail is refused on the link and moves nothing.
	for (const bad of ['//evil.test/x', 'https://evil.test/x', '/../x', '/a/%2e%2e/x', 'second']) {
		atomic(() => { route.url = bad; route.move = 'push'; route.seq += 1; });
		await new Promise((done) => setTimeout(done, 20));
		assert.equal(router.url.get(), '/app/3/settings', `${bad} moved nothing`);
	}
	stopSeen();
	stop();
});

test('the host\'s back is a no-op until the room pushed, and leaving the act stops following the router', async (t) => {
	const { router, entered, stop } = await hostRoute(t, '/app/3');
	const route = entered.route!;
	assert.equal(route.url, '/');
	router.push('/app/3/x');
	await until('the tail', () => route.url === '/x');
	atomic(() => { route.move = 'back'; route.seq = 1; });
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(router.url.get(), '/app/3/x', 'the entry showing is the page\'s own, so back changed nothing');

	router.push('/other');
	await new Promise((done) => setTimeout(done, 30));
	router.push('/app/9/deep');
	await new Promise((done) => setTimeout(done, 30));
	assert.equal(route.url, '/x', 'the room that left hears nothing of a later act');
	stop();
});

/**
 * Entries like a browser's: a push lands now, and a back reports through `listen` from a later
 * task, the way `popstate` arrives after `history.back()`.
 */
const browserLikeEntries = (start: string): Entries & { readonly backs: number } => {
	const stack: { href: string; state: unknown }[] = [{ href: start, state: null }];
	let at = 0;
	let backs = 0;
	const listeners = new Set<() => void>();
	return {
		get backs() { return backs; },
		current: () => stack[at]!.href,
		state: () => stack[at]!.state,
		push: (state, href) => { stack.length = at + 1; stack.push({ href, state }); at += 1; },
		replace: (state, href) => { stack[at] = { href, state }; },
		back: () => {
			backs += 1;
			setTimeout(() => {
				if (at > 0) at -= 1;
				for (const fn of [...listeners]) fn();
			}, 0);
		},
		listen: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
	};
};

test('two room backs in one tick pop one entry: a back in flight holds the rest until the page\'s key has moved (design 282)', async (t) => {
	const entries = browserLikeEntries('/home');
	const router = createRouter({ entries });
	router.push('/app/3');
	const { entered } = await hostRoute(t, '/app/3', router);
	const route = entered.route!;
	atomic(() => { route.url = '/second'; route.move = 'push'; route.seq = 1; });
	await until('the room push on the page', () => router.url.get() === '/app/3/second');
	const pushedKey = String(router.key.get());

	// Two backs in one tick, as a close called twice writes them. The page's key has not moved
	// when the second arrives, because the browser's popstate is a later task.
	atomic(() => { route.move = 'back'; route.seq = 2; });
	atomic(() => { route.move = 'back'; route.seq = 3; });
	await until('a back landed', () => String(router.key.get()) !== pushedKey);
	await new Promise((done) => setTimeout(done, 50));
	assert.equal(entries.backs, 1, 'exactly one back reached the history');
	assert.equal(router.url.get(), '/app/3', 'the page is on the act, not off it');

	// With the key moved, a room back is judged again: the entry showing is the page's own.
	atomic(() => { route.move = 'back'; route.seq = 4; });
	await new Promise((done) => setTimeout(done, 50));
	assert.equal(entries.backs, 1, 'and the page\'s own entry is not popped');
	assert.equal(router.url.get(), '/app/3');
});
