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

import { type Page, chromium } from 'playwright';
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
				// The four shared behaviours are internal (design 129), so a browser test that drives
				// one reaches its file by name; `countries` is a real subpath and is here for the
				// same reason. Before the package, because an alias matches a subpath under its own
				// key.
				'@aweftjs/ui/countries': join(repo, 'packages/ui/src/countries.ts'),
				'@aweftjs/ui/dialog': join(repo, 'packages/ui/src/dialog.ts'),
				'@aweftjs/ui/tooltip': join(repo, 'packages/ui/src/tooltip-trigger.ts'),
				'@aweftjs/ui': join(repo, 'packages/ui/src/index.ts'),
				// Before the package itself, because an alias matches a subpath under its own key.
				'@aweftjs/dom/router': join(repo, 'packages/dom/src/router.ts'),
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
		// Read first, then write the head: writing 200 before the read answers a missing file with
		// an empty body and no error, which is a build that produced nothing looking like a page
		// that renders nothing.
		let body: ReturnType<typeof readFileSync> | null = null;
		try {
			body = readFileSync(file);
		} catch {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
		response.end(body);
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

		// The host's own popover dressing is off the box: what it holds draws the surface.
		const box = await view.evaluate(() => {
			let held = document.querySelector('#inside')!.parentElement!;
			while (held.getAttribute('popover') === null) held = held.parentElement!;
			const cs = getComputedStyle(held);
			return { border: cs.borderTopWidth, padding: cs.paddingTop, fill: cs.backgroundColor };
		});
		assert.deepEqual(box, { border: '0px', padding: '0px', fill: 'rgba(0, 0, 0, 0)' },
			'the box the sink places wears none of the host\'s popover style');

		// The middle of what the popup holds, wherever the box put it.
		const inside = (await view.locator('#inside').boundingBox())!;
		await view.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2);
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

test('a hydrated page adopts the server\'s head tags, and a title cell moves document.title', async () => {
	const site = await page('head', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { mutable } from '@aweftjs/core';
		import { Link, Meta, Title, context, h, hydrate, render } from '@aweftjs/ui';

		const heading = mutable('Server title');
		const App = () => (
			<main id="app">
				<Title>{heading}</Title>
				<Meta name="description" content="what this page is" />
				<Link rel="canonical" href="https://example.test/here" />
				<p>body</p>
			</main>
		);

		const server = context();
		const markup = await render(<App />, { context: server });
		const host = document.createElement('div');
		host.id = 'host';
		host.innerHTML = markup;
		document.body.appendChild(host);
		document.head.innerHTML = server.head.markup();

		const stamped = Array.from(document.head.querySelectorAll('[data-aweft-head]'));
		hydrate(host, <App />);

		const after = Array.from(document.head.querySelectorAll('[data-aweft-head]'));
		window.result = {
			adopted: stamped.length === after.length && stamped.every((node, at) => node === after[at]),
			stamps: after.map((node) => node.getAttribute('data-aweft-head')),
			title: document.title,
			description: document.querySelector('meta[name=description]').getAttribute('content'),
		};
		heading.set('Live title');
		queueMicrotask(() => { window.result.later = document.title; });
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForFunction(() => (window as unknown as { result?: { later?: string } }).result?.later !== undefined);
		const result = await view.evaluate(() => (window as unknown as { result: Record<string, unknown> }).result);
		assert.equal(result['adopted'], true, 'every stamped tag is the element the server wrote');
		assert.deepEqual(result['stamps'], ['meta:name=description', 'title', 'link:canonical']);
		assert.equal(result['title'], 'Server title', 'the adopted <title> is the page title');
		assert.equal(result['description'], 'what this page is');
		assert.equal(result['later'], 'Live title', 'a cell rewrote the tag the browser is reading');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('an act change scrolls to the element the URL\'s hash names', async () => {
	const site = await page('stage-hash', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { createRouter } from '@aweftjs/dom/router';
		import { Stage, StageContext, h, mount } from '@aweftjs/ui';

		const Home = () => <main id="home">home</main>;
		// Tall on purpose: an element the page has to be scrolled to reach.
		const Long = () => (
			<main id="long">
				<p style="height: 2400px">the long way down</p>
				<h2 id="target">the target</h2>
				<p style="height: 1200px">and more below it, so the target can reach the top</p>
			</main>
		);

		const router = createRouter();
		mount(document.body, (
			<StageContext router={router} acts={{ '': Home, long: Long }}><Stage /></StageContext>
		));
		window.go = (url) => { router.push(url); };
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage({ viewport: { width: 800, height: 600 } });
		await view.goto(site.url);
		await view.waitForSelector('#home');

		// The first act is a page load and not a change, so this is the second one.
		await view.evaluate(() => (window as unknown as { go(url: string): void }).go('/long#target'));
		await view.waitForSelector('#target');
		await view.waitForFunction(() => window.scrollY > 0);

		const where = await view.evaluate(() => ({
			y: window.scrollY,
			top: document.querySelector('#target')!.offsetTop,
		}));
		assert.ok(where.top > 600, `the target is off the first screen: ${where.top}`);
		assert.ok(Math.abs(where.y - where.top) < 4,
			`a new act with a hash goes to the element it names: at ${where.y}, target at ${where.top}`);
	} finally {
		await browser.close();
		await site.close();
	}
});

// --- the controls, driven by a real keyboard ----------------------------------------------------

const BLANK = '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>';

/** Build a page, open it, run the checks, and take everything down. */
/**
 * A page holding a composite answers the icon names it asks for: `Icons` starts empty and a name
 * nothing answers asserts (design 144). One drawing under every name is enough here, because what
 * is being driven is the component and never the glyph.
 */
const ANY_ICON = "const anyIcon = () => ({ body: '<path d=\"M0 0L10 10\"/>', width: 10, height: 10 });";

const drive = async (name: string, entry: string, check: (view: Page) => Promise<void>): Promise<void> => {
	const site = await page(name, BLANK, entry);
	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		const thrown: string[] = [];
		view.on('pageerror', (error) => thrown.push(String(error)));
		await view.goto(site.url);
		await check(view);
		assert.deepEqual(thrown, [], 'the page threw nothing');
	} finally {
		await browser.close();
		await site.close();
	}
};

test('Space on a checkbox toggles it, because the checkbox is the platform\'s', async () => {
	await drive('checkbox-keys', `
		import { Checkbox, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const on = mutable(false);
		globalThis.read = () => on.get();
		mount(document.body, <Checkbox id="box" label="Remember me" value={on} />);
	`, async (view) => {
		await view.waitForSelector('#box');
		await view.focus('#box');
		await view.keyboard.press('Space');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): boolean }).read()), true);
		await view.keyboard.press('Space');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): boolean }).read()), false);
	});
});

test('the arrow keys move a radio group, because one name is what makes it a group', async () => {
	await drive('radio-keys', `
		import { Radio, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const size = mutable('small');
		globalThis.read = () => size.get();
		mount(document.body, [
			<Radio id="small" label="Small" value={size} option="small" />,
			<Radio id="medium" label="Medium" value={size} option="medium" />,
			<Radio id="large" label="Large" value={size} option="large" />,
		]);
	`, async (view) => {
		await view.waitForSelector('#small');
		const names = await view.evaluate(() => ['small', 'medium', 'large']
			.map((id) => document.querySelector(`#${id}`)!.getAttribute('name')));
		assert.equal(new Set(names).size, 1, 'one name across the group');

		await view.focus('#small');
		await view.keyboard.press('ArrowDown');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): string }).read()), 'medium');
		await view.keyboard.press('ArrowDown');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): string }).read()), 'large');
		// The platform wraps, and Tab steps over the whole group rather than through it.
		await view.keyboard.press('ArrowDown');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): string }).read()), 'small');
	});
});

test('Home and End take a slider to its ends', async () => {
	await drive('slider-keys', `
		import { Slider, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const volume = mutable(4);
		globalThis.read = () => volume.get();
		mount(document.body, <Slider id="volume" label="Volume" value={volume} min={0} max={10} />);
	`, async (view) => {
		await view.waitForSelector('#volume');
		await view.focus('#volume');
		await view.keyboard.press('End');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): number }).read()), 10);
		await view.keyboard.press('Home');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): number }).read()), 0);
		await view.keyboard.press('ArrowRight');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): number }).read()), 1,
			'one step, from the platform');
	});
});

test('Enter in a text field calls onEnter and does not submit the form it is in', async () => {
	await drive('enter-key', `
		import { TextField, h, mount } from '@aweftjs/ui';
		const seen = [];
		globalThis.read = () => seen.length;
		globalThis.submitted = () => document.title;
		mount(document.body, (
			<form onSubmit={() => { document.title = 'submitted'; }}>
				<TextField id="name" label="Name" onEnter={() => seen.push(1)} />
			</form>
		));
	`, async (view) => {
		await view.waitForSelector('#name');
		await view.focus('#name');
		await view.keyboard.press('Enter');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): number }).read()), 1);
		assert.notEqual(await view.title(), 'submitted', 'the key\'s own default was prevented');
	});
});

test('the drawn list opens under the control, and a real key picks an item', async () => {
	// Design 224: the list is this package's on every host, so all of this is markup a real browser
	// lays out rather than a picker only one host would theme.
	await drive('select-list', `
		import { PopupContext, Select, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const users = [{ id: 7, name: 'Ada' }, { id: 9, name: 'Grace' }, { id: 11, name: 'Katherine' }];
		const chosen = mutable(null);
		globalThis.read = () => chosen.get();
		mount(document.body, (
			<PopupContext>
				<Select id="user" label="Owner" value={chosen} options={users}
					display={(user) => user.name} placeholder="Pick someone" />
			</PopupContext>
		));
	`, async (view) => {
		await view.waitForSelector('#user');
		assert.equal(await view.getAttribute('#user', 'aria-expanded'), 'false');
		assert.equal(await view.getAttribute('#user', 'role'), 'combobox');

		await view.click('#user');
		await view.waitForFunction(() => document.querySelector('#user')!.getAttribute('aria-expanded') === 'true');
		// One frame for the placement solver, and then the arrival animation: a box still scaling
		// reports a scaled rectangle, which is 96% of the width it is settling on.
		await view.waitForFunction(() => {
			const list = document.querySelector('[role="listbox"]');
			return list !== null && list.getBoundingClientRect().width > 0
				&& getComputedStyle(list)['transform'] === 'none';
		});

		const boxes = await view.evaluate(() => {
			const control = document.querySelector('#user')!.getBoundingClientRect();
			const list = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
			return {
				below: Math.round(list.top) >= Math.round(control.top + control.height) - 1,
				width: Math.round(list.width),
				control: Math.round(control.width),
				rows: document.querySelectorAll('[role="option"]').length,
			};
		});
		assert.equal(boxes.below, true, `the list sits under the control: ${JSON.stringify(boxes)}`);
		assert.equal(boxes.width, boxes.control, 'and it is the control\'s own width');
		assert.equal(boxes.rows, 3, 'the placeholder is not a row anybody can land on');

		// ArrowDown twice from nothing is the second item, and Enter takes it.
		await view.keyboard.press('ArrowDown');
		await view.keyboard.press('ArrowDown');
		await view.keyboard.press('Enter');
		assert.deepEqual(
			await view.evaluate(() => (globalThis as never as { read(): unknown }).read()),
			{ id: 9, name: 'Grace' },
			'the cell holds the object, not the text the row read as',
		);
		assert.equal(await view.getAttribute('#user', 'aria-expanded'), 'false', 'and picking closed it');
		assert.equal(await view.evaluate(() => document.activeElement?.id), 'user',
			'with the focus back on the control');

		// Type-ahead, and Escape, both on the control because that is where the focus stays.
		await view.keyboard.press('ArrowDown');
		await view.keyboard.press('k');
		const named = await view.evaluate(() => {
			const at = document.querySelector('#user')!.getAttribute('aria-activedescendant') ?? '';
			return document.querySelector(`[id="${at}"]`)?.textContent ?? null;
		});
		assert.equal(named, 'Katherine', 'a letter moved to the first row beginning with it');

		await view.keyboard.press('Escape');
		assert.equal(await view.getAttribute('#user', 'aria-expanded'), 'false');
		assert.equal(await view.evaluate(() => document.activeElement?.id), 'user',
			'Escape leaves the focus where the person was');

		// The hidden element is what a form reads, and it followed every one of those.
		const posted = await view.evaluate(() => {
			const native = document.querySelector('select')!;
			return { value: native.value, offscreen: native.getBoundingClientRect().width < 2 };
		});
		assert.equal(posted.value, 'Grace',
			'an object writes no value attribute, so the platform posts what the row reads as');
		assert.equal(posted.offscreen, true, 'and the element a form reads is off the screen');
	});
});

test('the drawn list sits under the control in dark as well as in light', async () => {
	await drive('select-list-dark', `
		import { PopupContext, Select, Theme, dark, h, mount } from '@aweftjs/ui';
		mount(document.body, (
			<Theme value={dark}>
				<PopupContext>
					<Select id="sel" label="Owner" options={['Ada', 'Grace']} />
				</PopupContext>
			</Theme>
		));
	`, async (view) => {
		await view.waitForSelector('#sel');
		await view.click('#sel');
		await view.waitForFunction(() => {
			const list = document.querySelector('[role="listbox"]');
			return list !== null && list.getBoundingClientRect().width > 0
				&& getComputedStyle(list)['transform'] === 'none';
		});
		const seen = await view.evaluate(() => {
			const control = document.querySelector('#sel')!.getBoundingClientRect();
			const list = document.querySelector('[role="listbox"]')!;
			const box = list.getBoundingClientRect();
			return {
				below: Math.round(box.top) >= Math.round(control.top + control.height) - 1,
				width: Math.round(box.width) === Math.round(control.width),
				fill: getComputedStyle(list).backgroundColor,
			};
		});
		assert.equal(seen.below, true);
		assert.equal(seen.width, true);
		// `$surface` is `$neutral2`, which is `#161a20` in dark and `#f5f6f8` in light.
		assert.equal(seen.fill, 'rgb(22, 26, 32)', 'the list is the dark surface, not the light one');
	});
});

