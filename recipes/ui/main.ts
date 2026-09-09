// The gallery, built and driven: what a page made of `@aweftjs/ui` does in a real browser.
//
// The job is the ordinary one: build the page with the bundler plugin, open it, and use it. What
// makes it a recipe rather than a demo is that every step asserts, including the ones only a real
// browser can answer: that the theme's CSS reached the head and is applied, that a real click and
// a real keystroke reach the handlers, that focus moves, that a popup is measured against its
// anchor and placed, and that it asks for the top layer with `popover` rather than a z-index.
//
// It drives three pages. The gallery is every system the package ships. The preview is the look
// itself, light and dark side by side, and it is where the look is judged. The catalogue is
// every component the package exports, in every state, in both modes, built from one example file
// each (design 197). The assertions on the last two are about the contract rather than about the
// systems, and axe-core runs over both.
//
// Run: node recipes/ui/main.ts
// Serve it instead, to click around: npx vite recipes/ui

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
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

	// --- text modifiers --------------------------------------------------------------------------

	assert.equal(await page.evaluate(() => document.querySelectorAll('#note b').length), 0,
		'nothing in the note matches yet');
	await page.click('#note-field');
	await page.keyboard.press('End');
	await page.keyboard.type(', TODO ask @ada');
	await page.waitForFunction(() => document.querySelectorAll('#note b').length === 1);
	assert.equal(await page.evaluate(() => document.querySelectorAll('#note i').length), 1,
		'the second modifier found the mention in the same pass');
	assert.match(await page.textContent('#note') ?? '', /nothing to do yet, TODO ask @ada/,
		'and the gaps between the matches are the text that was typed');

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
				outlineStyle: style.outlineStyle,
				boxShadow: style.boxShadow,
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

	// One control height, and type in rem, both come out of the contract.
	assert.equal(lightButton.minHeight, '36px', '$control is 36px (design 192)');
	const body = await paint('#body-light');
	assert.equal(body.fontSize, '16px', '$textMd is one rem');
	assert.equal(body.lineHeight, '24px', 'and it has its line height');

	// The type section, which is `Typography` rather than hand-written markup. The sizes are the
	// scale in rem read back in the pixels a 16px root makes of them (design 182).
	const type = await page.evaluate(() => {
		const style = (id: string): Record<string, string> => getComputedStyle(document.querySelector(id)!);
		return {
			h1Size: style('#type-h1-light')['fontSize'],
			h1Tag: document.querySelector('#type-h1-light')!.tagName.toLowerCase(),
			h3Tag: document.querySelector('#type-h3-light')!.tagName.toLowerCase(),
			boldWeight: style('#type-h2-bold-light')['fontWeight'],
			p1Size: style('#type-p1-light')['fontSize'],
			p2Size: style('#type-p2-light')['fontSize'],
			darkH1: style('#type-h1-dark')['color'],
			lightH1: style('#type-h1-light')['color'],
			inlineTag: document.querySelector('#type-inline-light')!.tagName,
			inlineParent: document.querySelector('#type-inline-light')!.parentElement!.tagName,
		};
	});
	assert.equal(type.h1Size, '36px', '$text4xl is 2.25rem of the 16px root');
	assert.equal(type.p1Size, '16px', 'a paragraph is body size');
	assert.equal(type.p2Size, '14px', 'and the smaller one is $textSm');
	assert.equal(type.boldWeight, '600', 'text_bold after text_h2 is what the browser computes');
	assert.equal(type.h3Tag, 'h3', 'the first segment picked the element');
	assert.equal(type.h1Tag, 'p', 'and element put the h1 look on the level the outline wanted');
	assert.notEqual(type.lightH1, type.darkH1, 'the type section resolves the mode of its pane');
	assert.equal(type.inlineTag, 'SPAN', 'a run inside a line of text is a span');
	assert.equal(type.inlineParent, 'P',
		'and it is still inside the paragraph: a <p> here would have closed the outer one early');

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
	assert.equal(ringed.outlineStyle, 'none', 'the ring is not an outline any more (design 192)');
	// A halo of `$ring` at half strength, `$ringWidth` wide. Chromium writes a mixed colour in its
	// own notation, so what is checked is the spread and that the colour is the role at half alpha.
	assert.match(ringed.boxShadow ?? '', /0px 0px 0px 3px/, 'a $ringWidth halo, drawn as a box shadow');
	assert.ok((ringed.boxShadow ?? '').includes('0.5'), `the halo is $ring at half strength: ${String(ringed.boxShadow)}`);
	// The border moves to `$ring` with it, so the control's own edge is part of the ring rather
	// than something the ring covers. It transitions, so this waits for it to arrive.
	await page.waitForFunction((want: string) =>
		getComputedStyle(document.querySelector('#button-light')!).borderTopColor === want,
		rgb(roleOf(light, 'ring')));

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

	// --- the catalogue: every component, in both modes ---------------------------------------------

	await page.goto(site.url + 'catalogue.html');
	await page.waitForSelector('#catalogue');
	// Wide enough for the two panes to sit side by side, which is what the page is for. The gallery
	// and the preview are read at the viewport the browser opened with.
	await page.setViewportSize({ width: 1440, height: 900 });

	// Every component the package exports has a section, and the ones that do not are named here
	// with the reason (design 197). The list is read out of the surface file the gate regenerates,
	// so a component added to `index.ts` and forgotten here turns this red.
	const NO_EXAMPLE: Record<string, string> = {
		Head: 'a head tag', Link: 'a head tag', Meta: 'a head tag', Script: 'a head tag',
		Style: 'a head tag', Title: 'a head tag',
		Theme: 'a provider', ThemeContext: 'a provider', Icons: 'a provider',
		InputContext: 'a provider', LoaderContext: 'a provider', PopupContext: 'a provider',
		StageContext: 'a provider', TextModifiers: 'a provider, shown in the Typography example',
		ValidateContext: 'a provider, shown in the Validate example',
		Shown: 'control flow, shown on the gallery page',
		Switch: 'control flow, shown on the gallery page',
		Stage: 'the stage, shown in the Modal example',
		Default: 'the stage template that adds nothing, shown in the Modal example',
		Detached: 'the mechanism under the Popup and Tooltip examples',
		Tab: 'shown in the Tabs example', TabPanel: 'shown in the Tabs example',
	};

	// The sections that show theme entries rather than a component. There is one: the form layout,
	// which is entries and a bare label since design 209 withdrew `Field`.
	const NO_COMPONENT: readonly string[] = ['Form'];

	const exported = readFileSync(join(here, '..', '..', 'packages', 'ui', 'surface.txt'), 'utf8')
		.split('\n')
		.map((line) => /^value ([A-Z]\w*):/.exec(line)?.[1])
		.filter((name): name is string => name !== undefined);

	const shown = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#catalogue main > section')).map((node) => node.id));

	const missing = exported.filter((name) => !(name in NO_EXAMPLE) && !shown.includes(name));
	assert.deepEqual(missing, [],
		`every exported component has an example file: ${missing.join(', ')} has none`);
	const stray = shown.filter((name) => !exported.includes(name) && !NO_COMPONENT.includes(name));
	assert.deepEqual(stray, [], `and every example names a component the package exports: ${stray.join(', ')}`);

	const files = readdirSync(join(here, 'examples')).filter((name) => name.endsWith('.example.tsx'));
	assert.equal(files.length, shown.length,
		`every file under examples/ is on the page: ${String(files.length)} files, ${String(shown.length)} sections`);
	console.log(`recipes/ui: ${String(shown.length)} examples for ${String(exported.length)} exports, `
		+ `${String(Object.keys(NO_EXAMPLE).length)} of them named as needing none`);

	// The list down the left is the page's own order, and a link scrolls its section to the top. The
	// nav is named, because an example may put a `<nav>` of its own on the page and a `Breadcrumb`
	// does.
	const links = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#catalogue nav[aria-label="Components"] a'))
			.map((node) => node.getAttribute('href')));
	assert.deepEqual(links, shown.map((id) => `#${id}`), 'one link per example, in the page\'s order');

	// A section with sections under it, so the scroll is not stopped by the end of the document.
	const scrolledFrom = await page.evaluate(() => window.scrollY);
	await page.click('#catalogue nav[aria-label="Components"] a[href="#Form"]');
	await page.waitForFunction(() => window.scrollY > 0);
	const scrolledTo = await page.evaluate(() => window.scrollY);
	assert.ok(scrolledTo > scrolledFrom,
		`a nav link scrolls its section into view: ${String(scrolledFrom)} to ${String(scrolledTo)}`);
	const landed = await page.evaluate(() =>
		Math.round(document.querySelector('#Form')!.getBoundingClientRect().top));
	assert.ok(landed >= -1 && landed < 40,
		`and the section is at the top of the viewport, under its scroll margin: ${String(landed)}px`);
	await page.evaluate(() => window.scrollTo(0, 0));

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
			drawn: document.querySelectorAll('#catalogue div[role="slider"], #catalogue div[role="checkbox"]').length,
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
	assert.equal(slider.height, '36px', 'and its hit area is $control tall');
	assert.match(slider.sheet, new RegExp(`::-webkit-slider-thumb \\{[^}]*background: ${rgbHex(roleOf(light, 'accent'))}`),
		'the thumb rule reached the page with $accent in it');

	// The size axis: three heights on the button, and a square at each of them (design 194).
	const axis = await page.evaluate(() => {
		const of = (id: string): [number, number] => {
			const box = document.querySelector(`#${id}`)!.getBoundingClientRect();
			return [Math.round(box.width), Math.round(box.height)];
		};
		return {
			sm: of('button-sm-light'), md: of('button-md-light'), lg: of('button-lg-light'),
			squareSm: of('square-sm-light'), squareMd: of('square-md-light'), squareLg: of('square-lg-light'),
			fieldSm: of('field-sm-light')[1], selectLg: of('select-lg-light')[1],
		};
	});
	assert.equal(axis.sm[1], 32, '$controlSm is 32px');
	assert.equal(axis.md[1], 36, '$control is 36px');
	assert.equal(axis.lg[1], 40, '$controlLg is 40px');
	assert.deepEqual(axis.squareSm, [32, 32], 'an icon button is a square at every size');
	assert.deepEqual(axis.squareMd, [36, 36]);
	assert.deepEqual(axis.squareLg, [40, 40]);
	assert.equal(axis.fieldSm, 32, 'and the axis is one segment, so a field takes it too');
	assert.equal(axis.selectLg, 40);

	// The select draws its own arrow inside its own box (design 195), so the height is unchanged
	// by it and the host's is nowhere on the page. The arrow is an empty box with two of its sides
	// drawn, turned a quarter turn, so this page needs no icon pack to have one.
	const arrows = await page.evaluate(() => {
		const select = document.querySelector('#select-light')!;
		const wrap = select.parentElement!;
		const arrow = wrap.querySelector('span')!;
		const mark = arrow.getBoundingClientRect();
		const box = select.getBoundingClientRect();
		return {
			height: Math.round(box.height),
			inset: getComputedStyle(arrow).right,
			side: arrow.offsetWidth,
			inside: mark.right <= box.right,
			drawings: wrap.querySelectorAll('svg').length,
			appearance: getComputedStyle(select).appearance,
		};
	});
	assert.equal(arrows.height, 36, 'a select with its arrow in it is still $control tall');
	assert.equal(arrows.inset, '12px', 'the arrow sits $space3 in from the right edge');
	assert.equal(arrows.side, 8, 'and it is a $chevron box');
	assert.ok(arrows.inside, 'and inside the control');
	assert.equal(arrows.drawings, 0, 'nothing on the page asked the Icons stack for an arrow');
	assert.equal(arrows.appearance, 'base-select', 'Chromium takes the second appearance');

	// An icon is one svg element, sized in em so it follows the text beside it.
	const icons = await page.evaluate(() => {
		const one = document.querySelector('#icon-check-light')!;
		const big = document.querySelector('#icon-big-light')!;
		return {
			children: one.querySelectorAll('svg').length,
			named: document.querySelector('#icon-named-light')?.tagName.toLowerCase() ?? null,
			label: one.getAttribute('aria-label'),
			size: getComputedStyle(one).width,
			big: getComputedStyle(big).width,
		};
	});
	assert.equal(icons.children, 0, 'one svg per icon, not one wrapping another');
	assert.equal(icons.label, 'done');
	assert.equal(icons.size, '16px', '1em of the 16px body text around it');
	assert.equal(icons.big, '32px', 'and a size prop overrides it');
	assert.equal(icons.named, 'svg', 'a bare name found its drawing in the set the page installed');

	// A modal is opened by the stage, and every way of closing it is the stage's close. The dialog
	// is found by its element rather than by an id: a `Modal` writes only the props it names, so an
	// id carried through `open` reaches the act and not the element (design 213), and one modal is
	// open at a time.
	assert.equal(await page.locator('dialog').count(), 0, 'no modal before anybody asked for one');
	await page.click('#open-modal-light');
	await page.waitForSelector('#editing-light');
	const modal = await page.evaluate(() => {
		const dialog = document.querySelector('dialog')!;
		return {
			tag: dialog.tagName.toLowerCase(),
			modal: dialog.matches(':modal'),
			named: document.querySelector(`#${dialog.getAttribute('aria-labelledby') ?? ''}`)?.textContent ?? '',
		};
	});
	assert.deepEqual(modal, { tag: 'dialog', modal: true, named: 'Edit the thing' },
		'a real <dialog>, showing as a modal, with a name a screen reader can read');
	await page.click('dialog button[aria-label="Close"]');
	await page.waitForFunction(() => document.querySelector('#editing-light') === null);

	// A tip on a real hover, and the anchor points at the panel. The box the solver placed is what
	// reaches the top layer; the panel stays inside it and wears no popover of its own (design 135).
	const tipId = await page.getAttribute('#tip-anchor-light', 'aria-describedby') ?? '';
	assert.notEqual(tipId, '', 'the anchor names its tip');
	assert.equal(await page.getAttribute(`#${tipId}`, 'role'), 'tooltip');
	await page.hover('#tip-anchor-light');
	await page.waitForFunction((id: string) =>
		document.querySelector(`#${id}`)!.parentElement!.matches(':popover-open'), tipId);
	assert.equal(await page.getAttribute(`#${tipId}`, 'popover'), null,
		'the panel is not a popover: one inside the box would be laid out by the browser and leave it');
	assert.equal(await page.evaluate((id: string) =>
		document.querySelector(`#${id}`)!.parentElement!.getAttribute('popover'), tipId), 'manual',
		'the box asked for the top layer, with no z-index anywhere');
	await page.mouse.move(0, 0);
	await page.waitForFunction((id: string) =>
		!document.querySelector(`#${id}`)!.parentElement!.matches(':popover-open'), tipId);

	// A disclosure opens in the page's flow, and the platform's own keyboard does it.
	assert.equal(await page.evaluate(() => document.querySelector('#dropdown-light')!
		.contains(document.querySelector('#dropdown-content-light'))), true,
		'the content is inside the details, not in the popup sink');
	const shut = await page.evaluate(() =>
		document.querySelector('#dropdown-light')!.getBoundingClientRect().height);
	await page.focus('#dropdown-light summary');
	await page.keyboard.press('Space');
	await page.waitForFunction(() => document.querySelector('#dropdown-light')!.hasAttribute('open'));
	const shownHeight = await page.evaluate(() =>
		document.querySelector('#dropdown-light')!.getBoundingClientRect().height);
	assert.ok(shownHeight > shut,
		`an open disclosure pushes the page down rather than floating over it: ${String(shut)} to ${String(shownHeight)}`);

	// A real file, through the input the zone hides but keeps focusable.
	await page.setInputFiles('#filedrop-light input[type=file]', {
		name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('not really a png'),
	});
	await page.waitForSelector('#filedrop-light li');
	assert.match(await page.textContent('#filedrop-light li') ?? '', /shot\.png/,
		'the entry is listed with its name');
	const hidden = await page.evaluate(() => {
		const input = document.querySelector('#filedrop-light input[type=file]')!;
		const style = getComputedStyle(input);
		return { display: style['display'], width: input.getBoundingClientRect().width };
	});
	assert.notEqual(hidden.display, 'none', 'the input is off the screen, not out of the focus order');
	assert.ok(hidden.width < 4, `and it takes no room: ${String(hidden.width)}px`);

	// The signal is what starts the checking, and the context tallies the answers. The count is
	// taken inside the section, because a control elsewhere on the page may have a standing error.
	assert.equal(await page.locator('#Validate [role="alert"]').count(), 0,
		'a person typing is not a person who is wrong yet');
	await page.click('#validate-email-light');
	await page.keyboard.type('nope');
	assert.equal(await page.locator('#Validate [role="alert"]').count(), 0);
	await page.click('#submit-light');
	await page.waitForSelector('#Validate [role="alert"]');
	assert.equal(await page.textContent('#valid-light'), 'the form is not happy');
	assert.equal(await page.getAttribute('#validate-email-light', 'aria-invalid'), 'true',
		'and the control the wrapper holds says so itself');

	await page.click('#validate-email-light');
	await page.keyboard.press('Control+a');
	await page.keyboard.type('ada@example.com');
	await page.click('#validate-phone-light');
	await page.keyboard.type('5195551234');
	await page.click('#catalogue-title');
	await page.waitForFunction(() => document.querySelector('#valid-light')!.textContent === 'the form is happy');
	assert.equal(await page.evaluate(() => document.querySelector('#validate-phone-light')!.value),
		'(519) 555-1234', 'a formatting validator wrote the value back punctuated');

	// The picker's sliders are real range inputs, and End on the hue is a keyboard away.
	const knobs = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#picker-light input')).map((node) => node.getAttribute('type')));
	assert.deepEqual(knobs, ['range', 'range', 'range'], 'three sliders, because hasAlpha is false');
	assert.equal(await page.locator('#picker-alpha-light input').count(), 4, 'and four with alpha');
	const started = await page.textContent('#picked-light') ?? '';
	await page.focus('#picker-light input[type=range]');
	await page.keyboard.press('End');
	await page.waitForFunction((was: string) => document.querySelector('#picked-light')!.textContent !== was,
		started);
	assert.match(await page.textContent('#picked-light') ?? '', /^rgb\(/,
		'the cell is written back as rgb() text');

	// A form laid out by the theme entries and a bare label (design 209). A pane on this page is
	// wider than 28rem, so the responsive field is a row here; the narrow case is measured in
	// `packages/ui/tests/browser.test.ts`, where the group's width can be moved.
	const form = await page.evaluate(() => {
		const responsive = document.querySelector('#field-responsive-light')!;
		const inline = document.querySelector('#field-inline-light')!;
		const set = document.querySelector('#fieldset-light')!;
		return {
			group: getComputedStyle(document.querySelector('#form-light')!).containerType,
			wide: Math.round(document.querySelector('#form-light')!.getBoundingClientRect().width),
			responsive: getComputedStyle(responsive).flexDirection,
			inline: getComputedStyle(inline).flexDirection,
			legend: set.querySelector('legend')!.textContent,
			border: getComputedStyle(set).borderTopStyle,
		};
	});
	assert.equal(form.group, 'inline-size', 'the group is the container a responsive field measures');
	assert.ok(form.wide > 448, `and this pane is wider than 28rem: ${String(form.wide)}px`);
	assert.equal(form.responsive, 'row', 'so the responsive field is a row at this width');
	assert.equal(form.inline, 'row', 'and the inline one is a row at every width');
	assert.equal(form.legend, 'Where to send it');
	assert.equal(form.border, 'none', 'and the fieldset draws no frame of its own');

	// The two modes resolve their own roles, on the composites as on everything else.
	const composedModes = await page.evaluate(() => ({
		light: getComputedStyle(document.querySelector('#tip-anchor-light')!).backgroundColor,
		dark: getComputedStyle(document.querySelector('#tip-anchor-dark')!).backgroundColor,
	}));
	assert.notEqual(composedModes.light, composedModes.dark, 'a composite resolves the mode of its pane');

	// --- the display and grouping pieces (designs 199, 200) ----------------------------------------

	// One thing per component, each of them something only a real browser can answer.
	const badges = await page.evaluate(() => ({
		light: getComputedStyle(document.querySelector('#badge-light')!).backgroundColor,
		dark: getComputedStyle(document.querySelector('#badge-dark')!).backgroundColor,
		outline: getComputedStyle(document.querySelector('#badge-outline-light')!).backgroundColor,
	}));
	assert.notEqual(badges.light, badges.dark, 'a Badge resolves the mode of the pane it is in');
	assert.equal(badges.outline, 'rgba(0, 0, 0, 0)', 'and an outline badge has no fill at all');

	const alerts = await page.evaluate(() => ({
		plain: document.querySelector('#alert-light')!.getAttribute('role'),
		bad: document.querySelector('#alert-danger-light')!.getAttribute('role'),
	}));
	assert.deepEqual(alerts, { plain: 'status', bad: 'alert' },
		'a danger alert interrupts a screen reader and the rest wait their turn');

	// The picture is a data URL, so it has loaded by now and the letters are gone; the one with no
	// src never made an image at all.
	await page.waitForFunction(() => !document.querySelector('#avatar-light img')!.hasAttribute('hidden'));
	const avatars = await page.evaluate(() => ({
		letters: document.querySelector('#avatar-light span')!.hasAttribute('hidden'),
		images: document.querySelectorAll('#avatar-fallback-light img').length,
		text: document.querySelector('#avatar-fallback-light')!.textContent,
	}));
	assert.deepEqual(avatars, { letters: true, images: 0, text: 'AB' },
		'a picture that loaded hides its letters, and an avatar with no src never made an image');

	assert.equal(await page.getAttribute('#skeleton-light', 'aria-hidden'), 'true',
		'a skeleton says nothing to a screen reader');

	// `position` is the progress element's own property, which the narrow element shape this
	// project compiles against does not name.
	const positionOf = (id: string): Promise<number> => page.evaluate((held: string) =>
		(document.querySelector(`#${held}`) as unknown as { position: number }).position, id);
	assert.equal(await positionOf('progress-light'), 0.5, 'the progress element is a fraction of one');
	await page.click('#progress-more-light');
	assert.equal(await positionOf('progress-light'), 0.75, 'and the cell moves it');
	assert.equal(await positionOf('progress-waiting-light'), -1,
		'while one with no value at all is indeterminate');

	assert.equal(await page.textContent('#empty-bare-light'), 'Nothing to see',
		'an empty state renders only the parts it was given');

	const card = await page.evaluate(() =>
		Array.from(document.querySelector('#card-light')!.querySelectorAll(':scope > div'))
			.map((node) => (node.getAttribute('class') ?? '') !== ''));
	assert.deepEqual(card, [true, true, true], 'a card is a head, a body and a foot, each on its own part');

	// A card with none of the three parts is the bare block, and its children are its own children.
	const bareCard = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#paper-light > *')).map((node) => node.tagName.toLowerCase()));
	assert.deepEqual(bareCard, ['p', 'p'],
		'a card with no title, description or foot builds no head, body or foot (design 211)');

	// The ring is on the box a `leading` builds, not on the input inside it (design 210).
	await page.focus('#addon-light');
	const grouped = await page.evaluate(() => {
		const input = document.querySelector('#addon-light')!;
		const box = input.parentElement!;
		return {
			box: getComputedStyle(box)['boxShadow'] ?? '',
			input: getComputedStyle(input)['boxShadow'] ?? '',
			height: Math.round(box.getBoundingClientRect().height),
		};
	});
	assert.match(grouped.box, /0px 0px 0px 3px/, 'focusing the input rings the whole box');
	assert.equal(grouped.input, 'none', 'and the input inside it shows none of its own');
	assert.equal(grouped.height, 36, 'the box is $control tall, so it is the control');

	// --- the table and the navigation pieces (designs 201, 202) ------------------------------------

	// The table's rows, its scroll box, and the entries used on their own with no component at all.
	const table = await page.evaluate(() => {
		const box = document.querySelector('#table-light')!;
		const scroll = box.parentElement!;
		const markup = document.querySelector('#table-markup-light')!;
		return {
			rows: box.querySelectorAll('tbody tr').length,
			headings: box.querySelectorAll('th[scope="col"]').length,
			overflow: getComputedStyle(scroll).overflowX,
			focusable: scroll.getAttribute('tabindex'),
			caption: box.querySelector('caption')!.textContent,
			foot: box.querySelector('tfoot td')!.getAttribute('colspan'),
			byHand: getComputedStyle(markup).borderCollapse,
			hairline: getComputedStyle(markup.querySelector('tbody tr')!).borderBottomWidth,
		};
	});
	assert.equal(table.rows, 3, 'one row per file');
	assert.equal(table.headings, 3, 'and one heading per column');
	assert.equal(table.overflow, 'auto', 'the box a wide table scrolls in');
	assert.equal(table.focusable, '0', 'and a keyboard can reach that scroll');
	assert.equal(table.caption, 'Everything in this folder');
	assert.equal(table.foot, '3', 'the foot spans every column');
	assert.equal(table.byHand, 'collapse', 'the entries work on markup nobody generated');
	assert.equal(table.hairline, '1px', '$borderWidth under a hand-written row');

	// The breadcrumb: the last level is where you are, and the separators are drawn rather than
	// written, so this page needs no icon pack to have them.
	const trail = await page.evaluate(() => {
		const nav = document.querySelector('#breadcrumb-light')!;
		const marks = Array.from(nav.querySelectorAll('[aria-hidden="true"]'));
		const current = nav.querySelector('[aria-current="page"]')!;
		return {
			links: nav.querySelectorAll('a').length,
			marks: marks.length,
			drawings: nav.querySelectorAll('svg').length,
			// The border box, because `getBoundingClientRect` is the turned one and a quarter turn
			// makes an 8px square measure 11.3.
			side: marks[0]!.offsetWidth,
			current: current.textContent,
			name: nav.getAttribute('aria-label'),
		};
	});
	assert.equal(trail.links, 2, 'two of the three levels are links');
	assert.equal(trail.marks, 2, 'and there is one separator between each pair');
	assert.equal(trail.drawings, 0, 'nothing asked the Icons stack for a chevron');
	assert.equal(trail.side, 8, 'the separator is a $chevron box');
	assert.equal(trail.current, 'shot.png');
	assert.equal(trail.name, 'Breadcrumb', 'the nav is named, so a screen reader can list it');

	// The pagination window at page 5 of 12, and a real click moving it.
	const pages = await page.evaluate(() =>
		Array.from(document.querySelector('#pagination-light')!.querySelectorAll(':scope > *'))
			.map((node) => node.textContent));
	assert.deepEqual(pages, ['Previous', '1', '…', '4', '5', '6', '…', '12', 'Next'],
		'first, last, and a sibling each side of the page showing now');
	assert.equal(await page.getAttribute('#pagination-first-light button', 'disabled'), '',
		'previous is off on the first page');
	assert.equal(await page.textContent('#pagination-at-light'), '5');
	await page.click('#pagination-light button[aria-current="page"] + button');
	await page.waitForFunction(() => document.querySelector('#pagination-at-light')!.textContent === '6');

	// A sheet, opened through the stage the way the modal beside it is. A modal dialog is in the top
	// layer, so what it is measured against is the viewport rather than the pane it was opened from.
	await page.click('#open-sheet-light');
	await page.waitForSelector('#filtering-light');
	const edge = await page.evaluate(() => {
		const panel = document.querySelector('dialog')!;
		const box = panel.getBoundingClientRect();
		return {
			tag: panel.tagName.toLowerCase(),
			modal: panel.matches(':modal'),
			width: Math.round(box.width),
			right: Math.round(window.innerWidth - box.right),
			height: Math.round(box.height),
			viewport: window.innerHeight,
		};
	});
	assert.equal(edge.tag, 'dialog', 'a sheet is the same element a modal is');
	assert.ok(edge.modal, 'and it is showing as a modal');
	assert.equal(edge.width, 384, '$sheetWidth: 24rem');
	assert.equal(edge.right, 0, 'against the right edge');
	assert.equal(edge.height, edge.viewport, 'and as tall as the viewport');
	await page.click('dialog button[aria-label="Close"]');
	await page.waitForFunction(() => document.querySelector('#filtering-light') === null);


	// The tabs: a real arrow moves the focus and the selection together, and Home and End go to the
	// ends. Design 203: the strip is one tab stop, so the keys are what move inside it.
	const strip = await page.evaluate(() => {
		const box = document.querySelector('#tabs-light')!;
		const tabs = Array.from(box.querySelectorAll('[role="tab"]'));
		return {
			tabs: tabs.length,
			panels: box.querySelectorAll('[role="tabpanel"]').length,
			hidden: Array.from(box.querySelectorAll('[role="tabpanel"]'))
				.filter((node) => node.hasAttribute('hidden')).length,
			roving: tabs.map((node) => node.getAttribute('tabindex')).join(' '),
			named: tabs.every((node) =>
				document.querySelector(`[id="${node.getAttribute('aria-controls') ?? ''}"]`) !== null),
			height: Math.round(tabs[0]!.getBoundingClientRect().height),
		};
	});
	assert.equal(strip.tabs, 3, 'one tab per view');
	assert.equal(strip.panels, 3, 'and one panel per tab, all of them mounted');
	assert.equal(strip.hidden, 2, 'with the two that are not showing hidden');
	assert.equal(strip.roving, '0 -1 -1', 'one tab stop, on the tab showing');
	assert.ok(strip.named, 'every tab names a panel that is really on the page');
	assert.equal(strip.height, 36, '$control, the height every control is');

	assert.equal(await page.textContent('#tabs-value-light'), 'all');
	await page.focus('#tabs-light [role="tab"]');
	await page.keyboard.press('ArrowRight');
	await page.waitForFunction(() => document.querySelector('#tabs-value-light')!.textContent === 'mine');
	const moved = await page.evaluate(() => {
		const tabs = Array.from(document.querySelectorAll('#tabs-light [role="tab"]'));
		return {
			focused: document.activeElement!.textContent,
			selected: tabs.filter((node) => node.getAttribute('aria-selected') === 'true').length,
			roving: tabs.map((node) => node.getAttribute('tabindex')).join(' '),
		};
	});
	assert.equal(moved.focused, 'Mine', 'the arrow moved the focus');
	assert.equal(moved.selected, 1, 'and the selection moved with it, which is automatic activation');
	assert.equal(moved.roving, '-1 0 -1', 'and the one tab stop went with them');

	// End is the last tab that can be chosen, and the third one is disabled here.
	await page.keyboard.press('End');
	await page.waitForFunction(() => document.querySelector('#tabs-value-light')!.textContent === 'mine');
	assert.equal(await page.evaluate(() => document.activeElement!.textContent), 'Mine',
		'the disabled tab at the end is stepped over rather than landed on');
	await page.keyboard.press('Home');
	await page.waitForFunction(() => document.querySelector('#tabs-value-light')!.textContent === 'all');

	// The line type draws a $ringWidth rail in $accent under the tab showing, and no fill behind it.
	const rail = await page.evaluate(() => {
		const tabs = Array.from(document.querySelectorAll('#tabs-line-light [role="tab"]'));
		const chosen = tabs.find((node) => node.getAttribute('aria-selected') === 'true')!;
		const other = tabs.find((node) => node.getAttribute('aria-selected') !== 'true')!;
		return {
			width: getComputedStyle(chosen).borderBottomWidth,
			colour: getComputedStyle(chosen).borderBottomColor,
			quiet: getComputedStyle(other).borderBottomColor,
			fill: getComputedStyle(chosen).backgroundColor,
			height: Math.round(chosen.getBoundingClientRect().height),
		};
	});
	assert.equal(rail.width, '3px', '$ringWidth');
	assert.equal(rail.colour, 'rgb(28, 32, 39)', '$accent, which is the foreground in this theme');
	assert.equal(rail.quiet, 'rgba(0, 0, 0, 0)', 'and the tabs beside it carry a transparent one');
	assert.equal(rail.fill, 'rgba(0, 0, 0, 0)', 'an underlined tab is not also a filled one');
	assert.equal(rail.height, 32, '$controlSm, through the size the group handed down');

	// --- one button closes every section, and one opens every section ------------------------------

	const panels = await page.evaluate(() => document.querySelectorAll('#catalogue details[id^="panel-"]').length);
	assert.equal(panels, shown.length, 'one drop-down per section');
	const openPanels = async (): Promise<number> => page.evaluate(() =>
		document.querySelectorAll('#catalogue details[id^="panel-"][open]').length);
	assert.equal(await openPanels(), panels, 'and every one of them starts open');

	await page.click('#collapse-all');
	await page.waitForFunction(() =>
		document.querySelectorAll('#catalogue details[id^="panel-"][open]').length === 0);
	const collapsed = await openPanels();
	assert.equal(collapsed, 0, `the collapse button closed all ${String(panels)} sections`);

	await page.click('#expand-all');
	await page.waitForFunction((count: number) =>
		document.querySelectorAll('#catalogue details[id^="panel-"][open]').length === count, panels);
	assert.equal(await openPanels(), panels, `and the expand button opened all ${String(panels)} again`);

	// --- axe over the catalogue, with both modes showing --------------------------------------------

	await page.addScriptTag({ path: fileURLToPath(import.meta.resolve('axe-core/axe.min.js')) });
	const catalogueAudit = await page.evaluate(async () => axe.run(document, {
		runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
	}));
	for (const violation of catalogueAudit.violations) {
		console.error(`axe ${violation.id}: ${violation.help} (${String(violation.nodes.length)} node(s))`);
		for (const node of violation.nodes) console.error(`  ${node.html}`);
	}
	assert.equal(catalogueAudit.violations.length, 0, 'axe found nothing to fix on the catalogue');
	console.log(`recipes/ui: axe passed ${String(catalogueAudit.passes.length)} rules on the catalogue with no violation`);

	assert.deepEqual(problems, [], 'the page threw nothing');
	console.log('recipes/ui: ok');
} finally {
	await browser.close();
	await site.close();
}
