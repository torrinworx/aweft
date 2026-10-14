// Both halves of an application in one directory, and the seam between them in development and
// in production.
//
// A page cannot reach a backend on another origin and keep a session: the cookie belongs to the
// origin that set it, so a socket opened somewhere else carries nothing. In development the
// answer is the dev server. It serves the page and forwards `/api` and `/ws` to the backend, so
// there is one origin and the page names no host at all. In production the backend is that
// origin: it serves what `vite build` wrote through the static battery, beside its socket.
//
// This starts the backend on a port of its own, starts that dev server against it, and drives
// the page in Chromium. Every check here can only pass through the proxy. The board's title
// arrives over the socket. The public ask and the search are answered over it. The server offers
// the pinned note on it when the page shares the note's name. Signing up sets a cookie on the dev
// server's origin, and the next socket carries that cookie to the gated module and the note.
// Then it builds the page, and the backend serves it on its own.
//
// It does not do password reset, and it does not do anything else a real application adds.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui AWEFT_TEXT=1 node --import @aweftjs/build/loader recipes/full-stack/main.ts

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { build, createServer } from 'vite';

import { audit, walk } from '@aweftjs/testing/browser';
import { dark, light } from '@aweftjs/ui';

const here = fileURLToPath(new URL('.', import.meta.url));

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// --- the backend, on a port nothing else is on ------------------------------------------------

// The boot file reads `PORT` the same way it does when an application starts it by hand, and 0
// asks the operating system for a free one. That is why it is imported here rather than above:
// importing it is what starts it.
process.env.PORT = '0';
const backend = await import('./backend/main.ts');
const backendPort = backend.listener.port!;
const backendOrigin = `http://127.0.0.1:${String(backendPort)}`;

// --- the dev server, with the backend behind it ------------------------------------------------

// The one thing the config file cannot know. A reader running `npx vite` sets it too, and its
// default there is the port the README tells them to start the backend on.
process.env.AWEFT_BACKEND_PORT = String(backendPort);

console.log('the dev server, with the backend behind it');
const configFile = join(here, 'page', 'vite.config.ts');
const dev = await createServer({
	configLoader: 'native', configFile,
	logLevel: 'warn',
	// A free port, so a run collides with nothing. `resolvedUrls` says which one it got.
	server: { port: 0 },
});
await dev.listen();
const origin = dev.resolvedUrls!.local[0]!;

// This process runs the stack's source, so the page has to get the same files and not a compiled
// `dist/` of whatever age (design 297).
const resolved = await dev.environments.client.pluginContainer.resolveId('@aweftjs/ui', join(here, 'page', 'entry.tsx'));
check(resolved?.id.replace(/\\/g, '/').endsWith('/packages/ui/src/index.ts') === true,
	`the page is served the stack's source, as this process runs it (got ${resolved?.id ?? 'nothing'})`);

/** The colour a theme gives the page, as a browser computes the six hex digits it is written in. */
const rgbOf = (mode: typeof light): string => {
	const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(mode['*']?.['$background']))!;
	return `rgb(${hex.slice(1).map((pair) => String(Number.parseInt(pair, 16))).join(', ')})`;
};