test('a menu flips above its anchor when there is no room below it', async () => {
	await drive('menu-flip', `
		import { Menu, PopupContext, h, mount } from '@aweftjs/ui';
		mount(document.body, (
			<PopupContext>
				<div style={{ height: '200vh' }} />
				<Menu id="quick" label="Quick Actions" items={[{
					heading: 'Conversation',
					items: [
						{ label: 'Mute Conversation' },
						{ label: 'Mark as Read' },
						{ label: 'Block User' },
						{ label: 'Delete Conversation', type: 'danger' },
					],
				}]} />
			</PopupContext>
		));
	`, async (view) => {
		await view.waitForSelector('#quick');
		await view.evaluate(() => { document.querySelector('#quick')!.scrollIntoView({ block: 'end' }); });
		await view.click('#quick');
		await view.waitForFunction(() => {
			const menu = document.querySelector('[role="menu"]');
			return menu !== null && menu.getBoundingClientRect().height > 0
				&& getComputedStyle(menu)['transform'] === 'none';
		});

		const seen = await view.evaluate(() => {
			const anchor = document.querySelector('#quick')!.getBoundingClientRect();
			const menu = document.querySelector('[role="menu"]')!.getBoundingClientRect();
			const rows = Array.from(document.querySelectorAll('[role="menuitem"]'));
			const danger = rows[rows.length - 1]!;
			return {
				above: Math.round(menu.top + menu.height) <= Math.round(anchor.top) + 1,
				anchorTop: Math.round(anchor.top),
				menuTop: Math.round(menu.top),
				rows: rows.length,
				dangerInk: getComputedStyle(danger).color,
				plainInk: getComputedStyle(rows[0]!).color,
			};
		});
		assert.equal(seen.above, true,
			`the menu is above the anchor at the foot of the page: ${JSON.stringify(seen)}`);
		assert.equal(seen.rows, 4);
		// `$danger` is `$danger9`, `#c32430` in light, which is the one non-neutral role the default
		// theme has.
		assert.equal(seen.dangerInk, 'rgb(195, 36, 48)', 'the dangerous row computes $danger');
		assert.notEqual(seen.plainInk, seen.dangerInk, 'and the others do not');
	});
});

test('a menu inside a modal opens inside the dialog, and its rows can be clicked', async () => {
	// A dialog's top layer swallows every pointer event aimed at anything outside it, so a menu
	// drawn at a sink beside the page was a menu nobody could click. The popup's sink is the nearest
	// `<dialog>` above it now (design 113, amended).
	await drive('menu-in-modal', `
		import { createRouter } from '@aweftjs/dom/router';
		import { Icons, Menu, Modal, PopupContext, Stage, StageContext, h, mount } from '@aweftjs/ui';

		${ANY_ICON}
		let stage = null;
		const picked = [];
		globalThis.picked = () => picked;
		const Home = (props) => { stage = props.stage; return <main id="home">home</main>; };
		const Edit = () => (
			<div id="editing">
				<Menu id="quick" label="Quick Actions" items={[
					{ label: 'Mute', onSelect: () => picked.push('mute') },
					{ label: 'Delete', onSelect: () => picked.push('delete') },
				]} />
			</div>
		);

		const router = createRouter();
		mount(document.body, (
			<Icons value={anyIcon}>
				<PopupContext>
					<StageContext router={router} acts={{ '': Home, edit: Edit }}><Stage /></StageContext>
				</PopupContext>
			</Icons>
		));
		globalThis.openIt = () => stage.open({ name: 'edit', template: Modal });
	`, async (view) => {
		await view.waitForSelector('#home');
		await view.evaluate(() => (globalThis as never as { openIt(): void }).openIt());
		await view.waitForSelector('#quick');

		await view.click('#quick');
		await view.waitForFunction(() => {
			const menu = document.querySelector('[role="menu"]');
			return menu !== null && menu.getBoundingClientRect().height > 0
				&& getComputedStyle(menu)['transform'] === 'none';
		});

		const seen = await view.evaluate(() => {
			const rows = Array.from(document.querySelectorAll('[role="menuitem"]'));
			const row = rows[rows.length - 1]!;
			const box = row.getBoundingClientRect();
			const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
			return {
				inDialog: document.querySelector('dialog')!.contains(row),
				hitsRow: hit !== null && (hit === row || row.contains(hit)),
				hit: hit === null ? null : hit.tagName.toLowerCase(),
				focused: document.activeElement?.getAttribute('role') ?? null,
			};
		});
		assert.equal(seen.inDialog, true, 'the list is inside the dialog rather than beside the page');
		assert.equal(seen.hitsRow, true,
			`the middle of a row belongs to the row: ${JSON.stringify(seen)}`);
		assert.equal(seen.focused, 'menu', 'and opening it put the focus on the menu itself');

		await view.click('[role="menuitem"]:last-child');
		assert.deepEqual(
			await view.evaluate(() => (globalThis as never as { picked(): string[] }).picked()),
			['delete'], 'a real click on a row ran that row\'s own onSelect');
	});
});

// --- the dialog behaviour, in a real browser ------------------------------------------------------

test('a modal dialog takes the page out of the reading order and gives the keyboard back', async () => {
	await drive('dialog', `
		import { h, mount } from '@aweftjs/ui';
		import { dialogControl } from '@aweftjs/ui/dialog';
		const dialog = document.createElement('dialog');
		dialog.id = 'sheet';
		dialog.innerHTML = '<button id="inside">close</button>';
		document.body.appendChild(dialog);
		mount(document.body, <main id="page"><button id="opener">open</button></main>);
		const modal = dialogControl(dialog, { onClose: () => { document.title = 'closed'; } });
		document.querySelector('#opener').addEventListener('click', () => modal.open());
		document.querySelector('#inside').addEventListener('click', () => modal.close());
	`, async (view) => {
		await view.waitForSelector('#opener');
		await view.click('#opener');

		const open = await view.evaluate(() => ({
			showing: document.querySelector('#sheet')!.open,
			modal: document.querySelector('#sheet')!.matches(':modal'),
			pageInert: document.querySelector('#page')!.hasAttribute('inert'),
			dialogInert: document.querySelector('#sheet')!.hasAttribute('inert'),
		}));
		assert.deepEqual(open, { showing: true, modal: true, pageInert: true, dialogInert: false },
			'showModal put it in the top layer, and the rest of the page went inert');

		// `showModal` puts the keyboard in the dialog, and the page behind it is inert, so Tab
		// cannot walk back out into it.
		assert.equal(await view.evaluate(() => document.activeElement?.id), 'inside');
		await view.keyboard.press('Tab');
		assert.notEqual(await view.evaluate(() => document.activeElement?.id), 'opener',
			'Tab did not walk out into the page behind the dialog');

		// The platform queues the `close` event rather than firing it inside `close()`, so what
		// undoes the rest of it lands on the next task.
		await view.click('#inside');
		await view.waitForFunction(() => document.title === 'closed');
		assert.equal(await view.evaluate(() => document.querySelector('#page')!.hasAttribute('inert')), false,
			'the page is reachable again');
		assert.equal(await view.evaluate(() => document.activeElement?.id), 'opener',
			'the keyboard went back to the button that opened it');
	});
});

test('Escape closes a modal through the element\'s own cancel event', async () => {
	await drive('dialog-escape', `
		import { h, mount } from '@aweftjs/ui';
		import { dialogControl } from '@aweftjs/ui/dialog';
		const dialog = document.createElement('dialog');
		dialog.id = 'sheet';
		dialog.innerHTML = '<p>hello</p>';
		document.body.appendChild(dialog);
		mount(document.body, <main id="page"><button id="opener">open</button></main>);
		const modal = dialogControl(dialog, { onClose: () => { document.title = 'closed'; } });
		document.querySelector('#opener').addEventListener('click', () => modal.open());
	`, async (view) => {
		await view.waitForSelector('#opener');
		await view.click('#opener');
		assert.equal(await view.evaluate(() => document.querySelector('#page')!.hasAttribute('inert')), true);

		await view.keyboard.press('Escape');
		await view.waitForFunction(() => document.title === 'closed');
		assert.equal(await view.evaluate(() => document.querySelector('#page')!.hasAttribute('inert')), false,
			'Escape reached the element, and the element told us');
	});
});

// --- the tooltip trigger, in a real browser --------------------------------------------------------

test('a tooltip shows on hover and on focus, and asks for the top layer as a hint', async () => {
	await drive('tooltip', `
		import { h, mount } from '@aweftjs/ui';
		import { tooltipTrigger } from '@aweftjs/ui/tooltip';
		import { mutable } from '@aweftjs/core';
		const open = mutable(false);
		globalThis.read = () => open.get();
		mount(document.body, [
			<button id="anchor">what is this</button>,
			<div id="tip" style={{ position: 'fixed', top: 0, left: 0 }}>an explanation</div>,
		]);
		const anchor = document.querySelector('#anchor');
		const tip = document.querySelector('#tip');
		open.effect((on) => { tip.textContent = on ? 'an explanation' : ''; });
		tooltipTrigger({ nodes: () => [anchor], panel: () => tip, open, delay: 30 });
	`, async (view) => {
		await view.waitForSelector('#anchor');
		assert.equal(await view.evaluate(() => document.querySelector('#tip')!.getAttribute('popover')), null,
			'nothing is asked for before it is needed');

		await view.hover('#anchor');
		await view.waitForFunction(() => (globalThis as never as { read(): boolean }).read());
		assert.equal(await view.evaluate(() => document.querySelector('#tip')!.getAttribute('popover')), 'hint',
			'hint, not manual: a tip does not close a menu that is already open');
		assert.equal(await view.evaluate(() => document.querySelector('#tip')!.matches(':popover-open')), true,
			'and the host put it in the top layer');

		await view.mouse.move(0, 300);
		await view.waitForFunction(() => !(globalThis as never as { read(): boolean }).read());
		assert.equal(await view.evaluate(() => document.querySelector('#tip')!.matches(':popover-open')), false);

		await view.focus('#anchor');
		await view.waitForFunction(() => (globalThis as never as { read(): boolean }).read());
		await view.keyboard.press('Escape');
		await view.waitForFunction(() => !(globalThis as never as { read(): boolean }).read());
	});
});

test('a hydrated page is live: a real click, a real keystroke, a real focus and a real hover', async () => {
	await drive('hydrated-live', `
		import { Button, TextField, context, h, hydrate, render } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';

		const clicks = mutable(0);
		const text = mutable('');
		const focused = mutable(false);
		const hovered = mutable(false);

		// The same item on both sides, which is what hydration is: the server's copy runs here
		// only because this test has no server.
		const App = () => (
			<div>
				<Button id="save" label="Save" onClick={() => clicks.set(clicks.get() + 1)} />
				<TextField id="email" label="Email" value={text} isFocused={focused} isHovered={hovered} />
			</div>
		);

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

		globalThis.read = () => ({
			clicks: clicks.get(), text: text.get(), focused: focused.get(), hovered: hovered.get(),
		});
		globalThis.adopted = document.querySelector('#save');
		hydrate(host, <App />);
		globalThis.same = globalThis.adopted === document.querySelector('#save');
	`, async (view) => {
		await view.waitForSelector('#save');
		assert.equal(await view.evaluate(() => (globalThis as never as { same: boolean }).same), true,
			'the button is the one the server wrote');

		const paint = async (): Promise<string> => view.evaluate(() =>
			getComputedStyle(document.querySelector('#save')!).backgroundImage ?? '');
		const quiet = await paint();

		await view.click('#save');
		await view.click('#email');
		await view.keyboard.type('ada@example.com');
		await view.hover('#save');
		// The hovered segment is a class this package writes, not a `:hover` rule, so a change here
		// is the theme reaching the node the hydration adopted (design 133).
		assert.notEqual(await paint(), quiet, 'the hovered tint is on the button the server sent');
		await view.hover('#email');
		assert.equal(await paint(), quiet, 'and off it again when the pointer leaves');

		const state = await view.evaluate(() => (globalThis as never as {
			read(): { clicks: number; text: string; focused: boolean; hovered: boolean };
		}).read());
		assert.deepEqual(state, {
			clicks: 1, text: 'ada@example.com', focused: true, hovered: true,
		}, 'every handler this package owns survived the hydration');

		// And they let go: focus and hover both come back off their cells.
		await view.evaluate(() => { (document.querySelector('#email') as never as { blur(): void }).blur(); });
		await view.hover('#save');
		const after = await view.evaluate(() => (globalThis as never as {
			read(): { focused: boolean; hovered: boolean };
		}).read());
		assert.deepEqual([after.focused, after.hovered], [false, false]);
	});
});

test('a stage whose provider above it is replaced still routes afterwards', async () => {
	// A light and dark switch is the ordinary way a subtree above a stage is rebuilt: the cell
	// moves, the whole provider is taken down and a new stage is built in its place. What has to
	// hold is that the new stage reads the router it was given, so the next act change shows an
	// act rather than blanking the page.
	await drive('stage-remount', `
		import { mutable } from '@aweftjs/core';
		import { createRouter } from '@aweftjs/dom/router';
		import { Head, PopupContext, Stage, StageContext, Theme, Title, dark, h, light, mount } from '@aweftjs/ui';

		const Layout = (props) => <div id="page">{props.children}</div>;
		const One = () => <p id="one"><Head><Title>One</Title></Head>one</p>;
		const Two = () => <p id="two"><Head><Title>Two</Title></Head>two</p>;

		const router = createRouter();
		const mode = mutable('light');
		globalThis.mode = mode;
		globalThis.router = router;

		mount(document.body, mode.map((now) => (
			<Theme value={now === 'dark' ? dark : light}>
				<PopupContext>
					<StageContext router={router} acts={{ '': One, two: Two }} template={Layout} fallback="">
						<Stage />
					</StageContext>
				</PopupContext>
			</Theme>
		)));
	`, async (view) => {
		const go = (url: string): Promise<void> => view.evaluate((to) => {
			(globalThis as never as { router: { push(url: string): void } }).router.push(to);
		}, url);

		await view.waitForSelector('#one');
		await go('/two');
		await view.waitForSelector('#two');
		await go('/');
		await view.waitForSelector('#one');

		await view.evaluate(() => { (globalThis as never as { mode: { set(v: string): void } }).mode.set('dark'); });
		await view.waitForSelector('#one');

		await go('/two');
		await view.waitForSelector('#two');
		assert.equal(await view.title(), 'Two', 'and the rebuilt stage still writes the act\'s title');
	});
});

