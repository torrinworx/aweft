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
				// one reaches its file by name. Before the package, because an alias matches a
				// subpath under its own key.
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

test('a real change on a select hands the caller back the object it put in the list', async () => {
	await drive('select-change', `
		import { Select, h, mount } from '@aweftjs/ui';
		import { mutable } from '@aweftjs/core';
		const users = [{ id: 7, name: 'Ada' }, { id: 9, name: 'Grace' }];
		const chosen = mutable(null);
		globalThis.read = () => chosen.get();
		globalThis.pick = (at) => chosen.set(users[at]);
		mount(document.body, (
			<Select id="user" label="Owner" value={chosen} options={users}
				display={(user) => user.name} placeholder="Pick someone" />
		));
	`, async (view) => {
		await view.waitForSelector('#user');
		assert.deepEqual(await view.evaluate(() => (globalThis as never as { read(): unknown }).read()), null);

		await view.selectOption('#user', { label: 'Grace' });
		assert.deepEqual(
			await view.evaluate(() => (globalThis as never as { read(): unknown }).read()),
			{ id: 9, name: 'Grace' },
			'the cell holds the object, not the string the element carried',
		);

		// And the other direction, which only a real select can answer: the cell moves what the
		// element shows, through the row that says it is the chosen one.
		const shown = await view.evaluate(() => {
			(globalThis as never as { pick(at: number): void }).pick(0);
			const element = document.querySelector('#user') as never as { selectedIndex: number; value: string };
			return { at: element.selectedIndex, text: document.querySelector('#user option:checked')?.textContent };
		});
		assert.deepEqual(shown, { at: 1, text: 'Ada' }, 'the placeholder is row 0, so Ada is row 1');

		// The appearance Chromium draws the open list from, which is what design 130 asks for.
		const drawn = await view.evaluate(() => getComputedStyle(document.querySelector('#user')!).appearance);
		assert.equal(drawn, 'base-select', 'the host took the base appearance');
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
		assert.equal(await view.getAttribute(panel, 'popover'), 'hint',
			'hint, not manual: a tip does not close a menu that is already open');

		await view.mouse.move(0, 400);
		await view.waitForFunction(() => !(globalThis as never as { read(): boolean }).read());

		// Focus does not wait: the person arrived on purpose.
		await view.focus('#anchor');
		assert.equal(await view.evaluate(() => (globalThis as never as { read(): boolean }).read()), true,
			'a keyboard sees it without the pause a pointer gets');
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

test('End on a colour picker slider writes the cell', async () => {
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
