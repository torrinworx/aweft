// The router in a real browser.
//
// The Node suite drives the router over a fake window, which proves the rules. This proves the
// host: that `pushState` moves the address bar, that the back button reports through `popstate`,
// that `history.scrollRestoration` is honoured, that a real click on a real anchor is what
// `links` intercepts, and that a real scroll position survives a real navigation.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build } from 'vite';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const space = mkdtempSync(join(tmpdir(), 'aweft-router-browser-'));
after(() => rmSync(space, { recursive: true, force: true }));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const PAGE = `<!doctype html><html><head><title>router</title></head><body>
	<div id="app" style="height: 3000px">
		<a id="go" href="/second">second</a>
		<a id="native" href="/second" data-no-route>second, natively</a>
		<a id="away" href="https://example.test/x">away</a>
		<a id="to-hash" href="#target">down the page</a>
		<h2 id="target" style="margin-top: 2200px">the target</h2>
	</div>
	<p id="url"></p>
	<script type="module" src="./entry.ts"></script>
</body></html>`;

const ENTRY = `
	import { createRouter } from '@aweftjs/dom/router';

	const router = createRouter();
	router.links(document.getElementById('app'));
	const out = document.getElementById('url');
	router.url.effect((url) => { out.textContent = String(url); });
	window.routerUnderTest = router;
`;

/** Build the page and serve it, answering every path with it so a deep link loads. */
const site = async (): Promise<{ url: string; close(): Promise<void> }> => {
	const root = join(space, 'page');
	const out = join(root, 'dist');
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, 'index.html'), PAGE);
	writeFileSync(join(root, 'entry.ts'), ENTRY);

	await build({
		root,
		logLevel: 'error',
		resolve: {
			alias: {
				'@aweftjs/dom/router': join(repo, 'packages/dom/src/router.ts'),
				'@aweftjs/core': join(repo, 'packages/core/src/index.ts'),
				'@aweftjs/codec': join(repo, 'packages/codec/src/index.ts'),
			},
		},
		build: { outDir: out, emptyOutDir: true },
	});

	const server = createServer((request, response) => {
		const path = (request.url ?? '/').split('?')[0]!;
		const file = join(out, normalize(path === '/' ? '/index.html' : path));
		const wanted = file.startsWith(out) && extname(file) !== '' ? file : join(out, 'index.html');
		try {
			response.writeHead(200, { 'content-type': TYPES[extname(wanted)] ?? 'text/html' });
			response.end(readFileSync(wanted));
		} catch {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	return {
		url: `http://127.0.0.1:${port}/`,
		close: () => new Promise<void>((resolve) => { server.close(() => resolve()); }),
	};
};

test('the router drives real history, real clicks and real scroll in Chromium', async () => {
	const served = await site();
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const problems: string[] = [];
	page.on('pageerror', (error) => problems.push(String(error)));

	try {
		await page.goto(served.url);
		await page.waitForFunction(() => document.getElementById('url')?.textContent === '/');

		assert.equal(await page.evaluate(() => history.scrollRestoration), 'manual',
			'the router told the browser not to guess where the page was');

		// A real click on a real anchor moves the address bar without a page load.
		const loads: string[] = [];
		page.on('load', () => loads.push('load'));
		await page.click('#go');
		assert.equal(new URL(page.url()).pathname, '/second');
		assert.equal(await page.textContent('#url'), '/second');
		assert.deepEqual(loads, [], 'nothing was fetched: the click was taken over');

		// The back button reports through popstate and the cell follows it.
		await page.goBack();
		await page.waitForFunction(() => document.getElementById('url')?.textContent === '/');
		assert.equal(new URL(page.url()).pathname, '/');

		// A saved scroll position comes back with its entry.
		await page.evaluate(() => window.scrollTo(0, 500));
		await page.waitForFunction(() => window.scrollY === 500);
		// Clicked through the DOM rather than with the mouse, because Playwright scrolls an element
		// into view before it clicks it, which would throw away the position under test.
		await page.evaluate(() => { document.getElementById('go')!.click(); });
		await page.waitForFunction(() => document.getElementById('url')?.textContent === '/second');
		await page.evaluate(() => window.scrollTo(0, 0));
		await page.goBack();
		await page.waitForFunction(() => document.getElementById('url')?.textContent === '/');
		assert.equal(await page.evaluate(() => window.scrollY), 0, 'the browser did not restore it by itself');
		const restored = await page.evaluate(() => {
			const router = (window as unknown as { routerUnderTest: { saved(): unknown; restore(): boolean } }).routerUnderTest;
			return { saved: router.saved(), moved: router.restore(), where: window.scrollY };
		}) as { saved: unknown; moved: boolean; where: number };
		assert.deepEqual(restored.saved, { x: 0, y: 500 });
		assert.equal(restored.moved, true);
		assert.equal(restored.where, 500, 'the page is back where it was left');

		// The opt-out attribute leaves the click to the browser, which fetches the page again.
		await page.click('#native');
		await page.waitForFunction(() => document.getElementById('url')?.textContent === '/second');
		assert.equal(loads.length, 1, 'the browser navigated, so the page loaded again');

		// Another origin is not this router's business.
		const away = page.waitForRequest('https://example.test/x').catch(() => null);
		await page.route('https://example.test/**', (route) => route.fulfill({ status: 200, body: 'elsewhere' }));
		await page.click('#away');
		assert.notEqual(await away, null, 'the browser was allowed to leave');

		assert.deepEqual(problems, [], 'the page threw nothing');
	} finally {
		await browser.close();
		await served.close();
	}
});

test('a link into this same page is left to the browser, which scrolls to the target', async () => {
	const served = await site();
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
	const problems: string[] = [];
	page.on('pageerror', (error) => problems.push(String(error)));
	const loads: string[] = [];
	page.on('load', () => loads.push('load'));

	try {
		await page.goto(served.url);
		await page.waitForFunction(() => document.getElementById('url')?.textContent === '/');
		loads.length = 0;

		await page.click('#to-hash');
		await page.waitForFunction(() => window.scrollY > 0);
		const where = await page.evaluate(() => ({
			y: window.scrollY,
			top: document.getElementById('target')!.offsetTop,
			hash: location.hash,
			cell: document.getElementById('url')?.textContent ?? '',
		}));
		assert.ok(Math.abs(where.y - where.top) < 4, `the target is at the top of the view: ${where.y} against ${where.top}`);
		assert.equal(where.hash, '#target', 'the browser wrote the entry');
		assert.deepEqual(loads, [], 'and nothing was fetched: a fragment is the same document');
		assert.equal(where.cell, '/#target',
			'the browser reports the entry it wrote, so the cell follows a URL the router did not push');

		// Back leaves the fragment, which the browser reports and the router follows.
		await page.goBack();
		await page.waitForFunction(() => location.hash === '');
		assert.equal(await page.evaluate(() => document.getElementById('url')?.textContent), '/');

		assert.deepEqual(problems, [], 'the page threw nothing');
	} finally {
		await browser.close();
		await served.close();
	}
});