test('the same stage, taken over from server markup, still routes after the swap', async () => {
	// The hydrating half of the case above. A page that was rendered and then adopted has the
	// same provider above the same stage, and the swap has to leave it routing there too.
	await drive('stage-remount-hydrate', `
		import { mutable } from '@aweftjs/core';
		import { createRouter } from '@aweftjs/dom/router';
		import { Head, PopupContext, Stage, StageContext, Theme, Title, context, dark, h, hydrate, light, render } from '@aweftjs/ui';

		const Layout = (props) => <div id="page">{props.children}</div>;
		const One = () => <p id="one"><Head><Title>One</Title></Head>one</p>;
		const Two = () => <p id="two"><Head><Title>Two</Title></Head>two</p>;

		const mode = mutable('light');
		globalThis.mode = mode;

		const App = (props) => mode.map((now) => (
			<Theme value={now === 'dark' ? dark : light}>
				<PopupContext>
					<StageContext router={props.router} acts={{ '': One, two: Two }} template={Layout} fallback="">
						<Stage />
					</StageContext>
				</PopupContext>
			</Theme>
		));

		const server = context();
		const markup = await render(<App router={createRouter({ url: '/' })} />, { context: server });
		const host = document.createElement('div');
		host.id = 'host';
		host.innerHTML = markup;
		document.body.appendChild(host);

		const router = createRouter();
		globalThis.router = router;
		hydrate(host, <App router={router} />);
	`, async (view) => {
		const go = (url: string): Promise<void> => view.evaluate((to) => {
			(globalThis as never as { router: { push(url: string): void } }).router.push(to);
		}, url);

		await view.waitForSelector('#one');
		await go('/two');
		await view.waitForSelector('#two');
		await view.evaluate(() => { (globalThis as never as { mode: { set(v: string): void } }).mode.set('dark'); });
		await view.waitForSelector('#two');
		await go('/');
		await view.waitForSelector('#one');
		assert.equal(await view.title(), 'One');
	});
});

// --- the composites, driven for real -------------------------------------------------------------

test('a modal opened with history: true closes on Escape, on its button and on back, at one URL', async () => {
	await drive('modal-history', `
		import { createRouter } from '@aweftjs/dom/router';
		import { Icons, Modal, Stage, StageContext, h, mount } from '@aweftjs/ui';

		${ANY_ICON}
		let stage = null;
		const Home = (props) => { stage = props.stage; return <main id="home">home</main>; };
		const Edit = () => <p id="editing">editing</p>;

		const router = createRouter();
		mount(document.body, (
			<Icons value={anyIcon}>
				<StageContext router={router} acts={{ '': Home, edit: Edit }}><Stage /></StageContext>
			</Icons>
		));
		globalThis.openIt = () => stage.open({ name: 'edit', template: Modal, history: true });
	`, async (view) => {
		await view.waitForSelector('#home');
		const start = await view.evaluate(() => location.href);

		const open = async (): Promise<void> => {
			await view.evaluate(() => (globalThis as never as { openIt(): void }).openIt());
			await view.waitForSelector('#editing');
		};

		await open();
		assert.equal(await view.evaluate(() => document.querySelector('dialog')!.matches(':modal')), true,
			'the element is showing as a modal, which is what puts it in the top layer');
		assert.equal(await view.evaluate(() => location.href), start,
			'a history: true open does not move the address bar (design 124)');

		// Escape, which the platform delivers as the element's own `cancel`.
		await view.keyboard.press('Escape');
		await view.waitForFunction(() => document.querySelector('#editing') === null);
		assert.equal(await view.evaluate(() => location.href), start, 'and closing it does not either');
		await view.waitForSelector('#home');

		// The close button and back land on the same page, because both are the stage's close.
		await open();
		await view.click('dialog button[aria-label="Close"]');
		await view.waitForFunction(() => document.querySelector('#editing') === null);
		const afterButton = await view.evaluate(() => location.href);

		await open();
		await view.evaluate(() => { history.back(); });
		await view.waitForFunction(() => document.querySelector('#editing') === null);
		assert.equal(await view.evaluate(() => location.href), afterButton,
			'back and the close button are one navigation, not two ways to be half closed');
		await view.waitForSelector('#home');
	});
});

/** One tip's rectangles, its attributes, and what the browser finds in the middle of it. */
interface Tip {
	anchor: Record<string, number>;
	box: Record<string, number>;
	panel: Record<string, number>;
	popover: string | null;
	role: string | null;
	hitsPanel: boolean;
}

/**
 * Read the tip off the page once the solver has placed the box.
 *
 * `Detached` holds the box `visibility: hidden` for the one frame between opening it and knowing
 * where it goes, so a visible box is a placed box. Waiting on `:popover-open` alone is too early:
 * the box is opened with a placeholder placement on the frame before the first measurement.
 */
const tipOf = async (view: Page): Promise<Tip> => {
	await view.waitForFunction(() => {
		const holder = document.querySelector('[role="tooltip"]')?.parentElement ?? null;
		return holder !== null && holder.matches(':popover-open')
			&& getComputedStyle(holder)['visibility'] !== 'hidden';
	});
	return view.evaluate(() => {
		const box = (element: RecipeElement): Record<string, number> => {
			const rect = element.getBoundingClientRect();
			return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
		};
		const panel = document.querySelector('[role="tooltip"]')!;
		const holder = panel.parentElement!;
		const rect = panel.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		return {
			anchor: box(document.querySelector('#anchor')!),
			box: box(holder),
			panel: box(panel),
			popover: panel.getAttribute('popover'),
			role: panel.getAttribute('role'),
			hitsPanel: hit !== null && (hit === panel || panel.contains(hit)),
		};
	});
};

/**
 * What a placed tip has to be true of: the panel inside the box the solver placed, the box against
 * one side of the anchor, and the middle of the panel belonging to the panel.
 *
 * The panel wears no `popover` of its own, which is what keeps the first of those true: the box is
 * already a popover, and a popover inside a popover is put in the top layer and laid out by the
 * browser, which lands it in the middle of the screen (design 135).
 */
const assertPlaced = (tip: Tip): void => {
	const a = tip.anchor;
	const b = tip.box;
	const p = tip.panel;
	assert.equal(tip.role, 'tooltip', 'the panel is still the thing a screen reader reads');
	// The rectangles first, so a tip that got away says where it went rather than only why.
	assert.ok(
		p['left']! >= b['left']! - 2 && p['top']! >= b['top']! - 2
			&& p['left']! + p['width']! <= b['left']! + b['width']! + 2
			&& p['top']! + p['height']! <= b['top']! + b['height']! + 2,
		`the panel left the box the solver placed: box ${JSON.stringify(b)}, panel ${JSON.stringify(p)}`);
	assert.equal(tip.popover, null, 'the panel wears no popover of its own');

	// Beside the anchor, on one of the four sides: touching on one axis and centred on the other.
	const near = (one: number, other: number): boolean => Math.abs(one - other) <= 2;
	const acrossX = near(a['left']! + a['width']! / 2, b['left']! + b['width']! / 2);
	const acrossY = near(a['top']! + a['height']! / 2, b['top']! + b['height']! / 2);
	const sides = [
		near(b['top']!, a['top']! + a['height']!) && acrossX,
		near(b['top']! + b['height']!, a['top']!) && acrossX,
		near(b['left']!, a['left']! + a['width']!) && acrossY,
		near(b['left']! + b['width']!, a['left']!) && acrossY,
	];
	assert.ok(sides.some(Boolean),
		`the box is on none of the four sides of the anchor: anchor ${JSON.stringify(a)}, box ${JSON.stringify(b)}`);
	assert.ok(tip.hitsPanel, 'the point in the middle of the tip is not the tip: something is over it');
};

test('a real hover shows a Tooltip after the pause, and a real focus shows it at once', async () => {
	await drive('tooltip-component', `
		import { PopupContext, Tooltip, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const shown = mutable(false);
		globalThis.read = () => shown.get();
		mount(document.body, (
			<PopupContext>
				<main id="page" style={{ padding: '80px' }}>
					<Tooltip label="an explanation" enabled={shown}>
						<button id="anchor">what is this</button>
					</Tooltip>
				</main>
			</PopupContext>
		));
	`, async (view) => {
		await view.waitForSelector('#anchor');
		const panel = '[role="tooltip"]';
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): boolean }).read()), false);
		assert.equal(
			await view.evaluate((query: string) =>
				document.querySelector('#anchor')!.getAttribute('aria-describedby')
					=== document.querySelector(query)!.getAttribute('id'), panel),
			true, 'the anchor names the panel, so a screen reader reads the tip');

		await view.hover('#anchor');
		await view.waitForFunction(() => (globalThis as never as { read(): boolean }).read());
		assertPlaced(await tipOf(view));

		await view.mouse.move(0, 400);
		await view.waitForFunction(() => !(globalThis as never as { read(): boolean }).read());

		// Focus does not wait: the person arrived on purpose.
		await view.focus('#anchor');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): boolean }).read()), true,
			'a keyboard sees it without the pause a pointer gets');
	});
});

test('a Tooltip taken over from server markup places its tip against the server\'s own anchor', async () => {
	await drive('tooltip-hydrated', `
		import { PopupContext, Tooltip, context, h, hydrate, render } from '@aweftjs/ui';

		const App = () => (
			<PopupContext>
				<main id="page">
					<Tooltip label="an explanation">
						<button id="anchor" style={{ position: 'absolute', left: '300px', top: '200px', width: '120px', height: '40px' }}>
							what is this
						</button>
					</Tooltip>
				</main>
			</PopupContext>
		);

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

		// The node the server sent, held before the client touches it. A hydration that rebuilt the
		// anchor instead of adopting it would leave a different node here.
		const sent = document.querySelector('#anchor');
		hydrate(host, <App />);
		globalThis.sameAnchor = sent === document.querySelector('#anchor');
		globalThis.ready = true;
	`, async (view) => {
		await view.waitForFunction(() => (globalThis as never as { ready?: boolean }).ready === true);
		assert.equal(await view.evaluate(() => (globalThis as never as { sameAnchor: boolean }).sameAnchor), true,
			'the anchor on the page is the node the server sent');

		// The rectangle everything here is measured against is the server's node's, which is the
		// whole point of the case.
		await view.hover('#anchor');
		assertPlaced(await tipOf(view));
	});
});

test('Space on a drop down summary toggles it, and the cell follows', async () => {
	await drive('dropdown-keys', `
		import { DropDown, Icons, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		${ANY_ICON}
		const open = mutable(false);
		globalThis.read = () => open.get();
		globalThis.openIt = () => { open.set(true); };
		mount(document.body, (
			<Icons value={anyIcon}>
				<DropDown id="filters" label="Filters" open={open}><p id="inside">inside</p></DropDown>
			</Icons>
		));
	`, async (view) => {
		await view.waitForSelector('#filters');
		assert.equal(await view.evaluate(() => document.querySelector('#filters summary')!.tagName), 'SUMMARY');

		await view.focus('#filters summary');
		await view.keyboard.press('Space');
		await view.waitForFunction(() => (globalThis as never as { read(): boolean }).read());
		assert.equal(await view.evaluate(() => document.querySelector('#filters')!.hasAttribute('open')), true,
			'the platform opened it and the cell heard about it');

		await view.keyboard.press('Space');
		await view.waitForFunction(() => !(globalThis as never as { read(): boolean }).read());

		// And the other way: the cell opens it without anybody pressing anything.
		await view.evaluate(() => (globalThis as never as { openIt(): void }).openIt());
		await view.waitForFunction(() => document.querySelector('#filters')!.hasAttribute('open'));
	});
});

test('a real file set on the input lands in the files array as a ready entry', async () => {
	await drive('filedrop-input', `
		import { FileDrop, Icons, h, mount } from '@aweftjs/ui';
		import { mutableArray } from '@aweftjs/core';
		${ANY_ICON}
		const files = mutableArray();
		globalThis.read = () => [...files].map((entry) => [entry.name, entry.status, entry.file instanceof File]);
		mount(document.body, (
			<Icons value={anyIcon}><FileDrop id="drop" files={files} extensions={['image/png']} /></Icons>
		));
	`, async (view) => {
		await view.waitForSelector('#drop');
		await view.setInputFiles('#drop input[type=file]', {
			name: 'shot.png',
			mimeType: 'image/png',
			buffer: Buffer.from('not really a png'),
		});
		await view.waitForFunction(() => (globalThis as never as { read(): unknown[] }).read().length > 0);
		assert.deepEqual(
			await view.evaluate(() => (globalThis as never as { read(): unknown[] }).read()),
			[['shot.png', 'ready', true]],
			'the entry carries the platform File itself, which is what an application uploads');
	});
});

test('a real click on a FileDrop.Button opens the file dialog once', async () => {
	// The button opens the input, and that click then reaches the zone, which resolves the same
	// input. Without the zone's guard the dialog opens twice, which no light-tree test sees:
	// bubbling is the browser's.
	await drive('filedrop-button-once', `
		import { FileDrop, Icons, h, mount } from '@aweftjs/ui';
		${ANY_ICON}
		mount(document.body, (
			<Icons value={anyIcon}>
				<FileDrop id="drop">
					<FileDrop.Button id="pick" label="Choose a file" />
				</FileDrop>
			</Icons>
		));
		globalThis.opens = 0;
		document.querySelector('#drop input[type=file]').click = () => { globalThis.opens += 1; };
	`, async (view) => {
		await view.waitForSelector('#pick');
		await view.click('#pick');
		assert.equal(await view.evaluate(() => (globalThis as never as { opens: number }).opens), 1,
			'the button opened it, and the click arriving at the zone did not open it again');

		// The zone itself still opens the dialog, which is what the guard must not cost.
		await view.click('#drop', { position: { x: 5, y: 5 } });
		assert.equal(await view.evaluate(() => (globalThis as never as { opens: number }).opens), 2,
			'a click on the zone away from the button still opens it');
	});
});