/** What the page paints behind itself and tells the phone, read off the live document. */
const painted = (view: Page) => view.evaluate(() => {
	const root = (globalThis as unknown as { document: { documentElement: unknown; querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document;
	const style = (globalThis as unknown as { getComputedStyle(e: unknown): { backgroundColor: string; colorScheme: string } }).getComputedStyle(root.documentElement);
	return { background: style.backgroundColor, scheme: style.colorScheme, meta: root.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null };
});

const items = (view: Page): Promise<string[]> => view.locator('#found li').allTextContents();

/** Wait for something the page or the server does on its own schedule, for at most five seconds. */
const until = async (ready: () => Promise<boolean>): Promise<void> => {
	for (const stop = Date.now() + 5000; Date.now() < stop; await new Promise((done) => setTimeout(done, 10))) {
		if (await ready()) return;
	}
};

// --- the page ------------------------------------------------------------------------------------

const browser = await chromium.launch();
const problems: string[] = [];
const watch = (view: Page): void => {
	view.on('pageerror', (error) => problems.push(String(error)));
	view.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });
};

try {
	// A visitor whose system is dark and who has never chosen.
	const context = await browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: 'dark' });
	const view = await context.newPage();
	watch(view);
	await view.goto(origin);
	await view.waitForSelector('#page');

	// Nothing on this page is in the markup: the title is on a document the server holds, and it
	// reaches the browser only over a socket the dev server forwarded.
	await view.locator('#board-title', { hasText: 'the notice board' }).waitFor();
	check(await view.textContent('#board-title') === 'the notice board',
		'the board arrived over the socket the dev server proxied');
	await view.locator('#notice', { hasText: 'the board is open to everyone' }).waitFor();
	check(await view.textContent('#notice') === 'the board is open to everyone',
		'and a public ask on the same socket was answered');

	await view.locator('#who', { hasText: 'nobody' }).waitFor();
	check(await view.textContent('#mine') === '', 'the connection is nobody, so the page asks the gated module nothing');

	// --- the mode, the face and the blocks --------------------------------------------------------

	console.log('\nthe visitor\'s mode, the page\'s face and its markdown');
	const first = await painted(view);
	check(first.scheme === 'dark' && first.background === rgbOf(dark) && first.meta === dark['*']?.['$background'],
		`a visitor who never chose gets the system's dark, behind the page and in the phone's bar (${JSON.stringify(first)})`);
	await view.click('#mode');
	const picked = await painted(view);
	check(picked.scheme === 'light' && picked.background === rgbOf(light), 'the switch moves the page to light');
	check(await view.evaluate(() => (globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem('mode')) === 'light',
		'and the choice is saved in the browser');
	await view.reload();
	await view.waitForSelector('#page');
	check((await painted(view)).scheme === 'light', 'a reload keeps the choice, though the system still says dark');

	// ui's components set their own font to `$font`, so the face is checked on two of them as well
	// as loaded: a face set only on the page's entry stops at the first field.
	const face = await view.evaluate(async () => {
		const page = globalThis as unknown as {
			document: { fonts: { ready: Promise<unknown>; check(font: string): boolean }; querySelector(selector: string): unknown };
			getComputedStyle(element: unknown): { fontFamily: string };
		};
		await page.document.fonts.ready;
		const first = (selector: string): string => {
			const element = page.document.querySelector(selector);
			return element === null ? 'missing' : page.getComputedStyle(element).fontFamily.split(',')[0]!.trim();
		};
		return { loaded: page.document.fonts.check('500 16px "IBM Plex Sans"'), button: first('#mode'), field: first('#page input') };
	});
	check(face.loaded && face.button === '"IBM Plex Sans"' && face.field === '"IBM Plex Sans"',
		`the page is set in its own face, declared by fontFaces, loaded from public/fonts and worn by ui's Button and TextField (${JSON.stringify(face)})`);

	const tip = await view.evaluate(() => {
		const element = (globalThis as unknown as { document: { getElementById(id: string): { parentElement: { localName: string } | null; textContent: string | null } | null } }).document.getElementById('tip');
		return element === null ? null : { parent: element.parentElement?.localName ?? null, text: element.textContent };
	});
	check(tip !== null && tip.parent === 'div' && /the list follows what you type/.test(String(tip.text)),
		`the tip block is the page's own aside inside the markdown, with no pre around it (${JSON.stringify(tip)})`);

	// --- the search follows its field -----------------------------------------------------------

	console.log('\na search that follows its field');
	await view.locator('#found li').first().waitFor();
	check((await items(view)).length === 3, 'an empty field asks for everything on the board');
	await view.getByLabel('Search the board').fill('chair');
	await view.waitForFunction(() => (globalThis as unknown as { document: { querySelectorAll(s: string): { length: number } } }).document.querySelectorAll('#found li').length === 2);
	check((await items(view)).join(' | ') === 'Bring a chair to the meeting | Chairs are back in the hall',
		'typing asks again, and the list is the answer to what the field holds now');
	await view.getByLabel('Search the board').fill('kitchen');
	await view.locator('#found li', { hasText: 'The kitchen closes at nine' }).waitFor();
	check((await items(view)).length === 1, 'and again');

	// --- the note the page asked for by name -------------------------------------------------------

	console.log('\na note the server offers when the page shares its name');
	// The store hands every opener in this process one object, so this is the document the
	// module offered.
	const stored = await backend.store.open('note:pinned');
	const held = stored.root as { text?: string };
	const noteField = view.getByLabel('Pinned note');
	await until(async () => await noteField.inputValue() !== '');
	check(await noteField.inputValue() === 'Nothing is written here yet.', 'notes/Note offered the note over the socket, with no call on the page');
	await noteField.fill('Chairs go back by nine');
	await until(async () => held.text === 'Chairs go back by nine');
	check(held.text === 'Chairs go back by nine', 'a write on the page lands in the document the server holds');

	// --- signing up ---------------------------------------------------------------------------

	console.log('\nsigning up through the page');
	await view.getByLabel('Email').fill('ada@example.com');
	await view.getByLabel('Password').fill('correct horse battery staple');
	await view.getByRole('button', { name: 'Sign in' }).click();

	// `POST /api/session` went through the HTTP half of the same proxy, and the cookie it set
	// belongs to the dev server's origin, because that is the origin the page asked from.
	await view.locator('#who', { hasText: 'signed in as ' }).waitFor();
	const who = String(await view.textContent('#who')).replace('signed in as ', '');
	const session = (await view.context().cookies()).find((cookie) => cookie.name === 'session');
	check(session !== undefined && session.domain === new URL(origin).hostname,
		'signing up set the session cookie on the origin the page came from');

	// A cookie cannot be set on an open socket, so the client reconnects after signing in. This
	// is the socket after that one, and its handshake is what read the cookie.
	await view.locator('#mine', { hasText: 'the board of ' }).waitFor();
	check(await view.textContent('#mine') === `the board of ${who}`,
		'and the socket after the reconnect carried it, so the gated module answered');

	// The socket the note was offered on is gone. Nothing on the page asked for it again: the
	// client shared the name on the new socket and the module offered it there, so a write the
	// server makes now reaches the page.
	held.text = 'Moved to Thursday';
	await until(async () => await noteField.inputValue() === 'Moved to Thursday');
	check(await noteField.inputValue() === 'Moved to Thursday', 'after the reconnect the note was offered again, onto the same page');
	await backend.store.close(stored);

	// A path under /api that nothing answers is the server's JSON 404 through the proxy, and never a page.
	const missing = await fetch(new URL('/api/nope', origin));
	const missed = await missing.text();
	check(missing.status === 404 && /"code":"not-found"/.test(missed),
		`a path under /api that nothing answers is a 404 in the server's JSON, through the proxy${missing.status === 404 ? '' : ` (${String(missing.status)} ${missed.slice(0, 80)})`}`);

	check(problems.length === 0, `the page threw nothing and wrote no error to the console${problems.length === 0 ? '' : `: ${problems.join(', ')}`}`);

	// --- can everyone use it ------------------------------------------------------------------

	// axe over the page as it stands, in both of its modes, and a Tab walk: every control reached,
	// every one showing a ring, none holding the focus. The build already refused what the source
	// settles; this is what only the rendered page can say.
	console.log('\nthe page, read the way a screen reader and a keyboard read it');
	for (const scheme of ['light', 'dark'] as const) {
		if ((await painted(view)).scheme !== scheme) await view.click('#mode');
		const { violations } = await audit(view);
		for (const violation of violations) console.log(`       ${violation.rule}: ${violation.help} at ${violation.nodes.map((node) => node.target).join(', ')}`);
		check(violations.length === 0, `axe finds nothing to fix in ${scheme}`);
	}
	const walked = await walk(view);
	for (const problem of walked.problems) console.log(`       ${problem.reason} at ${problem.target}: ${problem.fix}`);
	check(walked.problems.length === 0, `Tab reaches every control (${String(walked.stops.length)}), each one rings, and none keeps the focus`);
	await context.close();

	// --- production: the backend serves the built page itself ------------------------------------

	console.log('\nthe page built, and served by the backend on its own origin');
	await build({ configLoader: 'native', configFile, logLevel: 'warn' });
	const shell = await fetch(`${backendOrigin}/`);
	const html = await shell.text();
	const asset = /src="\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
	check(shell.status === 200 && asset !== undefined, 'the backend serves the page vite built');
	const script = await fetch(`${backendOrigin}/${asset ?? ''}`);
	await script.arrayBuffer();
	check(script.headers.get('cache-control') === 'public, max-age=31536000, immutable', 'and its bundle with the year-long cache its prefix names');
	const api = await fetch(`${backendOrigin}/api/nope`);
	check(api.status === 404 && api.headers.get('content-type') === 'application/json; charset=utf-8', 'and a path under /api it does not answer as JSON, not the page');
	await api.text();

	const built = await browser.newPage();
	watch(built);
	await built.goto(backendOrigin);
	await built.locator('#board-title', { hasText: 'the notice board' }).waitFor();
	check(await built.textContent('#board-title') === 'the notice board', 'the built page reaches the socket on the origin it came from');
	// A visitor who chose dark, on a system that says light, reloads with the bundle held back.
	// What shows then is the HTML shell alone, and it paints the saved mode, not the browser's
	// default canvas.
	const saved = await browser.newContext({ colorScheme: 'light' });
	const early = await saved.newPage();
	watch(early);
	await early.goto(backendOrigin);
	await early.locator('#page').waitFor();
	await early.evaluate(() => { (globalThis as unknown as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem('mode', 'dark'); });
	let release: () => void = () => {};
	const bundle = new Promise<void>((done) => { release = done; });
	await early.route('**/assets/*.js', async (route) => { await bundle; await route.continue(); });
	await early.reload({ waitUntil: 'commit' });
	await early.waitForFunction(() => (globalThis as unknown as { document: { body: unknown } }).document.body !== null);
	const before = await painted(early);
	const bare = await early.evaluate(() => (globalThis as unknown as { document: { getElementById(id: string): unknown } }).document.getElementById('page') === null);
	release();
	check(bare && before.scheme === 'dark' && before.background === rgbOf(dark),
		`before the bundle runs, a saved dark reload shows the dark background, set by the shell's own script (${JSON.stringify({ bare, ...before })})`);
	await early.locator('#page').waitFor();
	await saved.close();

	check(problems.length === 0, `the built page threw nothing either${problems.length === 0 ? '' : `: ${problems.join(', ')}`}`);
} finally {
	await browser.close();
	await dev.close();
	await backend.server.stop();
	await backend.store.stop();
}

console.log(`\n${String(checks - failed)}/${String(checks)} checks passed`);
if (failed > 0) process.exitCode = 1;
