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