test('a real drag across the colour plane moves the thumb and writes the cell', async () => {
	// The plane is the one control in this package drawn out of an element of its own (design 222),
	// so what a real browser has to answer is the geometry: a pointer measured against a real box,
	// pointer capture on a real element, and a thumb placed by percentages of a real square.
	await drive('colorpicker-plane', `
		import { ColorPicker, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const picked = mutable('#ff0000');
		globalThis.read = () => picked.get();
		globalThis.write = (text) => picked.set(text);
		mount(document.body, <ColorPicker id="pick" value={picked} hasAlpha={false} />);
	`, async (view) => {
		await view.waitForSelector('#pick [role="slider"]');
		const started = await view.evaluate(() => (globalThis as never as { read(): string }).read());
		assert.equal(started, '#ff0000', 'mounting left the caller\'s colour and its notation alone');

		// $planeSize, which is 160px, in both directions.
		const square = await view.evaluate(() => {
			const box = document.querySelector('#pick [role="slider"]')!.parentElement!.getBoundingClientRect();
			return { width: Math.round(box.width), height: Math.round(box.height) };
		});
		assert.deepEqual(square, { width: 160, height: 160 }, 'the plane is $planeSize square');

		// A press a quarter across and a quarter down, then a drag on to the middle, with the button
		// held the whole way. The capture is what keeps the moves coming.
		const box = await view.evaluate(() => {
			const rect = document.querySelector('#pick [role="slider"]')!.parentElement!.getBoundingClientRect();
			return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
		});
		await view.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
		await view.mouse.down();
		await view.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
		await view.mouse.up();

		const after = await view.evaluate(() => ({
			cell: (globalThis as never as { read(): string }).read(),
			text: document.querySelector('#pick [role="slider"]')!.getAttribute('aria-valuetext'),
			left: (document.querySelector('#pick [role="slider"]') as never as { style: Record<string, string> }).style.left,
			top: (document.querySelector('#pick [role="slider"]') as never as { style: Record<string, string> }).style.top,
		}));
		assert.equal(after.text, 'saturation 50%, brightness 50%',
			`the middle of the square is half of each axis, and the thumb says ${String(after.text)}`);
		assert.equal(after.left, '50%', 'the thumb is where the pointer left it');
		assert.equal(after.top, '50%');
		// Half saturated and half bright at hue 0, worked out by hand through `fromHsv`.
		assert.equal(after.cell, 'rgb(128, 64, 64)', 'and the drag wrote the cell as rgb() text');

		// The other direction: a colour written from outside puts the thumb where that colour is.
		// A full blue is the far top corner, which is nowhere near where the drag left it.
		await view.evaluate(() => (globalThis as never as { write(text: string): void }).write('rgb(0, 0, 255)'));
		await view.waitForFunction(() =>
			(document.querySelector('#pick [role="slider"]') as never as { style: Record<string, string> }).style.left === '100%');
		const moved = await view.evaluate(() => ({
			left: (document.querySelector('#pick [role="slider"]') as never as { style: Record<string, string> }).style.left,
			top: (document.querySelector('#pick [role="slider"]') as never as { style: Record<string, string> }).style.top,
			text: document.querySelector('#pick [role="slider"]')!.getAttribute('aria-valuetext'),
			hue: (document.querySelector('#pick input[type=range]') as never as { value: string }).value,
		}));
		assert.deepEqual(moved, {
			left: '100%', top: '0%', text: 'saturation 100%, brightness 100%', hue: '240',
		}, 'a full blue is the far corner of the square and 240 degrees round the hue');

		// An arrow on the thumb writes, which is the half no pointer proves.
		await view.focus('#pick [role="slider"]');
		await view.keyboard.press('ArrowLeft');
		await view.waitForFunction(() =>
			document.querySelector('#pick [role="slider"]')!.getAttribute('aria-valuetext')
				=== 'saturation 99%, brightness 100%');
		assert.match(await view.evaluate(() => (globalThis as never as { read(): string }).read()), /^rgb\(/,
			'and a key is a write, as rgb() text');

		// The plane is a control a person operates, so it has to pass the same audit every page in
		// this package does. The audit is scoped to the picker: the page around it is this file's
		// blank harness, with no title and no language, and neither is anything the component says.
		await view.addScriptTag({ path: fileURLToPath(import.meta.resolve('axe-core/axe.min.js')) });
		const audit = await view.evaluate(async () => (globalThis as never as {
			axe: { run(node: unknown, options: unknown): Promise<{ violations: { id: string; help: string }[] }> };
		}).axe.run(document.querySelector('#pick')!, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
		assert.deepEqual(audit.violations.map((violation) => `${violation.id}: ${violation.help}`), [],
			'axe found nothing to fix on the picker');
	});
});

test('End on the colour picker\'s hue slider writes the cell', async () => {
	await drive('colorpicker-keys', `
		import { ColorPicker, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const picked = mutable('#1b6ef3');
		globalThis.read = () => picked.get();
		mount(document.body, <ColorPicker id="pick" value={picked} hasAlpha={false} />);
	`, async (view) => {
		await view.waitForSelector('#pick');
		const started = await view.evaluate(() => (globalThis as never as { read(): string }).read());
		assert.equal(started, '#1b6ef3',
			'mounting the picker left the caller\'s colour and its notation alone');

		await view.focus('#pick input[type=range]');
		await view.keyboard.press('End');
		await view.waitForFunction((was: string) =>
			(globalThis as never as { read(): string }).read() !== was, started);

		const hue = await view.evaluate(() =>
			document.querySelector('#pick input[type=range]')!.value);
		assert.equal(hue, '360', 'End took the hue slider to its end');

		const ended = await view.evaluate(() => (globalThis as never as { read(): string }).read());
		assert.match(ended, /^rgb\(/, 'a slider move is what writes the cell, as rgb() text');
		const [red, green, blue] = (/rgb\((\d+), (\d+), (\d+)\)/.exec(ended) ?? []).slice(1).map(Number);
		assert.ok(red! > green! && red! > blue!,
			`a hue of 360 is a red, and the cell says ${ended}`);
	});
});

test('a Typography heading computes the theme\'s weight and the wrap the host reads', async () => {
	const site = await page('typography', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { Typography, h, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<Typography type="h2_bold" id="heading" label="A heading that runs on for a little while" />
			<Typography type="p1" id="body" label="A paragraph." />
		</div>);
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#heading');
		const seen = await view.evaluate(() => {
			const style = (id: string): Record<string, string> =>
				getComputedStyle(document.querySelector(`#${id}`)!);
			return {
				tag: document.querySelector('#heading')!.tagName.toLowerCase(),
				weight: style('heading')['fontWeight'],
				size: style('heading')['fontSize'],
				headingWrap: style('heading')['textWrap'],
				bodyWrap: style('body')['textWrap'],
			};
		});
		assert.equal(seen.tag, 'h2', 'the first segment picked the element');
		// A browser draws an `<h2>` bold on its own, so 600 here is the theme's weight beating the
		// host's, which is the whole reason `text_h2` states one.
		assert.equal(seen.weight, '600');
		assert.equal(seen.size, '30px', '$text3xl, which is 1.875rem of the 16px root');
		assert.equal(seen.headingWrap, 'balance', 'a heading asks the browser to even its lines');
		assert.equal(seen.bodyWrap, 'pretty', 'and a paragraph asks it not to leave a word alone');
	} finally {
		await browser.close();
		await site.close();
	}
});

// --- the look, measured rather than read off the stylesheet --------------------------------------

test('every control computes the one height, and a select lays its content out in a line', async () => {
	const site = await page('control-heights', BLANK, `
		import { Button, Checkbox, Icons, PopupContext, Select, TextField, h, mount } from '@aweftjs/ui';
		${ANY_ICON}
		mount(document.body, <Icons value={anyIcon}><PopupContext><div>
			<Button id="btn" label="Save" />
			<TextField id="tf" placeholder="Something short" />
			<Select id="sel" options={['a', 'b']} />
			<Checkbox id="cb" label="Tick me" />
		</div></PopupContext></Icons>);
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#sel');
		const seen = await view.evaluate(() => {
			const box = (id: string): { top: number; height: number } =>
				document.querySelector(`#${id}`)!.getBoundingClientRect();
			const label = document.querySelector('#cb')!.parentElement!.querySelector('label')!;
			return {
				button: box('btn').height,
				field: box('tf').height,
				select: box('sel').height,
				selectDisplay: getComputedStyle(document.querySelector('#sel')!)['display'],
				row: document.querySelector('#cb')!.parentElement!.getBoundingClientRect().height,
				boxTop: box('cb').top,
				labelTop: label.getBoundingClientRect().top,
			};
		});

		// $control, measured. A declared height is only the height because the entry says what its
		// box model is: an `<input>` is content-box in Chromium and a `<button>` is not.
		assert.equal(seen.button, 36, 'a button is $control tall');
		assert.equal(seen.field, 36, 'and so is a text field');
		// A `<select>` in the base appearance lays out its value and the host's picker icon, and
		// as the block `input` is those stacked and took it to 58px (design 192).
		assert.equal(seen.selectDisplay, 'inline-flex');
		assert.equal(seen.select, 36, 'a select is the same height as the field beside it');

		// The label used to match the bare `field` entry as well and become a full-width column,
		// which pushed the box onto a line of its own (design 192).
		assert.ok(Math.abs(seen.boxTop - seen.labelTop) < 4,
			`a checkbox and its label are on one line: ${String(seen.boxTop)} against ${String(seen.labelTop)}`);
		assert.equal(seen.row, 36, 'and the row they sit in is $control tall');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('a real Tab draws the ring as a halo and takes the border to $ring', async () => {
	const site = await page('focus-ring', BLANK, `
		import { TextField, h, mount } from '@aweftjs/ui';
		mount(document.body, <TextField id="tf" placeholder="x" />);
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForSelector('#tf');

		const resting = await view.evaluate(() =>
			getComputedStyle(document.querySelector('#tf')!)['boxShadow'] ?? '');
		assert.match(resting, /0px 1px 2px/, 'an input carries the hairline edge before anything is focused');

		await view.keyboard.press('Tab');
		// The border colour transitions, so this waits for it rather than reading it mid-way.
		await view.waitForFunction(() =>
			getComputedStyle(document.querySelector('#tf')!)['borderTopColor'] === 'rgb(90, 97, 110)');
		const focused = await view.evaluate(() => {
			const style = getComputedStyle(document.querySelector('#tf')!);
			return {
				id: document.activeElement!.id,
				outline: style['outlineStyle'] ?? '',
				border: style['borderTopColor'] ?? '',
				shadow: style['boxShadow'] ?? '',
			};
		});

		assert.equal(focused.id, 'tf');
		assert.equal(focused.outline, 'none', 'the ring is not an outline (design 192)');
		// $ring in light mode is $neutral8, #5a616e. Written here from the scale, not read from it.
		assert.equal(focused.border, 'rgb(90, 97, 110)', 'the control\'s own edge moves to $ring');
		assert.match(focused.shadow, /0px 0px 0px 3px/, 'a $ringWidth halo');
		assert.match(focused.shadow, /0\.5/, 'in $ring at half strength');
		// The focus rule is `.awN:focus-visible` and the hairline is `.awN`, so the pseudo-class
		// outranks it and the halo is the whole shadow rather than one of two.
		assert.doesNotMatch(focused.shadow, /1px 2px/, 'and it replaced the hairline rather than joining it');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('a dialog is transitioned in from nothing, and reduced motion shows it at once', async () => {
	const site = await page('dialog-motion', BLANK, `
		import { h, mount } from '@aweftjs/ui';
		import { dialogControl } from '@aweftjs/ui/dialog';
		// The theme entry's class, taken off a themed element, and worn by the real <dialog>: the
		// element has to be a <dialog> for [open] and the top layer to mean anything.
		mount(document.body, <div id="probe" theme="dialog" />);
		const sheet = document.createElement('dialog');
		sheet.id = 'sheet';
		sheet.className = document.querySelector('#probe').className;
		sheet.innerHTML = '<p>hello</p>';
		document.body.appendChild(sheet);
		window.modal = dialogControl(sheet, {});
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		// A closed dialog is not visible, so this waits for it to be in the document rather than
		// for it to be on the screen.
		await view.waitForFunction(() => document.querySelector('#sheet') !== null);

		const moved = await view.evaluate(async () => {
			const sheet = document.querySelector('#sheet')!;
			const scrim = (): string => getComputedStyle(sheet, '::backdrop')['opacity'] ?? '';
			(window as unknown as { modal: { open(): void } }).modal.open();
			const first = getComputedStyle(sheet)['opacity'] ?? '';
			const scrimFirst = scrim();
			await new Promise<void>((go) => requestAnimationFrame(() => requestAnimationFrame(() => { go(); })));
			const during = getComputedStyle(sheet)['opacity'] ?? '';
			const scrimDuring = scrim();
			await new Promise((go) => setTimeout(go, 300));
			return {
				first, during, scrimFirst, scrimDuring,
				settled: getComputedStyle(sheet)['opacity'] ?? '',
				scrimSettled: scrim(),
			};
		});
		assert.equal(moved.first, '0', '@starting-style is what the first frame is drawn from');
		assert.ok(Number(moved.during) > 0 && Number(moved.during) < 1,
			`and it is on its way in the frames after: ${moved.during}`);
		assert.equal(moved.settled, '1', 'and solid once $fast has passed');

		// The scrim goes with it now (design 190, amended): a `_cssProp_` inside a `_media_` is what
		// keeps the backdrop's transition inside the reduced-motion query, and design 192 said this
		// could not be written. It can.
		assert.equal(moved.scrimFirst, '0', 'the backdrop starts from nothing too');
		assert.ok(Number(moved.scrimDuring) > 0 && Number(moved.scrimDuring) < 1,
			`and fades with the dialog: ${moved.scrimDuring}`);
		assert.equal(moved.scrimSettled, '1', 'and is solid at the end of it');

		await view.emulateMedia({ reducedMotion: 'reduce' });
		const still = await view.evaluate(async () => {
			const sheet = document.querySelector('#sheet')!;
			const modal = (window as unknown as { modal: { open(): void; close(): void } }).modal;
			modal.close();
			await new Promise((go) => setTimeout(go, 300));
			modal.open();
			return getComputedStyle(sheet)['opacity'] ?? '';
		});
		// A starting style is only ever read by a transition, so with no transition there is
		// nothing to start from and the dialog is solid in the frame it is rendered (design 190).
		assert.equal(still, '1', 'reduced motion shows it at once');
		const scrimStill = await view.evaluate(() =>
			getComputedStyle(document.querySelector('#sheet')!, '::backdrop')['opacity'] ?? '');
		assert.equal(scrimStill, '1', 'and so does the scrim, for the same reason');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('every control has three heights, and an icon button is a square at each of them', async () => {
	// The size axis, measured (design 194). The expected numbers are `$controlSm`, `$control` and
	// `$controlLg` written from the design, and the box, the pill and the thumb from the entries
	// that name them.
	await drive('control-sizes', `
		import {
			Button, Checkbox, Icon, Icons, PopupContext, Radio, Select, Slider, TextField, Toggle,
			h, mount,
		} from '@aweftjs/ui';
		${ANY_ICON}
		const row = (suffix, size) => <div>
			<Button id={'btn' + suffix} label="Save" size={size} />
			<Button id={'square' + suffix} icon={<Icon name="search" label="Find" />}
				size={size === undefined ? 'icon' : 'icon-' + size} />
			<TextField id={'tf' + suffix} placeholder="x" size={size} />
			<Select id={'sel' + suffix} options={['a', 'b']} size={size} />
			<Checkbox id={'cb' + suffix} size={size} />
			<Radio id={'rd' + suffix} option="a" size={size} />
			<Toggle id={'tg' + suffix} size={size} />
			<Slider id={'sl' + suffix} size={size} />
		</div>;
		mount(document.body, <Icons value={anyIcon}><PopupContext>
			{row('', undefined)}{row('-sm', 'sm')}{row('-lg', 'lg')}
		</PopupContext></Icons>);
	`, async (view) => {
		await view.waitForSelector('#sl-lg');
		const seen = await view.evaluate(() => {
			const of = (id: string): [number, number] => {
				const box = document.querySelector(`#${id}`)!.getBoundingClientRect();
				return [Math.round(box.width), Math.round(box.height)];
			};
			const out: Record<string, [number, number]> = {};
			for (const name of ['btn', 'square', 'tf', 'sel', 'cb', 'rd', 'tg', 'sl']) {
				for (const suffix of ['', '-sm', '-lg']) out[name + suffix] = of(name + suffix);
			}
			return out;
		});

		// The four controls whose whole box is the control: 32, 36, 40.
		for (const name of ['btn', 'tf', 'sel', 'sl']) {
			assert.equal(seen[name]![1], 36, `${name} is $control tall`);
			assert.equal(seen[`${name}-sm`]![1], 32, `${name} at sm is $controlSm`);
			assert.equal(seen[`${name}-lg`]![1], 40, `${name} at lg is $controlLg`);
		}
		// The three drawn ones, which are a mark beside their words rather than a row of their own.
		assert.deepEqual(seen['cb'], [16, 16], 'a tick box is $box square');
		assert.deepEqual(seen['cb-sm'], [14, 14]);
		assert.deepEqual(seen['cb-lg'], [20, 20]);
		assert.deepEqual(seen['rd'], [16, 16], 'and a radio reaches the same box through extends');
		assert.deepEqual(seen['rd-sm'], [14, 14]);
		assert.deepEqual(seen['rd-lg'], [20, 20]);
		assert.deepEqual(seen['tg'], [40, 24], 'the switch is its pill');
		assert.deepEqual(seen['tg-sm'], [32, 20]);
		assert.deepEqual(seen['tg-lg'], [48, 28]);
		// A square at every size: the width is the height, and no padding survives, not even the
		// `:has()` rule that tightens a button holding an icon.
		assert.deepEqual(seen['square'], [36, 36]);
		assert.deepEqual(seen['square-sm'], [32, 32]);
		assert.deepEqual(seen['square-lg'], [40, 40]);
		const padding = await view.evaluate(() => ({
			plain: getComputedStyle(document.querySelector('#btn')!)['padding'],
			square: getComputedStyle(document.querySelector('#square')!)['padding'],
		}));
		assert.equal(padding.plain, '4px 16px');
		assert.equal(padding.square, '0px', 'a square is its icon and nothing around it');
	});
});

test('a tick box and a radio are drawn by the theme, in both modes', async () => {
	// Design 195. The host draws neither: `appearance` is `none`, and what is on the screen is the
	// entry's own box and its `::before`.
	await drive('drawn-controls', `
		import { Checkbox, Radio, Theme, dark, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		mount(document.body, <div>
			<Checkbox id="on" value={mutable(true)} />
			<Checkbox id="off" value={mutable(false)} />
			<Checkbox id="mixed" value={mutable(false)} indeterminate={true} />
			<Radio id="picked" value={mutable('a')} option="a" />
			<Theme value={dark}><Checkbox id="dark-on" value={mutable(true)} /></Theme>
		</div>);
	`, async (view) => {
		await view.waitForSelector('#dark-on');
		const seen = await view.evaluate(() => {
			const of = (id: string, pseudo?: string): Record<string, string> =>
				getComputedStyle(document.querySelector(`#${id}`)!, pseudo);
			return {
				appearance: of('on')['appearance'],
				light: of('on')['backgroundColor'],
				dark: of('dark-on')['backgroundColor'],
				clear: of('off')['backgroundColor'],
				tick: `${of('on', '::before')['width']} x ${of('on', '::before')['height']}`,
				tickColour: of('on', '::before')['borderRightColor'],
				tickTurn: of('on', '::before')['transform'],
				noTick: of('off', '::before')['content'],
				bar: `${of('mixed', '::before')['width']} x ${of('mixed', '::before')['height']}`,
				dot: `${of('picked', '::before')['width']} x ${of('picked', '::before')['height']}`,
				dotRound: of('picked', '::before')['borderRadius'],
				ring: of('on')['borderTopColor'],
			};
		});

		assert.equal(seen.appearance, 'none', 'the host is not drawing a box of its own');
		// `$accent` is `$neutral12`, which is #1c2027 in light and #edeff3 in dark (design 191).
		// Written here from the scale rather than read off the page.
		assert.equal(seen.light, 'rgb(28, 32, 39)', 'a ticked box is $accent in light');
		assert.equal(seen.dark, 'rgb(237, 239, 243)', 'and $accent in dark, which is the other end');
		assert.equal(seen.clear, 'rgb(252, 252, 253)', 'a clear one is $background');

		// The tick is two sides of a $tickWidth by $tickHeight box, turned a quarter turn.
		assert.equal(seen.tick, '4px x 8px');
		assert.equal(seen.tickColour, 'rgb(252, 252, 253)', 'drawn in $accentForeground');
		assert.equal(seen.tickTurn, 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)', '45 degrees');
		assert.equal(seen.noTick, 'none', 'a clear box has no ::before at all');
		assert.equal(seen.bar, '8px x 2px', 'neither ticked nor clear is one bar');

		assert.equal(seen.dot, '8px x 8px', 'a picked radio is a centred dot');
		assert.equal(seen.dotRound, '50%', 'and the dot is round, not the turned tick it extends');
	});
});

test('the drawn mark fits its box at every size', async () => {
	// The three tick names are redefined per size, so the mark scales with the box (design 195,
	// amended). Fixed at 4, 8 and 2 the mark was one 11.31px lozenge in a 12px inner box and in an
	// 18px one; measured before the fix.
	await drive('drawn-sizes', `
		import { Checkbox, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		mount(document.body, <div>
			<Checkbox id="sm" size="sm" value={mutable(true)} />
			<Checkbox id="md" value={mutable(true)} />
			<Checkbox id="lg" size="lg" value={mutable(true)} />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#lg');
		const seen = await view.evaluate(() => {
			const of = (id: string): { box: number; inner: number; mark: number } => {
				const node = document.querySelector(`#${id}`)!;
				const style = getComputedStyle(node, '::before');
				const border = parseFloat(getComputedStyle(node)['borderTopWidth'] ?? '0');
				// The mark is a rectangle turned 45 degrees, so what has to fit is its diagonal.
				const wide = parseFloat(style['width'] ?? '0') + parseFloat(style['borderRightWidth'] ?? '0');
				const tall = parseFloat(style['height'] ?? '0') + parseFloat(style['borderBottomWidth'] ?? '0');
				return {
					box: node.getBoundingClientRect().width,
					inner: node.getBoundingClientRect().width - border * 2,
					mark: Number(((wide + tall) / Math.SQRT2).toFixed(2)),
				};
			};
			return { sm: of('sm'), md: of('md'), lg: of('lg') };
		});

		assert.deepEqual([seen.sm.box, seen.md.box, seen.lg.box], [14, 16, 20], 'three boxes');
		// Each mark is its own size, and each one fits inside the box it sits in.
		assert.equal(seen.sm.mark, 9.19);
		assert.equal(seen.md.mark, 11.31);
		assert.equal(seen.lg.mark, 14.85);
		for (const [name, held] of Object.entries(seen)) {
			assert.ok(held.mark < held.inner,
				`the ${name} mark is ${String(held.mark)}px inside a ${String(held.inner)}px box`);
		}
	});
});

test('a square button centres its icon, and the icon takes the button\'s own colour', async () => {
	// Two bugs in one page. The size segment is `square` and not `icon`, because `icon` is an entry
	// and the bare segment compiled it onto the button: measured `display: inline-block;
	// width: 1em; height: 1em`, and the svg sat 12.25px from the top of the 36px box and 9.75px
	// from the bottom. And the root entry no longer writes `color`, because it wrote the page's
	// foreground onto an `Icon` inside a filled button: `rgb(28, 32, 39)` on the button's own
	// `rgb(28, 32, 39)` fill, an invisible icon (design 198).
	await drive('square-button', `
		import { Button, Icon, Icons, Theme, dark, h, mount } from '@aweftjs/ui';
		const pack = { icons: { plus: { body: '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2"/>' } } };
		mount(document.body, <Icons value={pack}>
			<div id="light">
				<Button id="square" size="icon" icon={<Icon name="plus" />} />
			</div>
			<Theme value={dark}>
				<div id="dark">
					<Button id="dark-square" size="icon" icon={<Icon name="plus" />} />
				</div>
			</Theme>
		</Icons>);
	`, async (view) => {
		await view.waitForSelector('#dark-square');
		const seen = await view.evaluate(() => {
			const of = (id: string) => {
				const node = document.querySelector(`#${id}`)!;
				const style = getComputedStyle(node);
				const box = node.getBoundingClientRect();
				const svg = node.querySelector('svg')!;
				const drawn = svg.getBoundingClientRect();
				return {
					display: style['display'],
					fill: style['backgroundColor'],
					size: [Math.round(box.width), Math.round(box.height)],
					top: Number((drawn.top - box.top).toFixed(2)),
					bottom: Number((box.bottom - drawn.bottom).toFixed(2)),
					left: Number((drawn.left - box.left).toFixed(2)),
					right: Number((box.right - drawn.right).toFixed(2)),
					ink: getComputedStyle(svg)['color'],
				};
			};
			return { light: of('square'), dark: of('dark-square') };
		});

		for (const [mode, held] of Object.entries(seen)) {
			assert.equal(held.display, 'inline-flex', `the ${mode} square still centres what is in it`);
			assert.deepEqual(held.size, [36, 36], `the ${mode} square is $control both ways`);
			assert.ok(Math.abs(held.top - held.bottom) <= 1,
				`the ${mode} svg is centred down the box: ${String(held.top)} above, ${String(held.bottom)} below`);
			assert.ok(Math.abs(held.left - held.right) <= 1,
				`the ${mode} svg is centred across it: ${String(held.left)} left, ${String(held.right)} right`);
		}
		// `$accent` is #1c2027 in light and #edeff3 in dark, and `$accentForeground` is the other
		// one (design 191). The icon reads the button's colour, not the page's.
		assert.equal(seen.light.fill, 'rgb(28, 32, 39)');
		assert.equal(seen.light.ink, 'rgb(252, 252, 253)', 'the icon is $accentForeground in light');
		assert.equal(seen.dark.fill, 'rgb(237, 239, 243)');
		assert.equal(seen.dark.ink, 'rgb(15, 18, 22)', 'and $accentForeground in dark');
	});
});

test('a tick box takes the root focus ring, which is the only ring it has', async () => {
	// Nothing in the `checkbox` entry mentions focus. The root rule is what draws it (design 118),
	// and it is worth measuring once now the host draws no box of its own.
	await drive('drawn-focus', `
		import { Checkbox, h, mount } from '@aweftjs/ui';
		mount(document.body, <Checkbox id="box" label="Tick me" />);
	`, async (view) => {
		await view.waitForSelector('#box');
		await view.keyboard.press('Tab');
		await view.waitForFunction(() =>
			getComputedStyle(document.querySelector('#box')!)['borderTopColor'] === 'rgb(90, 97, 110)');
		const seen = await view.evaluate(() => {
			const style = getComputedStyle(document.querySelector('#box')!);
			return { outline: style['outlineStyle'], border: style['borderTopColor'], shadow: style['boxShadow'] };
		});
		assert.equal(seen.outline, 'none');
		assert.equal(seen.border, 'rgb(90, 97, 110)', '$ring, which is $neutral8');
		assert.match(seen.shadow ?? '', /0px 0px 0px 3px/, 'and the halo the root rule draws');
	});
});

test('a select carries its own arrow inside its box, and the host draws none', async () => {
	// Design 195, amended. The arrow is an empty box the theme draws two borders on and turns a
	// quarter turn, absolutely placed in a wrapper, so it is the same mark on every host, it costs
	// the select no height, and the page needs no icon pack to have one.
	await drive('select-arrow', `
		import { PopupContext, Select, h, mount } from '@aweftjs/ui';
		mount(document.body, <PopupContext><Select id="sel" options={['a', 'b']} /></PopupContext>);
	`, async (view) => {
		await view.waitForSelector('#sel');
		const seen = await view.evaluate(() => {
			// The control is the button now, and the wrapper holds it, the arrow and the hidden
			// element a form reads (design 224).
			const select = document.querySelector('#sel')!;
			const wrap = select.parentElement!;
			const arrow = wrap.querySelector('span')!;
			const style = getComputedStyle(arrow);
			const box = select.getBoundingClientRect();
			const mark = arrow.getBoundingClientRect();
			return {
				tag: (wrap as unknown as { localName: string }).localName,
				select: Math.round(box.height),
				wrap: Math.round(wrap.getBoundingClientRect().height),
				// The turned box overhangs its own corners, so its bounding rect reaches past the
				// inset the entry declares. `right` is what the entry said.
				right: style['right'],
				// The border box, un-turned: `getComputedStyle` reports the content box, and the
				// rect below is the turned one.
				size: `${String(arrow.offsetWidth)} x ${String(arrow.offsetHeight)}`,
				sides: `${style['borderRightWidth'] ?? ''} ${style['borderBottomWidth'] ?? ''}`,
				missing: `${style['borderTopStyle'] ?? ''} ${style['borderLeftStyle'] ?? ''}`,
				colour: style['borderRightColor'],
				turn: style['transform'],
				offCentre: Math.round((mark.top + mark.height / 2) - (box.top + box.height / 2)),
				inside: mark.right <= box.right && mark.left >= box.left,
				appearance: getComputedStyle(select)['appearance'],
				events: style['pointerEvents'],
				hidden: arrow.getAttribute('aria-hidden'),
				drawings: wrap.querySelectorAll('svg').length,
				empty: arrow.childNodes.length,
			};
		});

		assert.equal(seen.tag, 'span', 'one wrapper, and it is not a block that breaks a row');
		assert.equal(seen.select, 36, 'the select is still $control tall with the arrow in it');
		assert.equal(seen.wrap, 36, 'and the wrapper is the height of the select, not taller');
		assert.equal(seen.inside, true, 'the arrow is inside the control it belongs to');
		assert.equal(seen.right, '12px', '$space3 in from the right edge');
		assert.equal(seen.size, '8 x 8', '$chevron square');
		assert.equal(seen.sides, '1px 1px', 'two sides at $borderWidth');
		assert.equal(seen.missing, 'none none', 'and the other two are not drawn');
		assert.equal(seen.colour, 'rgb(84, 90, 102)', '$mutedForeground, which is $neutral11');
		assert.equal(seen.turn, 'matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, -4)',
			'up half its height and turned 45 degrees, so the drawn corner points down');
		assert.equal(seen.offCentre, 0, 'and on the middle line');
		assert.equal(seen.appearance, 'none',
			'the host draws nothing of its own, and the list is this package\'s (design 224)');
		assert.equal(seen.events, 'none', 'a click on the arrow reaches the select under it');
		assert.equal(seen.hidden, 'true', 'the control beside it is what a screen reader reads');
		assert.equal(seen.drawings, 0, 'nothing was asked of the Icons stack');
		assert.equal(seen.empty, 0, 'the arrow is an empty box, and the borders are the mark');
	});
});

test('a part wears its own rules and none of the component it belongs to', async () => {
	// Design 193, measured. Before it, a class list of `filedrop entry` also matched the bare
	// `filedrop`, so a row in the listing wore the drop zone's dashed border and its padding; and
	// `dialog head` matched `dialog`, so the heading row wore the dialog's own box.
	await drive('parts', `
		import { FileDrop, Icons, h, mount } from '@aweftjs/ui';
		import { mutableArray } from '@aweftjs/core';
		${ANY_ICON}
		const files = mutableArray([{ name: 'a.png', size: 10, status: 'ready', file: null }]);
		mount(document.body, <Icons value={anyIcon}>
			<FileDrop id="zone" files={files} />
			<div id="head" theme={['dialog_head']}>x</div>
			<div id="body" theme={['dialog_body']}>x</div>
		</Icons>);
	`, async (view) => {
		await view.waitForSelector('#zone li');
		const seen = await view.evaluate(() => {
			const of = (selector: string): { border: string; padding: string; maxWidth: string } => {
				const style = getComputedStyle(document.querySelector(selector)!);
				return {
					border: `${style['borderTopWidth']} ${style['borderTopStyle']}`,
					padding: style['padding'] ?? '',
					maxWidth: style['maxWidth'] ?? '',
				};
			};
			return {
				zone: of('#zone'),
				row: of('#zone li'),
				gap: getComputedStyle(document.querySelector('#zone li')!)['gap'],
				head: of('#head'),
				body: of('#body'),
			};
		});

		assert.equal(seen.zone.border, '1px dashed', 'the zone itself still draws the dashed edge');
		assert.equal(seen.zone.padding, '16px');
		assert.equal(seen.row.border, '0px none', 'and a row in its listing does not');
		assert.equal(seen.row.padding, '0px');
		assert.equal(seen.gap, '8px', 'the row is still the row: $space2 between its parts');

		assert.equal(seen.head.padding, '0px', 'a dialog\'s head is not a second dialog');
		assert.equal(seen.head.border, '0px none');
		assert.equal(seen.head.maxWidth, 'none', 'and it does not take the dialog\'s width cap');
		assert.equal(seen.body.padding, '0px');
		assert.equal(seen.body.border, '0px none');
	});
});

test('an inline field puts the control beside its words on one line', async () => {
	// Design 209. The layout is the theme entries and there is no component: `field` is a column,
	// and its `inline` modifier is the row a bare control and the label beside it sit on.
	await drive('field-inline', `
		import { Checkbox, h, mount } from '@aweftjs/ui';
		mount(document.body, <div id="row" role="group" theme={['field', 'inline']}>
			<label for="box" theme="field_label">Email me</label>
			<Checkbox id="box" />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#box');
		const seen = await view.evaluate(() => {
			const row = document.querySelector('#row')!.getBoundingClientRect();
			const words = document.querySelector('#row label')!.getBoundingClientRect();
			const box = document.querySelector('#box')!.getBoundingClientRect();
			return {
				direction: getComputedStyle(document.querySelector('#row')!)['flexDirection'],
				height: Math.round(row.height),
				overlap: words.top < box.bottom && box.top < words.bottom,
				middles: Math.round((words.top + words.height / 2) - (box.top + box.height / 2)),
				order: Math.round(box.left - words.right),
			};
		});

		assert.equal(seen.direction, 'row');
		assert.equal(seen.overlap, true, 'the words and the box share a line');
		assert.equal(seen.height, 36, 'and the line is $control tall');
		assert.equal(seen.middles, 0, 'with their middles level');
		assert.ok(seen.order >= 0, 'the box is after the words the caller wrote first');
	});
});

test('a responsive field is a column in a narrow group and a row in a wide one', async () => {
	// The same field, with nothing about it changed but the width of the group around it. The
	// query is `28rem` of the container, and `field_group` is what declares itself one (design 209).
	await drive('field-responsive', `
		import { TextField, h, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<div id="group" theme="field_group">
				<div id="field" theme={['field', 'responsive']}>
					<label for="mail" theme="field_label">Email</label>
					<TextField id="mail" />
				</div>
			</div>
			<div id="lone" theme={['field', 'responsive']}>
				<label for="other" theme="field_label">Phone</label>
				<TextField id="other" />
			</div>
		</div>);
	`, async (view) => {
		await view.waitForSelector('#mail');
		const at = async (width: string): Promise<string> => view.evaluate((size: string) => {
			document.querySelector('#group')!.setAttribute('style', `width: ${size}`);
			return getComputedStyle(document.querySelector('#field')!)['flexDirection'] ?? '';
		}, width);

		assert.equal(await at('20rem'), 'column', 'under 28rem of its container it stacks');
		assert.equal(await at('40rem'), 'row', 'and over it the control sits beside its words');
		assert.equal(await at('20rem'), 'column', 'and back, because it is a query and not a class');

		// A field with no group above it has no container to measure, and a query with no container
		// answers false, so it stays a column however wide the page is.
		const alone = await view.evaluate(() => {
			const field = document.querySelector('#lone')!;
			return {
				direction: getComputedStyle(field)['flexDirection'] ?? '',
				width: Math.round(field.getBoundingClientRect().width),
			};
		});
		assert.ok(alone.width > 448, `the page is wider than 28rem: ${String(alone.width)}px`);
		assert.equal(alone.direction, 'column', 'and it is still a column, because nothing is a container');
	});
});

test('a fieldset\'s legend sits above its fields, and the box itself draws nothing', async () => {
	await drive('field-set', `
		import { TextField, h, mount } from '@aweftjs/ui';
		mount(document.body, <div theme="field_group">
			<fieldset id="set" theme="field_set">
				<legend theme="field_legend">Billing address</legend>
				<div id="street" theme="field"><TextField id="line" aria-label="Street" /></div>
			</fieldset>
		</div>);
	`, async (view) => {
		await view.waitForSelector('#line');
		const seen = await view.evaluate(() => {
			const box = document.querySelector('#set')!;
			const style = getComputedStyle(box);
			const legend = box.querySelector('legend')!.getBoundingClientRect();
			const field = document.querySelector('#street')!.getBoundingClientRect();
			return {
				above: legend.bottom <= field.top,
				gap: Math.round(field.top - legend.bottom),
				border: `${style['borderTopWidth'] ?? ''} ${style['borderTopStyle'] ?? ''}`,
				padding: style['padding'],
				minWidth: style['minWidth'],
				direction: style['flexDirection'],
			};
		});

		assert.equal(seen.above, true, 'the legend names what is under it');
		assert.ok(seen.gap >= 8, `$space2 or more between the two: ${String(seen.gap)}px`);
		assert.equal(seen.border, '0px none', 'the host\'s own frame is off');
		assert.equal(seen.padding, '0px');
		assert.equal(seen.minWidth, '0px', 'so it shrinks inside a column');
		assert.equal(seen.direction, 'column');
	});
});

// --- the display and grouping pieces (designs 199, 200) -----------------------------------------

test('a text field with an addon rings the box on a real Tab, and the input rings nothing', async () => {
	// Designs 200, 210. The two elements read as one control, so the halo the root rule gives every
	// themed element is turned off on the input and drawn on the box through `:has(:focus-visible)`.
	await drive('input-group-ring', `
		import { TextField, h, mount } from '@aweftjs/ui';
		mount(document.body, <TextField id="amount" label="Price" leading="$" trailing="CAD" />);
	`, async (view) => {
		await view.waitForSelector('#amount');
		const before = await view.evaluate(() =>
			getComputedStyle(document.querySelector('#amount')!.parentElement!)['boxShadow']);

		await view.keyboard.press('Tab');
		await view.waitForFunction(() =>
			getComputedStyle(document.querySelector('#amount')!.parentElement!)['borderTopColor']
				=== 'rgb(90, 97, 110)');

		const seen = await view.evaluate(() => {
			const input = document.querySelector('#amount')!;
			const box = input.parentElement!;
			const outer = getComputedStyle(box);
			const inner = getComputedStyle(input);
			return {
				focused: document.activeElement?.id ?? '',
				border: outer['borderTopColor'],
				shadow: outer['boxShadow'],
				height: Math.round(box.getBoundingClientRect().height),
				innerShadow: inner['boxShadow'],
				innerBorder: inner['borderTopStyle'],
				innerOutline: inner['outlineStyle'],
			};
		});
		assert.equal(seen.focused, 'amount', 'the Tab landed in the input');
		assert.equal(seen.border, 'rgb(90, 97, 110)', '$ring, which is $neutral8');
		assert.match(seen.shadow ?? '', /0px 0px 0px 3px/, 'and the box wears the halo, at $ringWidth');
		assert.notEqual(seen.shadow, before, 'which it did not before the Tab');
		assert.equal(seen.height, 36, 'the box is $control tall, so it is the control');
		assert.equal(seen.innerShadow, 'none', 'the input inside shows no halo of its own');
		assert.equal(seen.innerBorder, 'none', 'no border');
		assert.equal(seen.innerOutline, 'none', 'and no outline');
	});
});

test('a themed element given hidden computes display none', async () => {
	// Design 207. Measured before the fix on the catalogue: a themed button given `hidden` computed
	// `display: flex` and an unthemed one computed `none`, because the host's `[hidden]` rule is
	// unlayered and every entry's `display` is inside `@layer aweft`.
	await drive('hidden-rule', `
		import { Button, h, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<Button id="gone" label="Gone" hidden={true} />
			<Button id="here" label="Here" />
			<button id="plain" hidden>Plain</button>
		</div>);
	`, async (view) => {
		await view.waitForSelector('#here');
		const seen = await view.evaluate(() => ({
			themed: getComputedStyle(document.querySelector('#gone')!)['display'],
			showing: getComputedStyle(document.querySelector('#here')!)['display'],
			plain: getComputedStyle(document.querySelector('#plain')!)['display'],
			laidOut: Math.round(document.querySelector('#gone')!.getBoundingClientRect().width),
		}));
		assert.equal(seen.themed, 'none', 'a themed element honours the attribute');
		assert.equal(seen.plain, 'none', 'the same as an unthemed one always did');
		assert.equal(seen.showing, 'inline-flex', 'and one without the attribute is laid out');
		assert.equal(seen.laidOut, 0, 'so the hidden one takes no room');
	});
});

test('a success alert reaches its contrast in both modes', async () => {
	// Design 216. The ratios are in that note, measured with this package's own `contrastRatio` and
	// asserted in `contrast.test.ts`; what only a browser can say is that the two roles are what
	// the element actually computes, in each mode.
	await drive('success-tone', `
		import { Alert, Theme, dark, h, light, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<Theme value={light}><Alert id="pale" type="success" title="Saved" /></Theme>
			<Theme value={dark}><Alert id="deep" type="success" title="Saved" /></Theme>
		</div>);
	`, async (view) => {
		await view.waitForSelector('#pale');
		const seen = await view.evaluate(() => {
			const read = (id: string) => {
				const style = getComputedStyle(document.querySelector(`#${id}`)!);
				return { ink: style['color'], paper: style['backgroundColor'], edge: style['borderTopColor'] };
			};
			return { light: read('pale'), dark: read('deep') };
		});
		// $success11 and $success3 in light, and the same two roles in dark.
		assert.deepEqual(seen.light, {
			ink: 'rgb(4, 89, 58)', paper: 'rgb(216, 244, 226)', edge: 'rgb(13, 122, 76)',
		});
		assert.deepEqual(seen.dark, {
			ink: 'rgb(98, 215, 155)', paper: 'rgb(18, 43, 31)', edge: 'rgb(53, 168, 112)',
		});
	});
});

