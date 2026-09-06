// The gallery, built and driven: what a page made of `@aweftjs/ui` does in a real browser.
//
// The job is the ordinary one: build the page with the bundler plugin, open it, and use it. What
// makes it a recipe rather than a demo is that every step asserts, including the ones only a real
// browser can answer: that the theme's CSS reached the head and is applied, that a real click and
// a real keystroke reach the handlers, that focus moves, that a popup is measured against its
// anchor and placed, and that it asks for the top layer with `popover` rather than a z-index.
//
// Run: node recipes/ui/main.ts
// Serve it instead, to click around: npx vite recipes/ui

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');

const TYPES: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
};

/** Serve the built page, and nothing outside it. */
const serve = async (): Promise<{ url: string; close(): Promise<void> }> => {
	const server = createServer((request, response) => {
		const path = (request.url ?? '/').split('?')[0]!;
		const file = join(dist, normalize(path === '/' ? '/index.html' : path));
		if (!file.startsWith(dist)) {
			response.writeHead(403).end();
			return;
		}
		try {
			const body = readFileSync(file);
			response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
			response.end(body);
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

console.log('building the gallery through aweft()');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });

const site = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const problems: string[] = [];
page.on('pageerror', (error) => problems.push(String(error)));

try {
	await page.goto(site.url);
	await page.waitForSelector('#page');

	// --- the stylesheet is real, and it applies ------------------------------------------------

	const sheet = await page.evaluate(() => {
		const style = document.head.querySelector('style[data-aweft]');
		return { text: style?.textContent ?? '', layers: (style?.textContent ?? '').includes('@layer aweft') };
	});
	assert.ok(sheet.layers, 'every rule ui emits sits inside @layer aweft');
	assert.ok(!sheet.text.includes('!important'), 'ui ships zero !important');

	const applied = await page.evaluate(() => {
		const style = getComputedStyle(document.querySelector('#counter')!);
		return { background: style.backgroundColor, radius: style.borderRadius };
	});
	assert.equal(applied.background, 'rgb(27, 110, 243)', 'the theme colour reached the element');
	assert.equal(applied.radius, '6px');

	// The colour function ran at compile time, over a real colour, and picked white on this blue.
	const ink = await page.evaluate(() => getComputedStyle(document.querySelector('#counter')!).color);
	assert.equal(ink, 'rgb(255, 255, 255)', '$contrast_text picked the readable ink');

	// A function this page defined, not one the package shipped.
	const sized = await page.evaluate(() => getComputedStyle(document.querySelector('#sized')!).fontSize);
	assert.equal(sized, '20px', 'the page\'s own $em ran');

	// A nested theme generated its own class rather than editing the outer one.
	const tiles = await page.evaluate(() => [
		getComputedStyle(document.querySelector('#outer-tile')!).backgroundColor,
		getComputedStyle(document.querySelector('#inner-tile')!).backgroundColor,
	]);
	assert.equal(tiles[0], 'rgb(255, 255, 255)');
	assert.equal(tiles[1], 'rgb(253, 243, 216)', 'the nested theme applies to its subtree only');

	// --- real events -----------------------------------------------------------------------------

	await page.click('#counter');
	await page.click('#counter');
	assert.match(await page.textContent('#counter') ?? '', /clicked 2 times/);

	// Hovering drives the cell, which drives the theme, which drives the class.
	await page.hover('#counter');
	const hovered = await page.evaluate(() => getComputedStyle(document.querySelector('#counter')!).backgroundColor);
	assert.notEqual(hovered, 'rgb(27, 110, 243)', 'isHovered moved the theme');
	await page.mouse.move(0, 0);

	await page.focus('#counter');
	assert.equal(await page.textContent('#focus-state'), 'focused', 'isFocused followed real focus');
	await page.evaluate(() => { document.querySelector('#counter')!.blur(); });
	assert.equal(await page.textContent('#focus-state'), 'not focused');

	// A real keyboard, not a hand-made event object.
	await page.click('#field');
	await page.keyboard.type('hello');
	assert.equal(await page.textContent('#typed'), 'hello');

	// Tab moves focus in DOM order, which is what a page that emits no positive tabindex gets.
	const positive = await page.evaluate(() =>
		Array.from(document.querySelectorAll('[tabindex]'))
			.filter((n) => Number(n.getAttribute('tabindex')) > 0).length);
	assert.equal(positive, 0, 'ui emits no positive tabindex');

	// --- control flow ------------------------------------------------------------------------------

	assert.equal(await page.locator('#then').count(), 1);
	await page.click('#toggle');
	assert.equal(await page.locator('#then').count(), 0);
	assert.equal(await page.locator('#else').count(), 1);

	assert.equal(await page.locator('#case-one').count(), 1);
	await page.click('#switch');
	assert.equal(await page.locator('#case-two').count(), 1);

	assert.equal(await page.locator('#rows li').count(), 2);
	await page.click('#add-row');
	assert.equal(await page.locator('#rows li').count(), 3);

	// --- the popup -----------------------------------------------------------------------------

	assert.equal(await page.locator('#menu').isVisible(), false, 'a closed popup is not on the screen');
	// With the anchor in the middle of the screen there is room under it, so the first mode the
	// solver is asked for is the one it can honour.
	await page.evaluate(() => { document.querySelector('#anchor')!.scrollIntoView({ block: 'center' }); });
	await page.click('#anchor');
	// It is laid out out of sight for one frame so it has a size to be placed by, so wait for the
	// frame that placed it rather than for the one that showed it.
	await page.waitForFunction(() => {
		const popup = document.querySelector('#menu')?.parentElement;
		if (popup === null || popup === undefined) return false;
		const style = getComputedStyle(popup);
		return style.position === 'fixed' && style.visibility === 'visible';
	});

	const placed = await page.evaluate(() => {
		const anchor = document.querySelector('#anchor')!.getBoundingClientRect();
		const popup = document.querySelector('#menu')!.parentElement!;
		const box = popup.getBoundingClientRect();
		return {
			anchorBottom: anchor.bottom, anchorLeft: anchor.left,
			popupTop: box.top, popupLeft: box.left,
			popover: popup.getAttribute('popover'),
			zIndex: getComputedStyle(popup).zIndex,
		};
	});
	assert.ok(Math.abs(placed.popupTop - placed.anchorBottom) < 2, 'the popup was measured and put under its anchor');
	assert.ok(Math.abs(placed.popupLeft - placed.anchorLeft) < 2, 'and lined up with its left edge');
	assert.equal(placed.popover, 'manual', 'it asked for the top layer with the popover attribute');
	assert.equal(placed.zIndex, 'auto', 'and there is no z-index anywhere');

	// The top layer is what puts it above a stacking context it is not inside.
	const above = await page.evaluate(() => {
		const popup = document.querySelector('#menu')!.parentElement!;
		const box = popup.getBoundingClientRect();
		const found = document.elementFromPoint(box.left + 4, box.top + 4);
		return found !== null && popup.contains(found);
	});
	assert.ok(above, 'the popup is what the pointer finds where the popup is');

	// Scrolling closes it, on the reading that a popup whose anchor has moved has had its moment.
	await page.evaluate(() => window.scrollTo(0, 200));
	await page.waitForFunction(() => {
		const popup = document.querySelector('#menu')?.parentElement;
		return popup !== null && popup !== undefined && getComputedStyle(popup).display === 'none';
	});

	// --- loading -------------------------------------------------------------------------------

	await page.waitForSelector('#arrived');
	await page.waitForSelector('#failed');
	assert.match(await page.textContent('#failed') ?? '', /the loader said no/,
		'a rejected loader shows the failure rather than the spinner forever');
	assert.equal(await page.locator('#spinner').count(), 0, 'no spinner was left behind');

	assert.deepEqual(problems, [], 'the page threw nothing');
	console.log('recipes/ui: ok');
} finally {
	await browser.close();
	await site.close();
}
