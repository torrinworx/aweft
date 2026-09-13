// The frame runner's own half of the escape suite, plus the window suite, run in a real browser. No
// fake DOM enforces an iframe's isolation, so a fake one would prove nothing (design 070).
// Playwright's Chromium is a dev dependency and `npm test` installs it before this runs.
//
// The suites live in the browser: this file builds the emitted JS, serves it, drives one page
// that imports @aweftjs/sandbox and @aweftjs/testing, and asserts what the page reports. The
// same roomChecks that run in process and in a child run here against the iframe runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { chromium } from 'playwright';

// These run inside the browser page, where tsc has no DOM lib. Declared loosely so the file
// typechecks in Node; the browser supplies the real ones.
declare const document: { title: string; body: { appendChild(node: unknown): unknown } };
declare const location: { href: string; origin: string };
declare const parent: { document: { title: string } };
declare const top: { location: { href: string } };
declare const localStorage: { setItem(k: string, v: string): void };
declare function open(url: string): unknown;
declare function fetch(url: string): Promise<unknown>;

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pkgs = ['codec', 'core', 'sync', 'modules', 'sandbox', 'testing'];

// The browser cannot run TypeScript or resolve a workspace import, so emit plain JS with the
// bare specifiers rewritten to served paths. One build for the whole suite.
const build = (): string => {
	const out = mkdtempSync(join(tmpdir(), 'aweft-iframe-'));
	const sources: string[] = [];
	for (const p of pkgs) {
		const dir = join(repo, 'packages', p, 'src');
		for (const name of readdirSyncSafe(dir)) if (name.endsWith('.ts')) sources.push(join(dir, name));
	}
	const run = spawnSync('npx', ['tsc', ...sources,
		'--rootDir', repo, '--outDir', out, '--target', 'es2023', '--module', 'nodenext',
		'--moduleResolution', 'nodenext', '--allowImportingTsExtensions', '--rewriteRelativeImportExtensions',
		'--strict', '--skipLibCheck', '--erasableSyntaxOnly', '--verbatimModuleSyntax', '--isolatedModules',
		'--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes'],
		{ cwd: repo, encoding: 'utf8' });
	if (run.status !== 0) throw new Error(`emit failed: ${run.stdout}\n${run.stderr}`);
	return out;
};

import { readdirSync as readdirSyncSafe } from 'node:fs';

const specifierMap = (base: string): Record<string, string> => ({
	'@aweftjs/codec': `${base}/packages/codec/src/index.js`,
	'@aweftjs/core': `${base}/packages/core/src/index.js`,
	'@aweftjs/sync': `${base}/packages/sync/src/index.js`,
	'@aweftjs/modules': `${base}/packages/modules/src/index.js`,
	'@aweftjs/sandbox': `${base}/packages/sandbox/src/index.js`,
	'@aweftjs/sandbox/inside': `${base}/packages/sandbox/src/inside.js`,
	// Only roomChecks is needed in the browser, and the testing index pulls in node: modules
	// through its other exports. Point the specifier at the one browser-safe module.
	'@aweftjs/testing': `${base}/packages/testing/src/rooms.js`,
});