test('an avatar sized by a length is that size, and its letters come off the box', async () => {
	// Design 215. The letters are `40cqw` of the avatar, which is a container, so only a browser
	// can say what font size that resolves to at each box size.
	await drive('avatar-length', `
		import { Avatar, h, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<Avatar id="big" fallback="AB" size="120px" />
			<Avatar id="normal" fallback="AB" />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#big');
		const seen = await view.evaluate(() => {
			const read = (id: string) => {
				const box = document.querySelector(`#${id}`)!;
				const letters = box.querySelector('span')!;
				return {
					side: Math.round(box.getBoundingClientRect().height),
					font: getComputedStyle(letters)['fontSize'],
				};
			};
			return { big: read('big'), normal: read('normal') };
		});
		assert.equal(seen.big.side, 120, 'the length is the box');
		assert.equal(seen.big.font, '48px', '40% of 120');
		assert.equal(seen.normal.side, 36, '$control for one with no size');
		assert.equal(seen.normal.font, '14.4px', 'and 40% of 36');
	});
});

test('an avatar swaps its letters for a picture that really loads', async () => {
	// Design 199. The light tree can dispatch `load`; only a browser fires it, and only a browser
	// says what the two children measure once one of them carries `hidden`.
	await drive('avatar-load', `
		import { Avatar, h, mount } from '@aweftjs/ui';
		const pixel = 'data:image/png;base64,'
			+ 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
		mount(document.body, <div>
			<Avatar id="loaded" src={pixel} alt="a pixel" fallback="TL" />
			<Avatar id="broken" src="data:image/png;base64,AAAA" alt="missing" fallback="AB" size="sm" />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#loaded');
		await view.waitForFunction(() =>
			!document.querySelector('#loaded img')!.hasAttribute('hidden'));

		const seen = await view.evaluate(() => {
			const read = (id: string) => {
				const box = document.querySelector(`#${id}`)!;
				const image = box.querySelector('img')!;
				const fallback = box.querySelector('span')!;
				return {
					side: Math.round(box.getBoundingClientRect().height),
					image: Math.round(image.getBoundingClientRect().height),
					letters: fallback.getBoundingClientRect().height,
					hidden: fallback.hasAttribute('hidden'),
				};
			};
			return { loaded: read('loaded'), broken: read('broken') };
		});

		assert.equal(seen.loaded.side, 36, 'the avatar is $control square');
		assert.equal(seen.loaded.image, 36, 'and the picture covers it');
		assert.equal(seen.loaded.letters, 0, 'the letters take no room');
		assert.equal(seen.loaded.hidden, true, 'and are out of the accessibility tree');

		// The other one asked for four bytes that are not a PNG, so the decode fails, `error` fires,
		// and it never leaves its letters.
		await view.waitForFunction(() =>
			document.querySelector('#broken img')!.hasAttribute('hidden'));
		const failed = await view.evaluate(() => {
			const box = document.querySelector('#broken')!;
			return {
				side: Math.round(box.getBoundingClientRect().height),
				letters: Math.round(box.querySelector('span')!.getBoundingClientRect().height),
				image: box.querySelector('img')!.getBoundingClientRect().height,
			};
		});
		assert.equal(failed.side, 32, '$controlSm');
		assert.equal(failed.letters, 32, 'the letters fill it');
		assert.equal(failed.image, 0, 'and the picture that failed takes no room');
	});
});

