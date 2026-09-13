// The room on the page under the gate: an act module stored on the server runs in a frame on
// the page, shares the board both ways, asks through the page's identity, routes on the page's
// URL, and what goes wrong inside reaches the page as data. Every check is made through a real
// browser, because no fake DOM enforces a frame's isolation.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/room/main.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Frame, chromium } from 'playwright';
import { build, createServer as createViteServer } from 'vite';

import { errors } from '@aweftjs/logs';

// These run inside the browser, where tsc has no DOM lib. Declared loosely so the file
// typechecks in Node; the browser supplies the real ones.
declare const document: { getElementById(id: string): unknown };
declare const location: { origin: string };
declare function getComputedStyle(element: unknown): { paddingLeft: string };

const here = fileURLToPath(new URL('.', import.meta.url));

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// --- the backend, on a free port -------------------------------------------------------------

process.env.PORT = '0';
const backend = await import('./backend/main.ts');
process.env.AWEFT_BACKEND_PORT = String(backend.listener.port);

// --- the room bundle, then the dev server with the backend behind it ---------------------------

await build({ configFile: join(here, 'page', 'room.config.ts'), logLevel: 'warn' });
const bundle = join(here, 'page', 'public', 'room');
const files = readdirSync(bundle).filter((name) => name.endsWith('.js'));
const bytes = files.reduce((sum, name) => sum + statSync(join(bundle, name)).size, 0);
const zipped = files.reduce((sum, name) => sum + gzipSync(readFileSync(join(bundle, name))).length, 0);
console.log(`  --   the room bundle: ${String(files.length)} files, ${String(bytes)} bytes, ${String(zipped)} bytes gzipped`);

const dev = await createViteServer({
	configFile: join(here, 'page', 'vite.config.ts'),
	logLevel: 'warn',
	server: { port: 0 },
});
await dev.listen();
const origin = dev.resolvedUrls!.local[0]!.replace(/\/$/, '');

// --- the page --------------------------------------------------------------------------------

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 700 } });
const pageErrors: string[] = [];
view.on('pageerror', (error) => pageErrors.push(error.message));

const inside = (): Frame => {
	const frame = view.frames().find((one) => one !== view.mainFrame());
	if (frame === undefined) throw new Error('no frame on the page');
	return frame;
};
const roomState = (): Promise<{ errors: { kind: string; message: string; module?: string }[]; lines: [string, string][]; visit: string }> =>
	view.evaluate(() => {
		const held = (globalThis as unknown as { __room: { errors: unknown[]; lines: unknown[]; visit: string } }).__room;
		return JSON.parse(JSON.stringify({ errors: held.errors, lines: held.lines, visit: held.visit }));
	});

try {
	await view.goto(origin);
	await view.locator('#home').waitFor();
	await view.locator('input').first().fill('ada@example.com');
	await view.locator('input[type=password]').fill('zQpw77neverstored');
	await view.click('#sign-in');
	await view.locator('#who', { hasText: 'signed in as' }).waitFor();
	const who = (await view.locator('#who').textContent())!.replace('signed in as ', '');

	// The act renders in the frame, from the module document the server holds.
	await view.click('#open-app');
	const frame = view.frameLocator('#app iframe');
	await frame.locator('#board-title', { hasText: 'the board' }).waitFor();
	check(await view.locator('#app iframe').count() === 1, 'the act renders inside the frame, on the board the server shared');
	check(await frame.locator('#first').isVisible(), 'the room\'s stage is on its index');

	// A write inside the frame reaches the server's copy, and the module's call reads it back
	// with the page's identity.
	await frame.locator('#write').click();
	await frame.locator('#ask').click();
	await frame.locator('#asked', { hasText: 'wrote written in the room' }).waitFor();
	check((await frame.locator('#asked').textContent()) === `${who} wrote written in the room`, 'the board written in the room reached the server, and the ask answered with the signed-in user');
	await frame.locator('#ask-secret').click();
	await frame.locator('#refusal', { hasText: 'refused' }).waitFor();
	check(true, 'an ask of a name not granted is refused inside');

	// The act's own stage navigates: the address bar follows, back returns, a deep link opens deep.
	await frame.locator('#go-second').click();
	await frame.locator('#second').waitFor();
	await view.waitForURL(`${origin}/app/7/second`);
	check(view.url() === `${origin}/app/7/second`, 'a navigation inside the room is the page\'s URL, under the host act');
	await view.goBack();
	await frame.locator('#first').waitFor();
	check(view.url() === `${origin}/app/7`, 'the browser\'s back returns the act to its first screen');
	await view.goto(`${origin}/app/7/second`);
	await view.frameLocator('#app iframe').locator('#second').waitFor();
	check(true, 'a deep link opens the room on its second screen');
	check(await inside().evaluate(() => location.origin) === 'null', 'the frame\'s origin is opaque');
	await view.frameLocator('#app iframe').locator('#go-first').click();
	await view.frameLocator('#app iframe').locator('#first').waitFor();

	// What leaves the room as data: an error attributed to the act, recorded by the page's logs;
	// a warning crosses and a log line does not.
	await view.frameLocator('#app iframe').locator('#boom').click();
	await view.waitForFunction(() => (globalThis as unknown as { __room: { errors: unknown[] } }).__room.errors.length === 1);
	await view.frameLocator('#app iframe').locator('#warn').click();
	await view.waitForFunction(() => (globalThis as unknown as { __room: { lines: unknown[] } }).__room.lines.length === 1);
	const state = await roomState();
	const first = state.errors[0];
	check(first?.kind === 'error' && first.message === 'Error: the act blew up' && first.module === 'app/Main', `the click that threw reached handlers.error naming the act: ${JSON.stringify({ kind: first?.kind, message: first?.message, module: first?.module })}`);
	check(state.lines.length === 1 && state.lines[0]![0] === 'warn' && state.lines[0]![1] === 'a warning from the room', `console.warn crossed and console.log did not: ${JSON.stringify(state.lines)}`);
	await view.evaluate(() => (globalThis as unknown as { __room: { flush(): Promise<void> } }).__room.flush());
	const grouped = await errors(backend.store, {});
	check(grouped.some((group) => group.message === 'Error: the act blew up' && group.count >= 1), 'errors() reads the room\'s error back from the logs battery');

	// The frame may paint and may not reach out: an image from an origin not in allow fails, an
	// inline style applies, fetch is refused.
	const picture = await inside().evaluate(() => {
		const img = document.getElementById('picture') as { complete: boolean; naturalWidth: number };
		const styled = document.getElementById('styled')!;
		return { complete: img.complete, width: img.naturalWidth, padding: getComputedStyle(styled).paddingLeft };
	});
	check(picture.complete && picture.width === 0, `an image from an origin not in allow fails to load: ${JSON.stringify(picture)}`);
	check(picture.padding === '7px', 'an inline style applies');
	await view.frameLocator('#app iframe').locator('#fetch').click();
	await view.frameLocator('#app iframe').locator('#fetched', { hasText: 'TypeError' }).waitFor();
	check(true, 'fetch inside is refused');

	// Leaving the act removes the frame and stops the room.
	await view.click('#leave');
	await view.locator('#home').waitFor();
	check(await view.locator('iframe').count() === 0, 'leaving the act removes the frame');
	check(view.frames().length === 1, 'and nothing of the room is left on the page');
	check(pageErrors.every((message) => message === 'the act blew up'), `nothing but the act\'s own throw escaped: ${pageErrors.join('; ')}`);
} finally {
	await browser.close();
	await dev.close();
	await backend.server.stop();
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