test('the iframe runner: the window suite and the frame\'s own denials, under a real browser', async (t) => {
	const emit = build();
	t.after(() => rmSync(emit, { recursive: true, force: true }));

	const host = 'http://aweft.test';
	const map = specifierMap(host);
	const page_html = `<!doctype html><html><head><script type="importmap">${JSON.stringify({ imports: map }).replaceAll('<', '\\u003c')}</script></head><body></body></html>`;

	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route(`${host}/**`, (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/' || url.pathname === '/index.html') return route.fulfill({ body: page_html, contentType: 'text/html' });
		const file = join(emit, url.pathname);
		if (!existsSync(file)) return route.fulfill({ status: 404, body: `no ${url.pathname}` });
		return route.fulfill({ body: readFileSync(file, 'utf8'), contentType: 'text/javascript' });
	});
	await page.goto(`${host}/`);

	// The window suite: run every roomChecks case against the iframe runner, in the page.
	const windowResults = await page.evaluate(async ({ insideUrl, frameMap }) => {
		const { roomChecks } = await import('@aweftjs/testing');
		const { iframe } = await import('@aweftjs/sandbox');
		const make = () => iframe({ inside: insideUrl, into: document.body, importMap: frameMap });
		const out: { name: string; ok: boolean; error?: string }[] = [];
		for (const c of roomChecks()) {
			try { await c.run(make); out.push({ name: c.name, ok: true }); }
			catch (e) { out.push({ name: c.name, ok: false, error: String((e as Error).message) }); }
		}
		return out;
	}, { insideUrl: map['@aweftjs/sandbox/inside']!, frameMap: map });

	for (const r of windowResults) assert.ok(r.ok, `window check in the iframe: ${r.name}${r.error === undefined ? '' : ` -> ${r.error}`}`);
	assert.ok(windowResults.length >= 10, `all window checks ran: ${windowResults.length}`);

	// The frame's own denials: a hostile module reaches nothing of the page or the network.
	const denied = await page.evaluate(async ({ insideUrl, frameMap }) => {
		const { createArray, createObject } = await import('@aweftjs/core');
		const { createSandbox, iframe } = await import('@aweftjs/sandbox');
		const modules = createObject({
			'evil/Probe': createObject({ source: `export default () => ({ probe: async () => {
				const out = {};
				const attempt = async (name, fn) => { try { await fn(); out[name] = 'ALLOWED'; } catch (e) { out[name] = e.name; } };
				await attempt('parent', () => String(parent.document.title));
				await attempt('top', () => String(top.location.href));
				await attempt('storage', () => localStorage.setItem('x', '1'));
				await attempt('cookie', () => { const c = document.cookie; if (c === undefined) throw new Error(); return c; });
				await attempt('fetch', () => fetch('http://aweft.test/packages/core/src/index.js'));
				await attempt('fetchOut', () => fetch('https://example.com/'));
				await attempt('eval', () => new Function('return 1')());
				await attempt('popup', () => { const w = open('about:blank'); if (!w) throw new Error('blocked'); });
				await attempt('navigate', () => { top.location = 'about:blank#x'; });
				out.origin = location.origin;
				return out;
			} });` }),
		});
		const runner = iframe({ inside: insideUrl, into: document.body, importMap: frameMap });
		const sandbox = await createSandbox({ runner, modules, grants: createArray([]), limits: { callMs: 10000 } });
		try {
			const { 'evil/Probe': probe } = await sandbox.load(['evil/Probe']);
			return { probes: await probe!.probe!(), hostTitle: document.title, hostHref: location.href };
		} finally {
			await sandbox.stop();
		}
	}, { insideUrl: map['@aweftjs/sandbox/inside']!, frameMap: map });

	const p = denied.probes as Record<string, string>;
	assert.equal(p.parent, 'SecurityError', 'the parent document is unreachable');
	assert.equal(p.top, 'SecurityError', 'the top location is unreachable');
	assert.equal(p.storage, 'SecurityError', 'storage is unreachable');
	assert.equal(p.cookie, 'SecurityError', 'cookies are unreachable');
	assert.equal(p.fetch, 'TypeError', 'the network is unreachable, even to its own origin');
	assert.equal(p.fetchOut, 'TypeError', 'the wider network is unreachable');
	assert.equal(p.eval, 'EvalError', 'eval is off');
	assert.equal(p.origin, 'null', 'the frame has an opaque origin');
	assert.ok(p.popup === 'Error' || p.popup === 'SecurityError', `popups are blocked: ${p.popup}`);
	assert.equal(denied.hostHref, `${host}/`, 'the host page did not navigate');
	assert.deepEqual(pageErrors, [], `no error escaped to the host page: ${pageErrors.join('; ')}`);
});

// --- the frame with a page in it (design 281) ------------------------------------------------
//
// Under `allow` the frame may paint: inline styles apply and images come from the origins
// named. Everything the compute room refused is still refused: the network, storage, history.
// Appended, as the suite grows.

