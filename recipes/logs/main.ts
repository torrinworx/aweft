// The logs battery under the gate: a page is recorded end to end, and the visit is read back
// through the readers. Every check reads a visit document the page filled over HTTP while the
// board it shared came over the socket.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/logs/main.ts

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

import { errors, visit } from '@aweftjs/logs';

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

// --- the dev server, with the backend behind it ----------------------------------------------

const dev = await createViteServer({
	configFile: join(here, 'page', 'vite.config.ts'),
	logLevel: 'warn',
	server: { port: 0 },
});
await dev.listen();
const origin = dev.resolvedUrls!.local[0]!;

// --- the page --------------------------------------------------------------------------------

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 700 } });
const password = 'zQpw77neverstored';

try {
	await view.goto(origin);
	await view.waitForSelector('#page');
	// The board arrived over the socket the dev server proxied, which is also when the recorder
	// told the server this visit's id.
	await view.locator('#board-title', { hasText: 'the board' }).waitFor();

	// A failed server call, and the page's own error, rejection and console.
	await view.click('#boom');
	await view.evaluate(() => { setTimeout(() => { throw new Error('a page error'); }, 0); });
	await view.evaluate(() => { void Promise.reject(new Error('an unhandled rejection')); });
	await view.evaluate(() => { console.error('a console error'); });

	// Sign in: fill sets the values with no keystroke, so a typed character is never in the log.
	// Enter on the email field is a non-character key, which is recorded; the password field
	// gives up no key at all.
	await view.locator('input').first().fill('ada@example.com');
	await view.locator('input').first().press('Enter');
	await view.locator('input[type=password]').pressSequentially(password);
	await view.locator('input').first().fill('ada@example.com');
	await view.locator('input[type=password]').fill(password);
	await view.click('#sign-in');
	await view.locator('#who', { hasText: 'signed in as' }).waitFor();

	// A write the server takes (note, and a private slot), and a removal it refuses.
	await view.click('#write');
	await view.click('#remove');

	// Send everything, then read the id and end the visit.
	await view.evaluate(() => (globalThis as unknown as { __log: { flush(): Promise<void> } }).__log.flush());
	const id = await view.evaluate(() => (globalThis as unknown as { __log: { visit: string } }).__log.visit);
	await view.evaluate(() => (globalThis as unknown as { dispatchEvent(e: unknown): void; Event: new (t: string) => unknown }).dispatchEvent(new (globalThis as unknown as { Event: new (t: string) => unknown }).Event('pagehide')));
	await new Promise((done) => setTimeout(done, 300));

	const seen = await visit(backend.store, id);
	const kinds = new Set((seen?.entries ?? []).map((entry) => String(entry.kind)));
	const text = JSON.stringify(seen);

	check(seen !== undefined, 'the visit was recorded');
	check(kinds.has('error'), 'a page error was recorded');
	check(kinds.has('rejection'), 'an unhandled rejection was recorded');
	check(kinds.has('console'), 'a console error was recorded');
	check((seen?.entries ?? []).some((e) => e.kind === 'ask' && e.name === 'board/Boom' && e.ok === false), 'the failed ask was recorded on the page');
	check((seen?.entries ?? []).some((e) => e.kind === 'call' && e.name === 'board/Boom' && e.ok === false), 'the failed call was recorded on the server side, in the same visit');
	check((seen?.entries ?? []).some((e) => e.kind === 'commit' && String(e.paths).includes('note')), 'the write was recorded as a commit naming note');
	check((seen?.entries ?? []).some((e) => e.kind === 'refused'), 'the refused removal was recorded');
	check((seen?.entries ?? []).some((e) => e.kind === 'input' && e.key === 'Enter'), 'a non-character key was recorded');
	check(!(seen?.entries ?? []).some((e) => e.kind === 'input' && typeof e.key === 'string' && e.key.length === 1), 'no character key was ever recorded');
	check(!text.includes(password), 'no typed password character is anywhere in the visit');
	check(!text.includes('do not record me'), 'the private _secret slot is not in any commit');
	check(seen?.user !== null && seen?.user !== undefined, 'the visit carries the signed-in user');
	check(seen?.build === 'recipe-1', 'the build is on the visit');
	check(seen?.browser?.ua !== null && seen?.browser?.ua !== undefined, 'the browser facts were recorded');
	check(seen?.endedAt !== null, 'pagehide ended the visit');

	const grouped = await errors(backend.store, {});
	check(grouped.some((group) => group.message.includes('page error') && group.count >= 1), 'errors() groups the page error with a count');
} finally {
	await browser.close();
	await dev.close();
	await backend.server.stop();
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