test('a progress at half is half a track', async () => {
	// Design 199: the bar is a vendor pseudo-element, so what a page can be asked is the position
	// the platform computed from the value and the max.
	await drive('progress-and-group', `
		import { Progress, h, mount } from '@aweftjs/ui';
		mount(document.body, <div>
			<Progress id="bar" value={0.5} label="Uploading" />
			<Progress id="waiting" label="Working" />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#bar');
		const bar = await view.evaluate(() => {
			// `value`, `max` and `position` are the progress element's own properties, which the
			// narrow element shape this project compiles against does not name.
			const read = (id: string) =>
				document.querySelector(`#${id}`) as unknown as { value: number; max: number; position: number };
			const known = read('bar');
			return {
				max: known.max,
				value: known.value,
				position: known.position,
				height: getComputedStyle(document.querySelector('#bar')!)['height'],
				appearance: getComputedStyle(document.querySelector('#bar')!)['appearance'],
				indeterminate: read('waiting').position,
			};
		});
		assert.equal(bar.max, 1, 'the element is a fraction of one, so nothing divides');
		assert.equal(bar.value, 0.5);
		assert.equal(bar.position, 0.5, 'so the bar is half the track');
		assert.equal(bar.height, '8px', '$space2 thick');
		assert.equal(bar.appearance, 'none', 'the host is not drawing its own');
		assert.equal(bar.indeterminate, -1,
			'and one with no value attribute is indeterminate, which the platform reports as -1');
	});
});

