// Both halves of an application in one directory, and the seam between them in development.
//
// A page cannot reach a backend on another origin and keep a session: the cookie belongs to the
// origin that set it, so a socket opened somewhere else carries nothing. In development the
// answer is the dev server. It serves the page and forwards `/api` and `/ws` to the backend, so
// there is one origin and the page names no host at all.
//
// This starts the backend on a port of its own, starts that dev server against it, and drives
// the page in Chromium. Every check here can only pass through the proxy: the board's title
// arrives over the socket, the public ask is answered over it, and signing up sets a cookie on
// the dev server's origin that the socket after it carries to the gated module.
//
// It does not do production serving: the proxy is development only, and in production the server
// serves the built `dist/` itself, the way `recipes/client` does, or a static host does. It does
// not do password reset, and it does not do anything else a real application adds.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/full-stack/main.ts

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { createServer } from 'vite';

import { audit, walk } from '@aweftjs/testing/browser';

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

// --- the dev server, with the backend behind it ------------------------------------------------

// The one thing the config file cannot know. A reader running `npx vite` sets it too, and its
// default there is the port the README tells them to start the backend on.
process.env.AWEFT_BACKEND_PORT = String(backendPort);

console.log('the dev server, with the backend behind it');
const dev = await createServer({
	configFile: join(here, 'page', 'vite.config.ts'),
	logLevel: 'warn',
	// A free port, so a run collides with nothing. `resolvedUrls` says which one it got.
	server: { port: 0 },
});
await dev.listen();
const origin = dev.resolvedUrls!.local[0]!;

// --- the page ------------------------------------------------------------------------------------

const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 700 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));
view.on('console', (message) => { if (message.type() === 'error') problems.push(message.text()); });

try {
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

	// --- signing up ---------------------------------------------------------------------------

	console.log('\nsigning up through the page');
	await view.getByLabel('Email').fill('ada@example.com');
	await view.getByLabel('Password').fill('correct horse battery staple');
	await view.getByRole('button', { name: 'Sign in' }).click();

	// `POST /api/session` went through the HTTP half of the same proxy, and the cookie it set
	// belongs to the dev server's origin, because that is the origin the page asked from.
	await view.locator('#who', { hasText: 'signed in as ' }).waitFor();
	const who = String(await view.textContent('#who')).replace('signed in as ', '');
	const session = (await view.context().cookies()).find((held) => held.name === 'session');
	check(session !== undefined && session.domain === new URL(origin).hostname,
		'signing up set the session cookie on the origin the page came from');

	// A cookie cannot be set on an open socket, so the client reconnects after signing in. This
	// is the socket after that one, and its handshake is what read the cookie.
	await view.locator('#mine', { hasText: 'the board of ' }).waitFor();
	check(await view.textContent('#mine') === `the board of ${who}`,
		'and the socket after the reconnect carried it, so the gated module answered');
	check(problems.length === 0, `the page threw nothing and wrote no error to the console${problems.length === 0 ? '' : `: ${problems.join(', ')}`}`);

	// --- can everyone use it ------------------------------------------------------------------

	// axe over the page as it stands, in both colour schemes, and a Tab walk: every control reached,
	// every one showing a ring, none holding the focus. The build already refused what the source
	// settles; this is what only the rendered page can say.
	console.log('\nthe page, read the way a screen reader and a keyboard read it');
	for (const scheme of ['light', 'dark'] as const) {
		await view.emulateMedia({ colorScheme: scheme });
		const { violations } = await audit(view);
		for (const violation of violations) console.log(`       ${violation.rule}: ${violation.help} at ${violation.nodes.map((node) => node.target).join(', ')}`);
		check(violations.length === 0, `axe finds nothing to fix in ${scheme}`);
	}
	const walked = await walk(view);
	for (const problem of walked.problems) console.log(`       ${problem.reason} at ${problem.target}: ${problem.fix}`);
	check(walked.problems.length === 0, `Tab reaches every control (${String(walked.stops.length)}), each one rings, and none keeps the focus`);
} finally {
	await browser.close();
	await dev.close();
	await backend.server.stop();
	await backend.store.stop();
}

console.log(`\n${String(checks - failed)}/${String(checks)} checks passed`);
if (failed > 0) process.exitCode = 1;
