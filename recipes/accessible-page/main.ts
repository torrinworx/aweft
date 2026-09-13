// A page everyone can use, and the three places the stack says so.
//
// The job is an ordinary one: a page with an image, a form, a menu and a dialog, written so a
// screen reader and a keyboard get everything a mouse and a pair of eyes get. What makes it a
// recipe is the second half, which shows where the stack catches the page written wrong:
//
// 1. the build refuses an element the source says no one can read (design 265), at the line;
// 2. the mount throws on a nameless `Button` and on a page with no language or title (design 266);
// 3. `audit` and `walk` from `@aweftjs/testing/browser` read the rendered page for what only
//    it can show: a colour pair that is unreadable, a box that keeps the focus (design 267).
//
// What none of them reads is written at the end: the criteria that need a person.
//
// Run: node --import @aweftjs/build/loader recipes/accessible-page/main.ts
// Serve it instead, to click around: npx vite recipes/accessible-page

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { type Page, chromium } from 'playwright';

import { TransformError, transform } from '@aweftjs/build';
import { audit, walk } from '@aweftjs/testing/browser';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = join(here, 'dist');

const TYPES: Record<string, string> = {
	'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json',
};

/** Serve the built pages, and nothing outside them. */
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

// --- the build: the page compiles, and a page written wrong does not ---------------------------

console.log('the build');

// Every file this recipe ships went through the rules to get here; the vite build below is the
// proof for the page. These are the eight faults it would have stopped on, one each, so the
// reason and the fix are on record beside the page written right.
const FAULTS: readonly [reason: string, source: string][] = [
	['image-needs-alt', '<img src="/mark.svg" />'],
	['control-needs-label', '<input type="text" />'],
	['click-needs-role', '<div onClick={send}>Send</div>'],
	['tabindex-positive', '<button type="button" tabindex="1">First</button>'],
	['link-needs-href', '<a onClick={go}>Docs</a>'],
	['button-needs-name', '<button type="button" />'],
	['heading-needs-text', '<h2 />'],
	['frame-needs-title', '<iframe src="/map" />'],
];

for (const [reason, source] of FAULTS) {
	let refused: TransformError | null = null;
	try {
		transform(`import { h } from '@aweftjs/ui';\nexport const a = ${source};`, { filename: 'page.tsx' });
	} catch (error) {
		if (error instanceof TransformError) refused = error;
	}
	assert.ok(refused !== null, `${source} is refused`);
	assert.equal(refused.reason, reason);
	assert.match(refused.fix, /^[A-Z].*\.$/, 'and the refusal says what to write');
	console.log(`  ${reason}: ${source}\n    ${refused.fix}`);
}

// And what the rules leave alone, because the source cannot settle it: axe at test time can.
assert.doesNotThrow(() => transform("import { h } from '@aweftjs/ui';\nexport const a = <img {...picture} />;", { filename: 'p.tsx' }));
console.log('  a spread passes the build and is left to the audit');

console.log('\nbuilding the page and the three fault pages through aweft()');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'error' });

// --- the page, driven ------------------------------------------------------------------------------

const site = await serve();
const browser = await chromium.launch();

/** Open a page and collect what it throws, what it writes at error level, and its warnings. */
const open = async (path: string): Promise<{ view: Page; problems: string[]; warnings: string[] }> => {
	const view = await browser.newPage();
	const problems: string[] = [];
	const warnings: string[] = [];
	view.on('pageerror', (error) => problems.push(String(error)));
	view.on('console', (message) => {
		if (message.type() === 'error') problems.push(message.text());
		if (message.type() === 'warning') warnings.push(message.text());
	});
	await view.goto(`${site.url}${path}`);
	return { view, problems, warnings };
};

