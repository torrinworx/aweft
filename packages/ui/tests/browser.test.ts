// What only a real browser can answer.
//
// The light tree proves the operations; Chromium proves the things a fake DOM has no opinion
// about: what the cascade actually does with a layer, what hydration does to real nodes, and what
// a real mousedown outside a popup does. The gallery recipe drives the whole page; this file
// drives the three cases the gallery cannot state as an assertion.

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
const space = mkdtempSync(join(tmpdir(), 'aweft-ui-browser-'));
after(() => rmSync(space, { recursive: true, force: true }));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Build one page with the bundler plugin and serve it. */
const page = async (name: string, html: string, entry: string): Promise<{ url: string; close(): Promise<void> }> => {
	const root = join(space, name);
	const out = join(root, 'dist');
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, 'index.html'), html);
	writeFileSync(join(root, 'entry.tsx'), entry);

	await build({
		root,
		logLevel: 'error',
		plugins: [aweft()],
		// The page is built outside the workspace, so the stack's specifiers are pointed at their
		// sources by hand.
		resolve: {
			alias: {
				'@aweftjs/ui': join(repo, 'packages/ui/src/index.ts'),
				'@aweftjs/dom': join(repo, 'packages/dom/src/index.ts'),
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

test('an application\'s own stylesheet beats the library, with no !important anywhere', async () => {
	const site = await page('layers', `<!doctype html><html><head>
		<style>.mine { background: rgb(1, 2, 3); }</style>
	</head><body><script type="module" src="./entry.tsx"></script></body></html>`, `
		import { Theme, h, mount } from '@aweftjs/ui';
		Theme.define({ swatch: { background: 'rgb(9, 9, 9)' } });
		mount(document.body, <div id="box" class="mine" theme="swatch">x</div>);
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#box');
		const background = await view.evaluate(() => getComputedStyle(document.querySelector('#box')!).backgroundColor);
		// The page's rule is unlayered and the library's is in @layer aweft; unlayered wins,
		// with a one-class selector and no specificity fight.
		assert.equal(background, 'rgb(1, 2, 3)');
		const sheet = await view.evaluate(() => document.head.querySelector('style[data-aweft]')!.textContent ?? '');
		assert.ok(sheet.includes('@layer aweft'));
		assert.ok(!sheet.includes('!important'));
	} finally {
		await browser.close();
		await site.close();
	}
});

test('two mounts into one page compute the colour each of them asked for', async () => {
	const site = await page('two-mounts', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { Theme, h, mount } from '@aweftjs/ui';
		Theme.define({ left: { color: 'rgb(255, 0, 0)' }, right: { color: 'rgb(0, 0, 255)' } });
		mount(document.body, <p id="one" theme="left">one</p>);
		mount(document.body, <p id="two" theme="right">two</p>);
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#two');
		const seen = await view.evaluate(() => ({
			one: getComputedStyle(document.querySelector('#one')!).color,
			two: getComputedStyle(document.querySelector('#two')!).color,
			classes: [document.querySelector('#one')!.getAttribute('class'), document.querySelector('#two')!.getAttribute('class')],
			sheets: document.head.querySelectorAll('style[data-aweft]').length,
		}));
		// Two mounts with no context of their own share the page's render, so the second cannot
		// mint a class the first already used and redefine it underneath.
		assert.equal(seen['one'], 'rgb(255, 0, 0)');
		assert.equal(seen['two'], 'rgb(0, 0, 255)');
		assert.notEqual(seen['classes'][0], seen['classes'][1]);
		assert.equal(seen['sheets'], 1);
	} finally {
		await browser.close();
		await site.close();
	}
});

test('hydrating server markup in a real browser keeps the server\'s nodes', async () => {
	const site = await page('hydration', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { Theme, context, h, hydrate, render } from '@aweftjs/ui';
		// An entry of this page's own. Defining a property the default theme already sets, with a
		// different value, is a refusal (design 111), so a test theme picks its own name.
		Theme.define({ slab: { padding: '8px' } });

		const App = () => <main theme="slab" id="app"><p id="text">hello</p></main>;

		const server = context();
		const markup = await render(<App />, { context: server });

		const host = document.createElement('div');
		host.id = 'host';
		host.innerHTML = markup;
		document.body.appendChild(host);
		const style = document.createElement('style');
		style.setAttribute('data-aweft', '');
		style.textContent = server.theme.markup();
		document.head.appendChild(style);

		const before = document.querySelector('#app');
		const beforeText = document.querySelector('#text').firstChild;
		hydrate(host, <App />);
		window.result = {
			sameElement: before === document.querySelector('#app'),
			sameText: beforeText === document.querySelector('#text').firstChild,
			sheets: document.head.querySelectorAll('style[data-aweft]').length,
			padding: getComputedStyle(document.querySelector('#app')).padding,
		};
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForFunction(() => (window as unknown as { result?: unknown }).result !== undefined);
		const result = await view.evaluate(() => (window as unknown as { result: Record<string, unknown> }).result);
		assert.equal(result['sameElement'], true, 'the server element was adopted, not replaced');
		assert.equal(result['sameText'], true, 'and so was its text node');
		assert.equal(result['sheets'], 1, 'the server stylesheet was adopted, not doubled');
		assert.equal(result['padding'], '8px', 'and the class the server wrote still applies');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('an onResize that throws is reported and the placement loop keeps running', async () => {
	const site = await page('onresize', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { mutable } from '@aweftjs/core';
		import { Detached, PopupContext, h, mark, mount } from '@aweftjs/ui';

		const open = mutable(true);
		const tall = mutable('40px');
		let resizes = 0;
		window.tall = tall;
		window.state = () => ({ resizes, top: document.querySelector('#pop').parentElement.style.top });

		mount(document.body, (
			<PopupContext>
				<Detached enabled={open} onResize={() => { resizes += 1; throw new Error('onResize exploded'); }}>
					<div id="anchor" style={{ width: '100px', height: tall, background: 'grey' }}>anchor</div>
					<mark.popup><div id="pop">menu</div></mark.popup>
				</Detached>
			</PopupContext>
		));
	`);

	const browser = await chromium.launch();
	const errors: string[] = [];
	try {
		const view = await browser.newPage();
		view.on('pageerror', (error) => errors.push(error.message));
		await view.goto(site.url);
		await view.waitForSelector('#pop');

		type State = { resizes: number; top: string };
		const read = (): Promise<State> => view.evaluate(() => (window as unknown as { state(): State }).state());
		const grow = async (height: string): Promise<void> => {
			await view.evaluate((value) => (window as unknown as { tall: { set(v: string): void } }).tall.set(value), height);
			await view.waitForTimeout(200);
		};

		await view.waitForTimeout(200);
		const first = await read();
		await grow('120px');
		const second = await read();
		await grow('200px');
		const third = await read();

		assert.equal(second.resizes, first.resizes + 1);
		// The loop asks for the next frame whatever the handler did, so the second resize is seen
		// too and the popup is still being re-placed under its anchor.
		assert.equal(third.resizes, second.resizes + 1, 'the placement loop stopped at the first throw');
		assert.notEqual(third.top, second.top, 'the popup did not move when its anchor grew');
		assert.ok(errors.length >= 2, 'the throws were reported to the page rather than swallowed');
		assert.ok(errors.every((message) => message.includes('onResize exploded')));
	} finally {
		await browser.close();
		await site.close();
	}
});

test('a real mousedown outside a popup closes it, and one inside does not', async () => {
	const site = await page('outside', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { mutable } from '@aweftjs/core';
		import { Popup, PopupContext, h, mount } from '@aweftjs/ui';

		const where = mutable({ mode: 'below-start', left: 40, top: 40, maxWidth: 200, maxHeight: 100, transformOrigin: 'top left' });
		window.where = where;

		mount(document.body, (
			<PopupContext>
				<div id="outside" style={{ width: '100px', height: '100px' }}>outside</div>
				<Popup placement={where}><div id="inside">the popup</div></Popup>
			</PopupContext>
		));
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#inside');

		await view.mouse.move(60, 60);
		await view.mouse.down();
		await view.mouse.up();
		assert.notEqual(await view.evaluate(() => (window as unknown as { where: { get(): unknown } }).where.get()), null,
			'a click inside the popup leaves it open');

		await view.mouse.move(5, 5);
		await view.mouse.down();
		await view.mouse.up();
		assert.equal(await view.evaluate(() => (window as unknown as { where: { get(): unknown } }).where.get()), null,
			'a click outside it closes it');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('light and dark nested on one page each compute their own roles', async () => {
	const site = await page('modes', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { Theme, dark, h, light, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<Theme value={light}><div id="pale" theme="card">light</div></Theme>
			<Theme value={dark}><div id="deep" theme="card">dark</div></Theme>
		</div>);
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#deep');
		const seen = await view.evaluate(() => ({
			pale: getComputedStyle(document.querySelector('#pale')!).backgroundColor,
			deep: getComputedStyle(document.querySelector('#deep')!).backgroundColor,
			paleInk: getComputedStyle(document.querySelector('#pale')!).color,
			deepInk: getComputedStyle(document.querySelector('#deep')!).color,
		}));
		// One entry, two modes, and the browser is what says the roles actually moved.
		assert.notEqual(seen['pale'], seen['deep'], 'the two surfaces differ');
		assert.notEqual(seen['paleInk'], seen['deepInk'], 'and so does the text on them');
	} finally {
		await browser.close();
		await site.close();
	}
});