test('a table wider than its box scrolls inside it, and the page does not', async () => {
	// Design 201. Only a browser lays a table out, so only a browser can be asked whether the
	// overflow stayed in the wrapper.
	await drive('table-scroll', `
		import { Table, h, mount } from '@aweftjs/ui';
		const rows = [
			{ a: 'one', b: 'two', c: 'three', d: 'four', e: 'five' },
			{ a: 'six', b: 'seven', c: 'eight', d: 'nine', e: 'ten' },
		];
		mount(document.body, <div style={{ width: '200px' }}>
			<Table
				id="wide"
				columns={[
					{ key: 'a', label: 'A rather long heading' },
					{ key: 'b', label: 'Another long heading' },
					{ key: 'c', label: 'A third long heading' },
					{ key: 'd', label: 'A fourth long heading' },
					{ key: 'e', label: 'A fifth long heading', align: 'right' },
				]}
				rows={rows}
				caption="Five columns in a narrow box"
				striped={true}
			/>
		</div>);
	`, async (view) => {
		await view.waitForSelector('#wide');

		const seen = await view.evaluate(() => {
			const table = document.querySelector('#wide')!;
			const scroll = table.parentElement!;
			const rows = Array.from(table.querySelectorAll('tbody tr'));
			return {
				scrolls: scroll.scrollWidth > scroll.clientWidth,
				box: Math.round(scroll.getBoundingClientRect().width),
				focusable: scroll.getAttribute('tabindex'),
				overflow: getComputedStyle(scroll).overflowX,
				pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
				collapse: getComputedStyle(table).borderCollapse,
				rows: rows.length,
				striped: getComputedStyle(rows[1]!).backgroundColor,
				plain: getComputedStyle(rows[0]!).backgroundColor,
				aligned: getComputedStyle(table.querySelectorAll('tbody td')[4]!).textAlign,
			};
		});

		assert.equal(seen.overflow, 'auto');
		assert.ok(seen.scrolls, 'the table is wider than the box it is in');
		assert.equal(seen.box, 200, 'and the box is the width the page gave it');
		assert.equal(seen.focusable, '0', 'so a keyboard can reach the scroll');
		assert.ok(!seen.pageScrolls, 'and the page itself did not widen');
		assert.equal(seen.collapse, 'collapse');
		assert.equal(seen.rows, 2);
		assert.notEqual(seen.striped, seen.plain, 'every second body row is tinted');
		assert.equal(seen.plain, 'rgba(0, 0, 0, 0)', 'and the first one is not');
		assert.equal(seen.aligned, 'right', 'a column lines its cells up the way it said');

		// The scroll really moves, which is the whole point of the box.
		const moved = await view.evaluate(() => {
			const scroll = document.querySelector('#wide')!.parentElement!;
			scroll.scrollLeft = 40;
			return scroll.scrollLeft;
		});
		assert.ok(moved > 0, `the box scrolled sideways: ${String(moved)}px`);
	});
});

test('a breadcrumb link inside a routed page moves the router and reloads nothing', async () => {
	// Design 201: the component writes no click handler, so what makes this work is that the anchor
	// is plain and `links(root)` takes it. Only a browser has anchors, clicks and a history.
	await drive('breadcrumb-route', `
		import { mutable } from '@aweftjs/core';
		import { createRouter } from '@aweftjs/dom/router';
		import { Breadcrumb, h, mount } from '@aweftjs/ui';

		const router = createRouter({});
		window.loads = (window.loads ?? 0) + 1;
		const url = mutable(router.url.get());
		router.url.effect((now) => { url.set(String(now)); });

		mount(document.body, <div>
			<Breadcrumb items={[
				{ label: 'Home', href: '/' },
				{ label: 'Files', href: '/files' },
				{ label: 'shot.png' },
			]} />
			<p id="url">{url}</p>
		</div>);
		router.links(document.body);
	`, async (view) => {
		await view.waitForSelector('#url');
		assert.equal(await view.evaluate(() => (window as unknown as { loads: number }).loads), 1);

		const anchors = await view.evaluate(() =>
			Array.from(document.querySelectorAll('nav a')).map((node) => node.getAttribute('href')));
		assert.deepEqual(anchors, ['/', '/files'], 'two links and no third');

		await view.click('nav a[href="/files"]');
		await view.waitForFunction(() => document.querySelector('#url')!.textContent === '/files');
		assert.equal(await view.evaluate(() => location.pathname), '/files',
			'the address bar moved');
		assert.equal(await view.evaluate(() => (window as unknown as { loads: number }).loads), 1,
			'and the page was never loaded a second time');
	});
});

test('a sheet starts off its edge and settles against it', async () => {
	// Design 202. The class comes off a themed probe and is worn by a real <dialog>, because the
	// element has to be a <dialog> for the top layer and `[open]` to mean anything: the same shape
	// the dialog motion test uses.
	await drive('sheet-motion', `
		import { h, mount } from '@aweftjs/ui';
		import { dialogControl } from '@aweftjs/ui/dialog';
		mount(document.body, <div id="probe" theme={['dialog', 'sheet', 'right']} />);
		const panel = document.createElement('dialog');
		panel.id = 'panel';
		panel.className = document.querySelector('#probe').className;
		panel.innerHTML = '<p>hello</p>';
		document.body.appendChild(panel);
		window.modal = dialogControl(panel, {});
	`, async (view) => {
		await view.waitForFunction(() => document.querySelector('#panel') !== null);

		const seen = await view.evaluate(async () => {
			const panel = document.querySelector('#panel')!;
			(window as unknown as { modal: { open(): void } }).modal.open();
			const first = getComputedStyle(panel).transform;
			await new Promise((go) => setTimeout(go, 300));
			const box = panel.getBoundingClientRect();
			return {
				first,
				settled: getComputedStyle(panel).transform,
				width: Math.round(box.width),
				height: Math.round(box.height),
				right: Math.round(window.innerWidth - box.right),
				viewport: window.innerHeight,
				radius: getComputedStyle(panel).borderTopRightRadius,
				leftEdge: getComputedStyle(panel).borderLeftWidth,
			};
		});

		// A matrix, because the host reports the computed transform rather than what was written.
		// 24rem at the default 16px root is 384px, which is what the first frame is offset by.
		assert.equal(seen.first, 'matrix(1, 0, 0, 1, 384, 0)',
			'the first frame is the sheet\'s own width off the right edge');
		assert.equal(seen.settled, 'none', 'and it settles in place');
		assert.equal(seen.width, 384, '$sheetWidth');
		assert.equal(seen.height, seen.viewport, 'and it is as tall as the viewport');
		assert.equal(seen.right, 0, 'against the right edge, with the margin holding it there');
		assert.equal(seen.radius, '0px', 'the outer corner is square');
		assert.equal(seen.leftEdge, '1px', 'and the one border is the inner edge');
	});
});

test('a strip of tabs is one tab stop, and the arrows move the selection inside it', async () => {
	// Design 203. The claim a fake DOM cannot answer is the Tab order: the second Tab press has to
	// leave the strip for the panel rather than walk to the next tab.
	await drive('tabs-keys', `
		import { mutable } from '@aweftjs/core';
		import { Tabs, h, mount } from '@aweftjs/ui';
		const view = mutable('all');
		globalThis.read = () => view.get();
		mount(document.body, <div>
			<button id="before">before</button>
			<Tabs id="strip" label="Views" value={view} tabs={[
				{ value: 'all', label: 'All', content: 'everything' },
				{ value: 'mine', label: 'Mine', content: 'the ones I own' },
				{ value: 'gone', label: 'Deleted', disabled: true, content: 'the bin' },
			]} />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#strip');
		const held = (): Promise<string> =>
			view.evaluate(() => (globalThis as never as { read(): string }).read());

		// Two Tab presses from the button before it: the first lands on the tab showing, the second
		// leaves the strip for that tab's panel.
		await view.focus('#before');
		await view.keyboard.press('Tab');
		const first = await view.evaluate(() => ({
			role: document.activeElement!.getAttribute('role'),
			text: document.activeElement!.textContent,
		}));
		assert.deepEqual(first, { role: 'tab', text: 'All' }, 'Tab lands on the tab showing');

		await view.keyboard.press('Tab');
		const second = await view.evaluate(() => ({
			role: document.activeElement!.getAttribute('role'),
			named: document.activeElement!.getAttribute('aria-labelledby'),
		}));
		assert.equal(second.role, 'tabpanel',
			'the second Tab leaves the strip for the panel, not for the next tab');
		assert.notEqual(second.named, null, 'and that panel is the one its tab names');

		// Back into the strip, and the arrows move the focus and the selection together.
		await view.keyboard.down('Shift');
		await view.keyboard.press('Tab');
		await view.keyboard.up('Shift');
		await view.keyboard.press('ArrowRight');
		await view.waitForFunction(() => (globalThis as never as { read(): string }).read() === 'mine');
		assert.equal(await view.evaluate(() => document.activeElement!.textContent), 'Mine');
		const roving = await view.evaluate(() =>
			Array.from(document.querySelectorAll('#strip [role="tab"]'))
				.map((node) => node.getAttribute('tabindex')).join(' '));
		assert.equal(roving, '-1 0 -1', 'the one tab stop moved with the selection');

		// Wrapping past the disabled last tab, then the two end keys.
		await view.keyboard.press('ArrowRight');
		await view.waitForFunction(() => (globalThis as never as { read(): string }).read() === 'all',
			{ timeout: 5000 });
		assert.equal(await view.evaluate(() => document.activeElement!.textContent), 'All',
			'the disabled tab is stepped over and the strip wraps to the first');

		await view.keyboard.press('End');
		assert.equal(await held(), 'mine', 'End is the last tab that can be chosen');
		await view.keyboard.press('Home');
		assert.equal(await held(), 'all');

		// A panel that is not showing is hidden by the attribute, so nothing in it is reachable.
		const reachable = await view.evaluate(() =>
			Array.from(document.querySelectorAll('#strip [role="tabpanel"]'))
				.map((node) => node.offsetHeight > 0));
		assert.deepEqual(reachable, [true, false, false]);
	});
});

test('an underlined tab draws a $ringWidth rail in $accent and no fill at all', async () => {
	// Design 203's two types, measured: the default lifts the tab showing onto the page's own
	// ground, and `line` drops the strip for a rail under it.
	await drive('tabs-types', `
		import { Tabs, h, mount } from '@aweftjs/ui';
		const items = [
			{ value: 'one', label: 'One', content: 'the first' },
			{ value: 'two', label: 'Two', content: 'the second' },
		];
		mount(document.body, <div>
			<Tabs id="filled" label="Filled" tabs={items} />
			<Tabs id="ruled" label="Ruled" type="line" tabs={items} />
		</div>);
	`, async (view) => {
		await view.waitForSelector('#ruled');

		const seen = await view.evaluate(() => {
			const read = (id: string): Record<string, string> => {
				const tabs = Array.from(document.querySelectorAll(`#${id} [role="tab"]`));
				const chosen = tabs[0]!;
				const other = tabs[1]!;
				const list = document.querySelector(`#${id} [role="tablist"]`)!;
				return {
					fill: getComputedStyle(chosen).backgroundColor ?? '',
					rail: getComputedStyle(chosen).borderBottomWidth ?? '',
					colour: getComputedStyle(chosen).borderBottomColor ?? '',
					quiet: getComputedStyle(other).borderBottomColor ?? '',
					strip: getComputedStyle(list).backgroundColor ?? '',
					height: String(Math.round(chosen.getBoundingClientRect().height)),
				};
			};
			return { filled: read('filled'), ruled: read('ruled') };
		});

		// The default: a filled strip with the tab showing lifted onto the page's own ground.
		assert.equal(seen.filled.strip, 'rgb(237, 239, 243)', '$muted, the third neutral step');
		assert.equal(seen.filled.fill, 'rgb(252, 252, 253)', '$background, which is what lifts it');
		assert.equal(seen.filled.rail, '1px', 'the plain tab keeps its own transparent border');
		assert.equal(seen.filled.height, '36', '$control');

		// The line type: no strip, no fill, and a 3px rail in the accent under the one showing.
		assert.equal(seen.ruled.strip, 'rgba(0, 0, 0, 0)', 'no strip to fill');
		assert.equal(seen.ruled.fill, 'rgba(0, 0, 0, 0)', 'and no fill behind the tab showing');
		assert.equal(seen.ruled.rail, '3px', '$ringWidth');
		assert.equal(seen.ruled.colour, 'rgb(28, 32, 39)', '$accent, the foreground of this theme');
		assert.equal(seen.ruled.quiet, 'rgba(0, 0, 0, 0)', 'and the tab beside it draws none');
	});
});