try {
	console.log('\nthe page, driven in Chromium');
	const { view, problems, warnings } = await open('');
	await view.waitForSelector('#page');

	// Every state by keyboard: the form, the icon button, the menu and the dialog.
	await view.getByLabel('To').fill('Ada');
	await view.getByLabel('Note').fill('The build is green.');
	await view.getByLabel('Send me a copy').check();
	await view.getByLabel('Note').focus();
	await view.keyboard.press('Enter');
	await view.locator('#status', { hasText: 'Sent to Ada, with a copy to you.' }).waitFor();
	console.log('  Enter in the note sent it, and the status region says so');

	await view.getByRole('button', { name: 'Clear the form' }).focus();
	await view.keyboard.press('Enter');
	await view.locator('#status', { hasText: 'Cleared.' }).waitFor();
	assert.equal(await view.getByLabel('To').inputValue(), '', 'the icon button is a named control the keyboard reaches');
	console.log('  the icon-only button is named, and Enter on it clears the form');

	await view.getByRole('button', { name: 'More' }).focus();
	await view.keyboard.press('Enter');
	await view.keyboard.press('ArrowDown');
	await view.keyboard.press('Enter');
	await view.locator('#picked', { hasText: 'schedule' }).waitFor();
	assert.equal(await view.evaluate(() => document.activeElement?.id), 'more', 'the focus is back on the menu button');
	console.log('  the menu opens, moves and picks from the keyboard, and gives the focus back');

	await view.getByRole('button', { name: 'Preview' }).focus();
	await view.keyboard.press('Enter');
	await view.getByRole('dialog', { name: 'Your note' }).waitFor();
	assert.ok(await view.evaluate(() => document.querySelector('dialog')?.matches(':modal')),
		'the dialog is modal, so the page behind it is out of reach');
	await view.keyboard.press('Escape');
	await view.getByRole('dialog').waitFor({ state: 'detached' });
	assert.equal(await view.evaluate(() => document.activeElement?.id), 'preview', 'Escape closes it and the focus returns');
	console.log('  the dialog names itself, takes the page out of reach, and Escape brings the focus back');

	// axe, in both colour schemes, over the page as it stands.
	for (const scheme of ['light', 'dark'] as const) {
		await view.emulateMedia({ colorScheme: scheme });
		const { violations, passes } = await audit(view);
		for (const violation of violations) console.error(`  axe ${violation.rule}: ${violation.help} at ${violation.nodes.map((node) => node.target).join(', ')}`);
		assert.deepEqual(violations, [], `axe finds nothing to fix in ${scheme}`);
		console.log(`  axe: ${String(passes)} rules pass in ${scheme}, no violation`);
	}

	// Tab, from the top: every control reached, each one ringed, none keeping the focus.
	const walked = await walk(view);
	for (const problem of walked.problems) console.error(`  walk ${problem.reason} at ${problem.target}: ${problem.fix}`);
	assert.deepEqual(walked.problems, [], 'the Tab walk finds nothing to fix');
	assert.deepEqual(walked.stops.map((stop) => stop.id), ['to', 'note', 'copy', 'send', 'clear', 'more', 'preview'],
		'and the stops are the controls, in reading order');
	console.log(`  Tab: ${String(walked.stops.length)} stops, every one with a ring, in reading order`);

	assert.deepEqual(problems, [], 'the page threw nothing and wrote no error to the console');
	assert.deepEqual(warnings, [], 'and the theme had no unreadable pair to warn about');
	await view.close();

	// --- the page written wrong, three ways --------------------------------------------------------

	console.log('\nthe page written wrong, and what says so');

	{
		const { view: page, problems: thrown } = await open('faults/no-language.html');
		await page.waitForLoadState('load');
		assert.equal(thrown.length, 1, 'the mount threw once');
		assert.match(thrown[0]!, /ui: the page declares no language: put lang="en"/);
		console.log('  no lang on <html>: the first mount throws, naming the fix');
		await page.close();
	}
	{
		const { view: page, problems: thrown } = await open('faults/nameless-button.html');
		await page.waitForLoadState('load');
		assert.equal(thrown.length, 1, 'the mount threw once');
		assert.match(thrown[0]!, /ui: a Button has nothing a screen reader can say/);
		assert.match(thrown[0]!, /a label on the Icon inside it/);
		console.log('  a Button that is only an icon: the mount throws, naming the three ways to name it');
		await page.close();
	}
	{
		const { view: page, problems: thrown, warnings: warned } = await open('faults/unreadable.html');
		await page.waitForSelector('#page');
		assert.deepEqual(thrown, [], 'neither the build nor the mount can see these two');
		// The theme did see the pair, because both colours are named, and said so in the console.
		assert.ok(warned.some((line) => /below the 4\.5:1 WCAG 2 AA target/.test(line)),
			`the theme warned about the pair: ${warned.join(' | ')}`);

		const { violations } = await audit(page);
		const contrast = violations.find((violation) => violation.rule === 'color-contrast');
		assert.ok(contrast !== undefined, `axe reports the pair: ${violations.map((v) => v.rule).join(', ')}`);
		assert.ok(contrast.nodes.some((node) => node.target === '#faint'));
		assert.ok(contrast.wcag.includes('wcag143'), 'and names the criterion, 1.4.3');
		console.log(`  grey on white: the theme warned in the console, and audit reports ${contrast.rule} (${contrast.wcag.join(', ')}) at #faint`);

		const { problems: found } = await walk(page);
		const stuck = found.find((problem) => problem.reason === 'focus-stuck');
		assert.ok(stuck !== undefined, `walk reports the trap: ${found.map((p) => p.reason).join(', ')}`);
		assert.equal(stuck.target, 'div#trap');
		assert.ok(found.some((problem) => problem.reason === 'unreachable' && problem.target === 'button#after'),
			'and the button past the trap as never reached');
		console.log(`  a box that keeps the focus: walk reports ${stuck.reason} at ${stuck.target}, and button#after unreachable`);
		await page.close();
	}
} finally {
	await browser.close();
	await site.close();
}

console.log(`
What this does not do for you: the criteria that need a person. Whether a colour is the only
thing carrying a meaning (1.4.1), whether the reading order is the meaning's order (1.3.2), a
heading that describes its section (2.4.6), a time limit someone can extend (2.2.1), navigation
that stays in the same place from page to page (3.2.3), and an error message that says what to
do (3.3.3). Write those, then run the audit and the walk over what you wrote.`);
console.log('recipes/accessible-page: done');
