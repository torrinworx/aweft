// `attach` in a real browser: the two modes, told apart by the stamp, over real nodes.
//
// The light tree proves the operations; Chromium proves that the thing being read is a real
// attribute on a real element and that a real hydration keeps the parser's own nodes.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { build } from 'vite';

import { aweft } from '@aweftjs/build';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const space = mkdtempSync(join(tmpdir(), 'aweft-ssg-browser-'));
after(() => rmSync(space, { recursive: true, force: true }));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const BLANK = '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>';

/** Build one page with the bundler plugin and serve it. */
const page = async (name: string, entry: string): Promise<{ url: string; close(): Promise<void> }> => {
	const root = join(space, name);
	const out = join(root, 'dist');
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, 'index.html'), BLANK);
	writeFileSync(join(root, 'entry.tsx'), entry);

	await build({
		root,
		logLevel: 'error',
		plugins: [aweft()],
		// The page is built outside the workspace, so the stack's specifiers are pointed at their
		// sources by hand. A subpath goes before the package it is under, because an alias matches
		// every specifier that starts with its key.
		resolve: {
			alias: {
				'@aweftjs/ssg/client': join(repo, 'packages/ssg/src/client.ts'),
				'@aweftjs/dom/router': join(repo, 'packages/dom/src/router.ts'),
				'@aweftjs/dom': join(repo, 'packages/dom/src/index.ts'),
				'@aweftjs/ui': join(repo, 'packages/ui/src/index.ts'),
				'@aweftjs/core': join(repo, 'packages/core/src/index.ts'),
				'@aweftjs/codec': join(repo, 'packages/codec/src/index.ts'),
			},
		},
		build: { outDir: out, emptyOutDir: true },
	});

	const server = createServer((request, response) => {
		const path = (request.url ?? '/').split('?')[0]!;
		const file = join(out, normalize(path === '/' ? '/index.html' : path));
		if (!file.startsWith(out)) {
			response.writeHead(403).end();
			return;
		}
		try {
			response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
			response.end(readFileSync(file));
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

test('attach hydrates a stamped target and mounts an unstamped one, in a real browser', async () => {
	const site = await page('attach', `
		import { mutable } from '@aweftjs/core';
		import { attach } from '@aweftjs/ssg/client';
		import { context, h, render } from '@aweftjs/ui';

		const clicks = mutable(0);
		const App = (props) => h('main', { id: props.id },
			h('p', { class: 'text' }, 'hello'),
			h('button', { id: props.id + '-go', onClick: () => clicks.set(clicks.get() + 1) }, 'go'));

		// A page a build wrote: the markup is already there and the body carries the stamp.
		const server = context();
		const generated = document.createElement('div');
		generated.id = 'generated';
		generated.setAttribute('data-aweft-ssg', '');
		generated.innerHTML = await render(h(App, { id: 'baked' }), { context: server });
		document.body.appendChild(generated);

		const before = document.querySelector('#baked');
		const beforeText = document.querySelector('#baked .text').firstChild;
		attach(generated, h(App, { id: 'baked' }));

		// The plain shell: nothing in it, and no stamp.
		const live = document.createElement('div');
		live.id = 'live';
		document.body.appendChild(live);
		const stop = attach(live, h(App, { id: 'fresh' }));

		globalThis.result = {
			sameElement: before === document.querySelector('#baked'),
			sameText: beforeText === document.querySelector('#baked .text').firstChild,
			mounted: live.querySelector('#fresh') !== null,
			clicks: () => clicks.get(),
			removeLive: stop,
			liveHtml: () => live.innerHTML,
		};
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		const thrown: string[] = [];
		view.on('pageerror', (error) => thrown.push(String(error)));
		await view.goto(site.url);
		await view.waitForFunction(() => (globalThis as never as { result?: unknown }).result !== undefined);

		const read = await view.evaluate(() => {
			const held = (globalThis as never as {
				result: { sameElement: boolean; sameText: boolean; mounted: boolean };
			}).result;
			return { ...held };
		});
		assert.equal(read.sameElement, true, 'the stamped target was hydrated, so the server\'s element stayed');
		assert.equal(read.sameText, true, 'and so did its text node');
		assert.equal(read.mounted, true, 'and the unstamped one was mounted, so the page appeared in it');

		// Both are live: a real click reaches the handler through the adopted node and the fresh one.
		await view.click('#baked-go');
		await view.click('#fresh-go');
		assert.equal(await view.evaluate(() => (globalThis as never as { result: { clicks(): number } }).result.clicks()), 2);

		// The removal `attach` answers is the mode's own, so a mounted page comes back out.
		const emptied = await view.evaluate(() => {
			const held = (globalThis as never as { result: { removeLive(): void; liveHtml(): string } }).result;
			held.removeLive();
			return held.liveHtml();
		});
		assert.equal(emptied, '', 'and the removal it answered took the mounted page back out');

		assert.deepEqual(thrown, [], 'the page threw nothing');
	} finally {
		await browser.close();
		await site.close();
	}
});
