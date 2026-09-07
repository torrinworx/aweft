// The gallery, built and driven: what a page made of `@aweftjs/ui` does in a real browser.
//
// The job is the ordinary one: build the page with the bundler plugin, open it, and use it. What
// makes it a recipe rather than a demo is that every step asserts, including the ones only a real
// browser can answer: that the theme's CSS reached the head and is applied, that a real click and
// a real keystroke reach the handlers, that focus moves, that a popup is measured against its
// anchor and placed, and that it asks for the top layer with `popover` rather than a z-index.
//
// It drives three pages. The gallery is every system the package ships. The preview is the look
// itself, light and dark side by side, and it is where the look is judged. The controls page
// is every control in every state, in both modes, written the way an application writes them. The
// assertions on the last two are about the contract rather than about the systems, and axe-core
// runs over both.
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

import { context, dark, light } from '@aweftjs/ui';

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

	// --- the preview page: the look, in both modes -----------------------------------------------

	// The roles as the theme holds them. What is checked below is that the browser is showing the
	// value the theme says, in the mode the pane asked for.
	const roles = context().theme;
	const roleOf = (values: typeof light, name: string): string => {
		const held = roles.variable(values, [], name);
		assert.ok(held !== null, `the theme defines $${name}`);
		return held;
	};
	// A role's value as it is written in the stylesheet, escaped for a regular expression.
	const rgbHex = (hex: string): string => hex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const rgb = (hex: string): string => {
		const value = parseInt(hex.slice(1), 16);
		return `rgb(${String((value >> 16) & 255)}, ${String((value >> 8) & 255)}, ${String(value & 255)})`;
	};

	await page.goto(site.url + 'preview.html');
	await page.waitForSelector('#preview');

	const previewSheet = await page.evaluate(() =>
		document.head.querySelector('style[data-aweft]')?.textContent ?? '');
	assert.ok(previewSheet.includes('@layer aweft'), 'the preview page carries the theme sheet');
	assert.ok(!previewSheet.includes('!important'), 'and still no !important');

	const paint = async (selector: string): Promise<Record<string, string | undefined>> =>
		page.evaluate((query: string) => {
			const style = getComputedStyle(document.querySelector(query)!);
			return {
				background: style.backgroundColor,
				backgroundImage: style.backgroundImage,
				color: style.color,
				borderColor: style.borderTopColor,
				outlineWidth: style.outlineWidth,
				outlineStyle: style.outlineStyle,
				outlineColor: style.outlineColor,
				transitionDuration: style.transitionDuration,
				fontSize: style.fontSize,
				lineHeight: style.lineHeight,
				minHeight: style.minHeight,
			};
		}, selector);

	const lightButton = await paint('#button-light');
	const darkButton = await paint('#button-dark');

	assert.equal(lightButton.background, rgb(roleOf(light, 'accent')), 'the light button is the light $accent');
	assert.equal(lightButton.color, rgb(roleOf(light, 'accentForeground')), 'on the light $accentForeground');
	assert.equal(darkButton.background, rgb(roleOf(dark, 'accent')), 'the dark button is the dark $accent');
	assert.equal(darkButton.color, rgb(roleOf(dark, 'accentForeground')), 'on the dark $accentForeground');
	assert.notEqual(lightButton.background, darkButton.background,
		'the two modes nested on one page resolve their own roles');

	const lightCard = await paint('#card-light');
	const darkCard = await paint('#card-dark');
	assert.equal(lightCard.background, rgb(roleOf(light, 'surface')));
	assert.equal(darkCard.background, rgb(roleOf(dark, 'surface')));
	assert.notEqual(lightCard.borderColor, darkCard.borderColor, 'and so does the border');

	// The smallest pointer target, and type in rem, both come out of the contract.
	assert.equal(lightButton.minHeight, '24px', '$target is 24px');
	const body = await paint('#body-light');
	assert.equal(body.fontSize, '16px', '$textMd is one rem');
	assert.equal(body.lineHeight, '24px', 'and it has its line height');

	// Hover is a tint of the element's own foreground, laid over whatever background it has.
	assert.equal(lightButton.backgroundImage, 'none', 'no tint before the pointer arrives');
	await page.hover('#button-light');
	const hoveredButton = await paint('#button-light');
	assert.notEqual(hoveredButton.backgroundImage, 'none', 'a real hover lays the tint on');
	assert.equal(hoveredButton.background, lightButton.background, 'and leaves the role underneath it');
	await page.mouse.move(0, 0);

	// A real Tab shows the ring. `:focus-visible` is what the rule is written against, so a
	// keyboard has to be what moves the focus.
	await page.keyboard.press('Tab');
	const focused = await page.evaluate(() => document.activeElement?.getAttribute('id') ?? '');
	assert.equal(focused, 'button-light', 'the first Tab reaches the first control');
	const ringed = await paint('#button-light');
	assert.equal(ringed.outlineStyle, 'solid', 'the focus ring is drawn');
	assert.equal(ringed.outlineWidth, '2px', 'at $ringWidth');
	assert.equal(ringed.outlineColor, rgb(roleOf(light, 'ring')), 'in $ring');

	// Motion is declared once, inside the query that asks whether the person wants any.
	assert.equal(ringed.transitionDuration, '0.12s', '$fast, when motion is welcome');
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const still = await paint('#button-light');
	assert.equal(still.transitionDuration, '0s', 'and nothing at all when it is not');
	await page.emulateMedia({ reducedMotion: 'no-preference' });

	// --- axe over the preview page ----------------------------------------------------------------

	await page.addScriptTag({ path: fileURLToPath(import.meta.resolve('axe-core/axe.min.js')) });
	const audit = await page.evaluate(async () => axe.run(document, {
		runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
	}));
	for (const violation of audit.violations) {
		console.error(`axe ${violation.id}: ${violation.help} (${String(violation.nodes.length)} node(s))`);
		for (const node of violation.nodes) console.error(`  ${node.html}`);
	}
	assert.equal(audit.violations.length, 0, 'axe found nothing to fix on the preview page');
	console.log(`recipes/ui: axe passed ${String(audit.passes.length)} rules with no violation`);

	// --- the controls page: every control, in both modes -------------------------------------------

	await page.goto(site.url + 'controls.html');
	await page.waitForSelector('#controls');

	// Every control is there, in both panes, and each is the element it claims to be.
	const shapes = await page.evaluate(() => {
		const tagOf = (id: string): string | null =>
			document.querySelector(`#${id}`)?.tagName.toLowerCase() ?? null;
		return {
			button: tagOf('button-light'),
			link: tagOf('button-link-light'),
			field: tagOf('field-light'),
			area: tagOf('area-light'),
			checkbox: tagOf('checkbox-light'),
			toggle: tagOf('toggle-light'),
			slider: tagOf('slider-light'),
			select: tagOf('select-light'),
			radio: tagOf('radio-small-light'),
			icon: tagOf('icon-check-light'),
			darkButton: tagOf('button-dark'),
			drawn: document.querySelectorAll('#controls div[role="slider"], #controls div[role="checkbox"]').length,
		};
	});
	assert.deepEqual(shapes, {
		button: 'button', link: 'a', field: 'input', area: 'textarea', checkbox: 'input',
		toggle: 'input', slider: 'input', select: 'select', radio: 'input', icon: 'svg',
		darkButton: 'button', drawn: 0,
	}, 'every control is the native element, and nothing on the page is a drawn one');

	// The two modes resolve their own roles, on the components rather than on hand-written markup.
	const modes = await page.evaluate(() => ({
		light: getComputedStyle(document.querySelector('#button-light')!).backgroundColor,
		dark: getComputedStyle(document.querySelector('#button-dark')!).backgroundColor,
	}));
	assert.notEqual(modes.light, modes.dark, 'a Button resolves the mode of the pane it is in');

	// A real click on a real button, and the error it turns on reaches the field's ARIA.
	assert.equal(await page.getAttribute('#field-invalid-light', 'aria-invalid'), null);
	await page.click('#toggle-error-light');
	assert.equal(await page.getAttribute('#field-invalid-light', 'aria-invalid'), 'true',
		'the error cell drove aria-invalid');
	const describedBy = await page.getAttribute('#field-invalid-light', 'aria-describedby') ?? '';
	assert.match(await page.textContent(`#${describedBy}`) ?? '', /does not look like an address/,
		'and aria-describedby names the message that arrived');

	// A promise the click handler returns disables the button while it is out.
	assert.equal(await page.getAttribute('#button-loading-light', 'disabled'), null);
	await page.click('#button-toggle-busy-light');
	assert.equal(await page.getAttribute('#button-loading-light', 'disabled'), '',
		'the loading cell disabled the button');
	await page.click('#button-toggle-busy-light');

	// The textarea measures itself and grows, which needs a layout and so belongs here.
	const before = await page.evaluate(() =>
		document.querySelector('#area-light')!.getBoundingClientRect().height);
	await page.click('#area-light');
	await page.keyboard.type('one\ntwo\nthree\nfour\nfive');
	const after = await page.evaluate(() =>
		document.querySelector('#area-light')!.getBoundingClientRect().height);
	assert.ok(after > before, `the text area grew to its content: ${String(before)} to ${String(after)}`);

	// The slider's thumb and track are drawn from the theme on the vendor pseudo-elements. Chromium
	// does not report a vendor pseudo-element through getComputedStyle, so what is read here is that
	// the host was told not to draw its own and that the rule reached the page with the role in it.
	const slider = await page.evaluate(() => ({
		appearance: getComputedStyle(document.querySelector('#slider-light')!).appearance,
		height: getComputedStyle(document.querySelector('#slider-light')!).height,
		sheet: document.head.querySelector('style[data-aweft]')?.textContent ?? '',
	}));
	assert.equal(slider.appearance, 'none', 'the host is not drawing its own range input');
	assert.equal(slider.height, '24px', 'and it is at least $target tall');
	assert.match(slider.sheet, new RegExp(`::-webkit-slider-thumb \\{[^}]*background: ${rgbHex(roleOf(light, 'accent'))}`),
		'the thumb rule reached the page with $accent in it');

	// An icon is one svg element, sized in em so it follows the text beside it.
	const icons = await page.evaluate(() => {
		const one = document.querySelector('#icon-check-light')!;
		const big = document.querySelector('#icon-big-light')!;
		return {
			children: one.querySelectorAll('svg').length,
			hidden: document.querySelector('#icons-light svg:not([role])')?.getAttribute('aria-hidden') ?? null,
			label: one.getAttribute('aria-label'),
			size: getComputedStyle(one).width,
			big: getComputedStyle(big).width,
		};
	});
	assert.equal(icons.children, 0, 'one svg per icon, not one wrapping another');
	assert.equal(icons.label, 'done');
	assert.equal(icons.size, '16px', '1em of the 16px body text around it');
	assert.equal(icons.big, '32px', 'and a size prop overrides it');

	// --- axe over the controls page -----------------------------------------------------------------

	await page.addScriptTag({ path: fileURLToPath(import.meta.resolve('axe-core/axe.min.js')) });
	const controlsAudit = await page.evaluate(async () => axe.run(document, {
		runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
	}));
	for (const violation of controlsAudit.violations) {
		console.error(`axe ${violation.id}: ${violation.help} (${String(violation.nodes.length)} node(s))`);
		for (const node of violation.nodes) console.error(`  ${node.html}`);
	}
	assert.equal(controlsAudit.violations.length, 0, 'axe found nothing to fix on the controls page');
	console.log(`recipes/ui: axe passed ${String(controlsAudit.passes.length)} rules on the controls page with no violation`);

	assert.deepEqual(problems, [], 'the page threw nothing');
	console.log('recipes/ui: ok');
} finally {
	await browser.close();
	await site.close();
}