test('a hovered button transitions at the duration and the curve the theme says', async () => {
	// Design 217. The expected values are that note's, not `motion.ts` read back: `$fast` is 150ms
	// and `$ease` is the curve below.
	await drive('motion-tokens', `
		import { Button, h, mount } from '@aweftjs/ui';
		mount(document.body, <Button id="save" label="Save" />);
	`, async (view) => {
		await view.waitForSelector('#save');
		const paint = async (): Promise<Record<string, string>> => view.evaluate(() => {
			const style = getComputedStyle(document.querySelector('#save')!);
			return {
				duration: style.transitionDuration ?? '',
				curve: style.transitionTimingFunction ?? '',
				property: style.transitionProperty ?? '',
				image: style.backgroundImage ?? '',
			};
		});

		const quiet = await paint();
		await view.hover('#save');
		const hovered = await paint();
		assert.notEqual(hovered.image, quiet.image, 'the pointer is really on it');

		assert.equal(hovered.duration, '0.15s', '$fast');
		assert.equal(hovered.curve, 'cubic-bezier(0.4, 0, 0.2, 1)', '$ease');
		assert.equal(hovered.property,
			'background-color, background-image, border-color, color, transform',
			'the whole list, with transform on it and box-shadow off it (design 217)');

		await view.emulateMedia({ reducedMotion: 'reduce' });
		const still = await paint();
		assert.equal(still.duration, '0s', 'and nothing at all when the person asked for less');
	});
});

test('the toggle\'s thumb transitions its travel', async () => {
	// The thumb is `::before` and it moves with `left`. The root rule is written against the
	// element and names neither, so before design 217 the thumb jumped: the host's own default is
	// `all` at `0s`, which is what this used to read.
	await drive('toggle-motion', `
		import { Toggle, h, mount } from '@aweftjs/ui';
		mount(document.body, <Toggle id="switch" label="Notify me" />);
	`, async (view) => {
		await view.waitForSelector('#switch');
		const thumb = async (): Promise<Record<string, string>> => view.evaluate(() => {
			const style = getComputedStyle(document.querySelector('#switch')!, '::before');
			return {
				property: style.transitionProperty ?? '',
				duration: style.transitionDuration ?? '',
				curve: style.transitionTimingFunction ?? '',
				left: style.left ?? '',
			};
		});

		const resting = await thumb();
		assert.equal(resting.property, 'left', 'the travel, and nothing else');
		assert.equal(resting.duration, '0.15s');
		assert.equal(resting.curve, 'cubic-bezier(0.4, 0, 0.2, 1)');
		assert.equal(resting.left, '4px', '$space in from the edge of the pill');

		// It really is the travel that moves: ticking the box takes the thumb to the far end, which
		// is the pill less the thumb and its two margins.
		await view.click('#switch');
		await view.waitForFunction(() =>
			getComputedStyle(document.querySelector('#switch')!, '::before').left !== '4px');
		const travelled = await thumb();
		assert.ok(Number.parseFloat(travelled.left!) > 4,
			`the thumb crossed the pill: ${String(travelled.left)}`);

		await view.emulateMedia({ reducedMotion: 'reduce' });
		assert.equal((await thumb()).duration, '0s', 'and it jumps for a person who asked it to');
	});
});

test('the pulse and the wave run at the durations they say', async () => {
	// Design 218. Both were one 240ms block before, which is four cycles a second on a full-width
	// grey box and three dots offset by half a cycle and a whole one.
	await drive('pulse-motion', `
		import { LoadingDots, Skeleton, h, mount } from '@aweftjs/ui';
		mount(document.body, <div><Skeleton id="box" /><LoadingDots id="dots" /></div>);
	`, async (view) => {
		await view.waitForSelector('#box');
		const read = async (): Promise<Record<string, string[]>> => view.evaluate(() => {
			const of = (element: RecipeElement): string[] => {
				const style = getComputedStyle(element);
				return [
					style.animationName ?? '',
					style.animationDuration ?? '',
					style.animationTimingFunction ?? '',
					style.animationDelay ?? '',
				];
			};
			const dots = Array.from(document.querySelectorAll('#dots > span'));
			return {
				box: of(document.querySelector('#box')!),
				one: of(dots[0]!),
				two: of(dots[1]!),
				three: of(dots[2]!),
			};
		});

		const moving = await read();
		assert.match(moving.box![0]!, /^pulse-/, 'the skeleton is on its own block');
		assert.equal(moving.box![1], '2s', 'a skeleton breathes over two seconds');
		assert.equal(moving.box![2], 'ease-in-out', 'and turns around at both ends');

		assert.match(moving.one![0]!, /^wave-/, 'and the dots are on theirs');
		assert.equal(moving.one![1], '1s', 'a dot takes one second');
		assert.equal(moving.one![3], '0s', 'the first waits for nothing');
		// A third of the cycle each, worked out by the browser from the one named cycle.
		assert.ok(Math.abs(Number.parseFloat(moving.two![3]!) - 1 / 3) < 0.01,
			`the second is a third of a cycle behind: ${String(moving.two![3])}`);
		assert.ok(Math.abs(Number.parseFloat(moving.three![3]!) - 2 / 3) < 0.01,
			`and the third is two thirds: ${String(moving.three![3])}`);

		await view.emulateMedia({ reducedMotion: 'reduce' });
		const still = await read();
		for (const [where, values] of Object.entries(still)) {
			assert.equal(values[0], 'none', `${where} is still for a person who asked for less motion`);
		}
	});
});

test('the slider\'s hover is on its thumb and not over its own box', async () => {
	// Design 220. Before it, `hovered` painted the root tint over the whole 36px input, which is a
	// rectangle the width of the row around a 16px circle.
	await drive('slider-hover', `
		import { Slider, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		mount(document.body, <Slider id="volume" value={mutable(50)} />);
	`, async (view) => {
		await view.waitForSelector('#volume');
		const paint = async (): Promise<Record<string, string>> => view.evaluate(() => {
			const style = getComputedStyle(document.querySelector('#volume')!);
			return {
				image: style.backgroundImage ?? '',
				left: style.paddingLeft ?? '',
				right: style.paddingRight ?? '',
				box: style.boxSizing ?? '',
			};
		});

		const resting = await paint();
		assert.equal(resting.image, 'none', 'nothing is painted over the control at rest');
		assert.equal(resting.left, '4px', '$space of room for the thumb at the near end');
		assert.equal(resting.right, '4px', 'and at the far one');
		assert.equal(resting.box, 'border-box', 'so the room stays inside the width the row gave it');

		// A band four pixels tall immediately above the resting thumb. Chromium reports no computed
		// style of its own for `::-webkit-slider-thumb`, so what the thumb does is read off the
		// pixels: blank at rest, painted once the thumb has grown into it.
		const box = (await view.locator('#volume').boundingBox())!;
		const band = {
			x: Math.round(box.x + box.width / 2) - 12,
			y: Math.round(box.y + box.height / 2) - 12,
			width: 24,
			height: 4,
		};
		const before = await view.screenshot({ clip: band });

		// The theme generates one class per chain, so the hovered chain is a different class on the
		// same element. This waits for that swap and then for the scale to finish travelling,
		// rather than reading the frame in between.
		const plain = await view.evaluate(() =>
			document.querySelector('#volume')!.getAttribute('class') ?? '');
		await view.hover('#volume');
		await view.waitForFunction((was: string) =>
			document.querySelector('#volume')!.getAttribute('class') !== was, plain);
		await view.waitForTimeout(400);

		const hovered = await paint();
		assert.equal(hovered.image, 'none',
			'the root tint is off: the state is on the thumb and the track, not over the box');
		const after = await view.screenshot({ clip: band });
		assert.ok(!before.equals(after), 'and the thumb really did grow into the room above it');
	});
});

test('a country field hydrates: the dialog comes across empty and fills on the first open', async () => {
	const site = await page('country-hydration', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { mutable } from '@aweftjs/core';
		import { Countries, Country, Icons, context, h, hydrate, render } from '@aweftjs/ui';
		import { countryData } from '@aweftjs/ui/countries';

		const data = await countryData();
		const code = mutable('GB');
		const pack = { prefix: 'x', icons: { x: { body: '<path d="M0 0h16v16H0z"/>' } }, width: 16, height: 16 };
		const App = () => (
			<Icons value={() => pack.icons.x}>
				<Countries value={data}>
					<Country id="country" label="Country" value={code} name="country" suggest={false} locale="en" />
				</Countries>
			</Icons>
		);

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

		const before = document.querySelector('#country');
		const dialog = document.querySelector('#country-dialog');
		hydrate(host, <App />);

		const rows = () => document.querySelectorAll('#country-dialog [role="option"]').length;
		const closed = rows();
		document.querySelector('#country').click();

		window.result = {
			sameButton: before === document.querySelector('#country'),
			sameDialog: dialog === document.querySelector('#country-dialog'),
			dialogInMarkup: markup.includes('<dialog'),
			rowsInMarkup: (markup.match(/role="option"/g) ?? []).length,
			optionsInMarkup: (markup.match(/<option/g) ?? []).length,
			label: document.querySelector('#country').textContent,
			posted: document.querySelector('select[name="country"]').value,
			closed,
			opened: rows(),
		};
	`);

	const browser = await chromium.launch();
	const problems: string[] = [];
	try {
		const view = await browser.newPage();
		view.on('pageerror', (error) => problems.push(error.message));
		await view.goto(site.url);
		await view.waitForFunction(() => (window as unknown as { result?: unknown }).result !== undefined)
			.catch(() => { throw new Error(`the page never finished: ${problems.join('; ')}`); });
		const result = await view.evaluate(() => (window as unknown as { result: Record<string, unknown> }).result);

		assert.deepEqual(problems, [], 'the page threw nothing');
		assert.equal(result['sameButton'], true, 'the server\'s button was adopted, not replaced');
		assert.equal(result['sameDialog'], true, 'and so was the dialog, which is in the markup closed');
		assert.equal(result['dialogInMarkup'], true, 'a static render emits the control and its dialog');
		assert.equal(result['rowsInMarkup'], 0, 'and none of the grid, which nobody can read closed');
		assert.equal(result['closed'], 0, 'so the browser adopts a page with no rows in it either');
		assert.equal(result['opened'], 249, 'and the first open is what draws them');
		assert.equal(result['optionsInMarkup'], 250,
			'while the element a form posts is whole in the markup: 249 and the blank one');
		assert.match(String(result['label']), /United Kingdom/, 'the button reads as the chosen country');
		assert.equal(result['posted'], 'GB', 'and what a form posts is the code');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('a country name the server and the browser disagree about refuses the hydration by name', async () => {
	// The two ends resolve a code through two ICU builds, and a host whose data is newer has a
	// different name for it (design 251). Nothing here can give a browser an older ICU, so the
	// disagreement is made by editing the markup: what is being pinned is what hydration does with
	// a difference, not how the difference arose.
	const site = await page('country-skew', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { mutable } from '@aweftjs/core';
		import { Countries, Country, Icons, context, h, hydrate, render } from '@aweftjs/ui';
		import { countryData } from '@aweftjs/ui/countries';

		const data = await countryData();
		const code = mutable('GB');
		const pack = { prefix: 'x', icons: { x: { body: '<path d="M0 0h16v16H0z"/>' } }, width: 16, height: 16 };
		const App = () => (
			<Icons value={() => pack.icons.x}>
				<Countries value={data}>
					<Country id="country" label="Country" value={code} name="country" suggest={false} locale="en" />
				</Countries>
			</Icons>
		);

		const server = context();
		const markup = await render(<App />, { context: server });
		const host = document.createElement('div');
		// The server's ICU, one release behind: it wrote a name this browser no longer uses.
		host.innerHTML = markup.split('United Kingdom').join('Great Britain');
		document.body.appendChild(host);

		try {
			hydrate(host, <App />);
			window.result = { refused: null };
		} catch (error) {
			window.result = { refused: String(error.message ?? error) };
		}
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForFunction(() => (window as unknown as { result?: unknown }).result !== undefined);
		const result = await view.evaluate(() => (window as unknown as { result: Record<string, unknown> }).result);

		const refused = String(result['refused']);
		assert.match(refused, /hydration text mismatch/,
			'the mismatch is refused rather than left on the screen');
		assert.match(refused, /Great Britain/, 'and the message names what the server wrote');
		assert.match(refused, /United Kingdom/, 'and what the browser would have written');
	} finally {
		await browser.close();
		await site.close();
	}
});

test('the longest subdivision list opens and searches inside one frame budget', async () => {
	const site = await page('country-cost', '<!doctype html><html><head></head><body><script type="module" src="./entry.tsx"></script></body></html>', `
		import { mutable } from '@aweftjs/core';
		import { Countries, Icons, Region, h, mount } from '@aweftjs/ui';
		import { countryData } from '@aweftjs/ui/countries';

		const data = await countryData();
		const pack = { prefix: 'x', icons: { x: { body: '<path d="M0 0h16v16H0z"/>' } }, width: 16, height: 16 };
		const open = mutable(false);
		const query = mutable('');

		mount(document.body, (
			<Icons value={() => pack.icons.x}>
				<Countries value={data}>
					<Region id="region" label="Region" country="GB" open={open} />
				</Countries>
			</Icons>
		));

		const rows = () => document.querySelectorAll('#region-dialog [role="option"]').length;
		window.measure = () => {
			const started = performance.now();
			document.querySelector('#region').click();
			const opened = performance.now() - started;

			const box = document.querySelector('#region-search');
			const typed = performance.now();
			box.value = 'aberdeen';
			box.dispatchEvent(new Event('input', { bubbles: true }));
			const searched = performance.now() - typed;

			return { opened, searched, rows: rows() };
		};
		window.ready = true;
	`);

	const browser = await chromium.launch();
	try {
		const view = await browser.newPage();
		await view.goto(site.url);
		await view.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
		const held = await view.evaluate(() =>
			(window as unknown as { measure(): { opened: number; searched: number; rows: number } }).measure());

		// 217 rows is the longest subdivision list the data has. What matters is that opening and
		// filtering it are both work a person does not wait for, not the exact number.
		assert.ok(held.rows < 5, `the search cut 217 rows to ${String(held.rows)}`);
		assert.ok(held.opened < 250, `opening the grid took ${held.opened.toFixed(1)}ms`);
		assert.ok(held.searched < 250, `and filtering it took ${held.searched.toFixed(1)}ms`);
		console.log(`country: 217 rows open in ${held.opened.toFixed(1)}ms, filter in ${held.searched.toFixed(1)}ms`);
	} finally {
		await browser.close();
		await site.close();
	}
});