declare const sessionStorage: { setItem(k: string, v: string): void };
declare const history: { pushState(state: unknown, title: string, url: string): void };
declare function getComputedStyle(element: unknown): { paddingLeft: string };
declare const Image: new () => { src: string; onload: (() => void) | null; onerror: (() => void) | null };
declare function setTimeout(fn: (...args: never[]) => void, ms: number): unknown;

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('the iframe runner under allow: styles and named images apply, and the network, storage and history are still refused', async (t) => {
	const emit = build();
	t.after(() => rmSync(emit, { recursive: true, force: true }));

	const host = 'http://aweft.test';
	const map = specifierMap(host);
	const page_html = `<!doctype html><html><head><script type="importmap">${JSON.stringify({ imports: map }).replaceAll('<', '\\u003c')}</script></head><body></body></html>`;

	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage();
	const pageErrors: string[] = [];
	page.on('pageerror', (e) => pageErrors.push(e.message));
	await page.route(`${host}/**`, (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/' || url.pathname === '/index.html') return route.fulfill({ body: page_html, contentType: 'text/html' });
		if (url.pathname === '/pixel.png') return route.fulfill({ body: PIXEL, contentType: 'image/png' });
		const file = join(emit, url.pathname);
		if (!existsSync(file)) return route.fulfill({ status: 404, body: `no ${url.pathname}` });
		return route.fulfill({ body: readFileSync(file, 'utf8'), contentType: 'text/javascript' });
	});
	await page.goto(`${host}/`);

	const probe = `export default () => ({ probe: async () => {
		const out = {};
		const attempt = async (name, fn) => { try { await fn(); out[name] = 'ALLOWED'; } catch (e) { out[name] = e.name; } };
		const style = document.createElement('style');
		style.textContent = 'p { padding-left: 7px }';
		document.head.appendChild(style);
		const p = document.createElement('p');
		document.body.appendChild(p);
		out.padding = getComputedStyle(p).paddingLeft;
		const image = (src) => new Promise((done) => { const img = new Image(); img.onload = () => done('loaded'); img.onerror = () => done('error'); img.src = src; });
		out.imageIn = await image('${host}/pixel.png');
		out.imageOut = await image('http://other.test/pixel.png');
		await attempt('fetch', () => fetch('${host}/pixel.png'));
		await attempt('fetchOut', () => fetch('https://example.com/'));
		await attempt('storage', () => sessionStorage.setItem('x', '1'));
		await attempt('pushState', () => history.pushState(null, '', '/x'));
		await attempt('pushHash', () => history.pushState(null, '', '#h'));
		console.warn('a warning from the room', { n: 1 });
		setTimeout(() => { throw new TypeError('thrown in the room'); }, 0);
		return out;
	} });`;

	const results = await page.evaluate(async ({ insideUrl, frameMap, source }) => {
		const { createArray, createObject } = await import('@aweftjs/core');
		const { createSandbox, iframe } = await import('@aweftjs/sandbox');
		const run = async (allow: unknown): Promise<Record<string, unknown>> => {
			const modules = createObject({ 'page/Probe': createObject({ source }) });
			const errors: unknown[] = [];
			const lines: unknown[] = [];
			const runner = iframe({ inside: insideUrl, into: document.body, importMap: frameMap, ...(allow === undefined ? {} : { allow }) } as never);
			const sandbox = await createSandbox({
				runner, modules, grants: createArray([]), limits: { callMs: 10000 },
				handlers: { error: (entry: unknown) => { errors.push(entry); }, console: (level: string, text: string, stack: string) => { lines.push([level, text, stack.length > 0]); } },
			});
			try {
				const { 'page/Probe': probeStub } = await sandbox.load(['page/Probe']);
				const probes = await probeStub!.probe!();
				await new Promise((done) => setTimeout(done, 200));
				return { probes, errors, lines };
			} finally {
				await sandbox.stop();
			}
		};
		return { bare: await run(undefined), opened: await run({ styles: true, images: [] }) };
	}, { insideUrl: map['@aweftjs/sandbox/inside']!, frameMap: map, source: probe });

	const bare = results.bare.probes as Record<string, string>;
	const opened = results.opened.probes as Record<string, string>;
	assert.equal(bare.padding, '0px', 'without allow the inline style is refused');
	assert.equal(opened.padding, '7px', 'with styles the inline style applies');
	assert.equal(bare.imageIn, 'error', 'without allow no image loads, even from the inside origin');
	assert.equal(opened.imageIn, 'loaded', 'with images the inside origin loads');
	assert.equal(opened.imageOut, 'error', 'an origin not in allow is refused');
	for (const [label, p] of [['bare', bare], ['opened', opened]] as const) {
		assert.equal(p.fetch, 'TypeError', `${label}: fetch to the inside origin is refused`);
		assert.equal(p.fetchOut, 'TypeError', `${label}: fetch out is refused`);
		assert.equal(p.storage, 'SecurityError', `${label}: sessionStorage throws`);
		assert.equal(p.pushState, 'SecurityError', `${label}: pushState throws`);
		assert.equal(p.pushHash, 'SecurityError', `${label}: pushState with a hash throws`);
	}

	// What left the room as data (design 280): the console line and the uncaught error, from a
	// real frame, each attributed to nothing because a compute room has no act on screen.
	const lines = results.opened.lines as [string, string, boolean][];
	assert.deepEqual(lines, [['warn', 'a warning from the room {"n":1}', true]], 'the console line crossed with a stack');
	const errors = results.opened.errors as { kind: string; message: string; stack: string; module?: string }[];
	assert.equal(errors.length, 1, `one uncaught error crossed: ${JSON.stringify(errors)}`);
	assert.equal(errors[0]!.kind, 'error');
	assert.equal(errors[0]!.message, 'TypeError: thrown in the room');
	assert.ok(errors[0]!.stack.includes('probe') || errors[0]!.stack.length > 0, 'with the room\'s own stack');
	assert.equal(errors[0]!.module, undefined, 'no act on screen in a compute room');
	// The driver reports an uncaught error from every frame on the page, so the two throws the
	// probe made on purpose are expected here, and nothing else is.
	assert.deepEqual(pageErrors, ['thrown in the room', 'thrown in the room'], `nothing but the probe's own throws: ${pageErrors.join('; ')}`);
});
