// The proof for @aweftjs/client and the auth battery's client half: a small application.
//
// Two halves, one server. In Node: someone opens an app, shares a document and asks a module
// before the socket is open, learns it is nobody, signs up, gets its own state document, and
// keeps working while the server is restarted underneath it. Then in Chromium: the same server
// serves a real page whose every part is a module. A visit to a gated URL while anonymous shows
// the battery's sign-in form, a sign-up through that form makes the page somebody, and the gated
// act renders over the document the page shares. The battery's two mail acts land on `/verify`
// and `/reset`: the reset form mails a link, the link's page sets the password, the verify page
// mails and takes its link, and the name `verified` reaches the page with no reload.
//
// A browser needs no seams for the Node half. Node needs two, and only two: a socket that
// carries the cookie header, and a fetch that keeps the cookie, because Node's keeps none.
//
// Run: node --import @aweftjs/build/loader recipes/client/main.ts

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { chromium } from 'playwright';

import { createAuth } from '@aweftjs/auth/client';
import type { FetchInit, FetchResponse } from '@aweftjs/auth/client';
import { auth, mail, paths } from '@aweftjs/auth';
import type { AuthContext } from '@aweftjs/auth';
import { createClient } from '@aweftjs/client';
import { createObject, observer } from '@aweftjs/core';
import { fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { RequestError, SocketLike } from '@aweftjs/sync';
import { audit, walk } from '@aweftjs/testing/browser';

const here = fileURLToPath(new URL('.', import.meta.url));

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const after = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const until = async (ready: () => boolean, what: string): Promise<void> => {
	const stop = Date.now() + 20_000;
	while (!ready()) {
		if (Date.now() > stop) throw new Error(`${what} was still false after 20 s`);
		await after(10);
	}
};
const reasonOf = (error: unknown): string => String((error as RequestError).reason);

type State = { theme?: string; badge?: string };
type Board = { title: string };

// The application's own document, one copy for the whole server, offered to every connection.
const board = createObject<Board>({ title: 'the notice board' });

// --- the built page, served by the application's own server ---------------------------------

// The page is served from the server it talks to, because a cookie belongs to an origin: a
// sign-up on one origin sets nothing for a socket on another.
console.log('building the page through aweft()');
await build({ configFile: join(here, 'vite.config.ts'), logLevel: 'warn' });

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Every route the built page needs: its assets by name, and the shell on each of its URLs. */
const pageRoutes = (): Record<string, () => Promise<Response>> => {
	const dist = join(here, 'dist');
	const answer = (body: Buffer, type: string) => async (): Promise<Response> =>
		new Response(new Uint8Array(body), { headers: { 'content-type': type } });
	const routes: Record<string, () => Promise<Response>> = {};
	for (const name of readdirSync(join(dist, 'assets'))) {
		routes[`GET /assets/${name}`] = answer(readFileSync(join(dist, 'assets', name)), TYPES[extname(name)] ?? 'text/plain');
	}
	const shell = readFileSync(join(dist, 'index.html'));
	// The application knows its own URLs, because they are the keys of its acts map.
	for (const url of ['/', '/notes', '/join', '/verify', '/reset', '/nowhere']) routes[`GET ${url}`] = answer(shell, 'text/html');
	return routes;
};

// --- the application's own modules ---------------------------------------------------------

const app = fromBundle({
	// Public: anyone reads the notice, signed in or not.
	'./notes/Notice.ts': { default: () => ({ public: true, call: () => 'the notice of the day' }) },
	// Private: only a signed-in connection reaches it, and it answers with who asked.
	'./notes/Mine.ts': { default: () => ({ call: (_args: unknown, context: AuthContext) => `notes for ${String(context.user)}` }) },
	// Public too, and it shares a document rather than answering a call.
	'./notes/Board.ts': { default: () => ({ public: true, connection: ({ link }: Connection<AuthContext>) => { link.share('board', board, open); } }) },
	// The page itself, so the browser half loads it from the same origin as its socket.
	'./site/Files.ts': { default: () => ({ public: true, routes: pageRoutes() }) },
	// The mailer the two mail modules name: a stand-in for notify/Send that keeps every mail.
	'./notify/Send.ts': { default: () => ({ send: async (options: { to: { user: string }; body: string }) => { mails.push(options); return { delivery: { email: { ok: true } } }; } }) },
	// Where the mail links point: the two acts' addresses on this page. A battery picks no URL.
	'./auth/Verify.ts': { config: { url: (token: string) => `/verify?token=${token}`, resendMs: 1 } },
	'./auth/Password.ts': { config: { url: (token: string) => `/reset?token=${token}` } },
});

/** Every mail the stand-in was asked to send. */
const mails: { to: { user: string }; body: string }[] = [];
const linkIn = (body: string): string => body.slice(body.indexOf('token=') + 'token='.length);

// --- the server, and the store both it and this program read ---------------------------------

const driver = memoryDriver();
const store = createStore({ driver, declare: { ...paths } });
const boot = { sources: [app, auth, mail], store, gate: 'auth/Gate' } as const;
const first = node({ port: 0, host: '127.0.0.1' });
let server = createServer({ ...boot, listener: first });
await server.start();
const port = first.port!;
const http = `http://127.0.0.1:${String(port)}`;

// --- the two seams a browser would not need --------------------------------------------------

// The browser's cookie jar, as one variable. The socket seam reads it on its way out and the
// fetch seam writes it, which is the whole of what a browser does for free.
let cookie = '';

const openSocket = (url: string): SocketLike => {
	// Node's own WebSocket sends headers handed to it here; a browser's takes no second argument
	// and needs none, because it attaches the cookie itself.
	const init = cookie === '' ? undefined : { headers: { cookie } };
	return new WebSocket(url, init as unknown as string[]) as unknown as SocketLike;
};

const fetchWithCookie = async (url: string, init: FetchInit): Promise<FetchResponse> => {
	const answer = await fetch(url, {
		method: init.method,
		headers: { ...init.headers, ...(cookie === '' ? {} : { cookie }) },
		...(init.body === undefined ? {} : { body: init.body }),
	});
	const set = answer.headers.getSetCookie()[0];
	if (set !== undefined) cookie = set.split(';')[0]!;
	return answer;
};

// --- the page --------------------------------------------------------------------------------

console.log('a page against a real server');
const client = createClient({ url: `ws://127.0.0.1:${String(port)}/`, open: openSocket });
const identity = createAuth(client, { origin: http, fetch: fetchWithCookie });

// All three written while the socket is still connecting, and the server speaks first.
const notice = client.ask('notes/Notice');
const shared = client.share<Board>('board');
const anonymousState = identity.state<State>();
check(await notice === 'the notice of the day', 'an ask made before the socket opened was answered');
check((await shared.ready).title === 'the notice board', 'and so did a share made before it opened');

await until(() => identity.user.get() !== undefined, 'the first answer');
check(identity.user.get() === null, 'the connection is nobody, and the page was told so');
check(await anonymousState.ready.then(() => 'shared', reasonOf) === 'anonymous',
	'a state document asked for before the answer is refused, not left waiting');
check(await client.ask('notes/Mine').catch(reasonOf) === 'refused', 'and a private module refuses it');

// --- signing up --------------------------------------------------------------------------------

console.log('\nsigning up');
const entered = await identity.enter('ada@example.com', 'correct horse battery staple');
check('user' in entered && entered.created === true, 'signing up made an account');
const ada = (entered as { user: string }).user;
check(identity.user.get() === ada, 'and the page reads the id off the connection it reconnected on');
check(await client.ask('notes/Mine') === `notes for ${ada}`, 'the private module answers the signed-in connection');

const held = identity.state<State>();
const document = await held.ready;
document.theme = 'dark';
await after(50);
const kept = await store.open(`state:${ada}`);
check((kept.root as State).theme === 'dark', 'a write to the state document reached the store');
await store.close(kept);

// --- the server goes away, and the page comes back on its own -----------------------------------

console.log('\nthe server restarts under the page');
const badges: unknown[] = [];
observer(document).path('badge').effect((value) => badges.push(value));

await server.stop();
await until(() => client.status.get() === 'closed', 'the drop');
check(client.status.get() === 'closed', 'the page saw the connection close');

// Written into the user's state while nothing was connected, through the store the server reads.
const away = await store.open(`state:${ada}`);
(away.root as State).badge = 'written while the page was down';
await store.settled(away);
await store.close(away);

// An ask made with no socket anywhere waits for the next one.
const late = client.ask('notes/Notice');

const second = node({ port, host: '127.0.0.1' });
server = createServer({ ...boot, listener: second });
await server.start();

await until(() => client.status.get() === 'open', 'the reconnect');
check(held.document === document, 'the page holds the same state object it always held');
await until(() => document.badge === 'written while the page was down', 'the resync');
check(badges.map(String).join('|') === 'undefined|written while the page was down',
	'and the reconnect reached a watcher as an ordinary change');
check(await late === 'the notice of the day', 'the ask made while it was down went out on the new socket');
check(await client.ask('notes/Mine') === `notes for ${ada}`, 'and the new connection carried the cookie, so it is still Ada');

// --- signing out, and back in --------------------------------------------------------------------

console.log('\nsigning out, and back in');
await identity.leave();
check(identity.user.get() === null, 'signing out left the page anonymous');
check(await identity.state<State>().ready.then(() => 'shared', reasonOf) === 'anonymous',
	'and there is no state document to share');
check(await client.ask('notes/Mine').catch(reasonOf) === 'refused', 'the private module refuses it again');

const back = await identity.enter('ada@example.com', 'correct horse battery staple');
check('user' in back && back.created === false && back.user === ada, 'signing back in is the same account, not a new one');
const again = identity.state<State>();
const document2 = await again.ready;
check(document2 !== document, 'a new connection is a new handle');
check(document2.theme === 'dark' && document2.badge === 'written while the page was down',
	'holding everything written into the state before');
check(await identity.check('ada@example.com') && !(await identity.check('nobody@example.com')),
	'and auth/Check answers a form asking before it asks for a password');

identity.stop();
client.close();

// --- the same server, and a real page in a real browser ------------------------------------------

console.log('\nthe page in Chromium');
const browser = await chromium.launch();
const view = await browser.newPage({ viewport: { width: 900, height: 700 } });
const problems: string[] = [];
view.on('pageerror', (error) => problems.push(String(error)));

/** What the page's modules recorded, in order. */
const trace = (): Promise<string[]> =>
	view.evaluate(() => (globalThis as unknown as { aweftTrace?: string[] }).aweftTrace ?? []);

const audited = async (what: string): Promise<void> => {
	const found = await audit(view);
	for (const violation of found.violations) {
		console.error(`  axe ${violation.rule}: ${violation.help}`);
		for (const node of violation.nodes) console.error(`    ${node.html}`);
	}
	check(found.violations.length === 0, `axe found nothing to fix on ${what}`);
};

/** Every state of the page reachable by keyboard: the walk comes back round with no problem. */
const walked = async (what: string): Promise<void> => {
	const found = await walk(view);
	for (const problem of found.problems) console.error(`  walk ${problem.reason} at ${problem.target}: ${problem.fix}`);
	check(found.problems.length === 0, `a keyboard walk over ${what} found nothing to fix`);
};

try {
	// A gated URL while nobody: the act's own gate module throws, and `refused` puts the
	// battery's form on the page the visitor asked for. The address bar does not move.
	await view.goto(`${http}/notes`);
	await view.waitForSelector('form[aria-label="Sign in"]');
	check(new URL(view.url()).pathname === '/notes', 'a gated page while anonymous keeps its URL');
	check(await view.$('#notes') === null, 'and shows the sign-in act instead of the page');
	await audited('the sign-in form in light mode');
	await walked('the sign-in form');

	// The whole form is one act, and signing up through it is the same call as signing in. The
	// form still picks no URL: on success it calls the `retry` the stage handed it, so the act
	// this URL chose is built again where it stands (designs 244, 245). Nobody navigates.
	await view.fill('input[name="email"]', 'grace@example.com');
	await view.fill('input[name="password"]', 'correct horse battery staple');
	await view.click('form[aria-label="Sign in"] button');
	await view.waitForSelector('#notes');
	check(new URL(view.url()).pathname === '/notes', 'the gated page came back at the URL that was refused');
	check(await view.$('form[aria-label="Sign in"]') === null, 'and the form is gone');
	check(await view.textContent('#notes-title') === 'the notice board',
		'the gated act loaded, over the document the page shares');
	const grace = String(await view.textContent('#notes-user'));

	// The public act reads the same auth/Session instance the gated one does.
	await view.click('#to-home');
	await view.waitForSelector('#home');
	await view.waitForFunction(() => /^signed in as ./.test(
		(globalThis as unknown as { document: { getElementById(id: string): { textContent: string } | null } })
			.document.getElementById('who')?.textContent ?? ''));
	check(await view.textContent('#who') === `signed in as ${grace}`,
		'signing up through the form set the cookie, and both acts read the one session');

	// The same URL again, this time by clicking a link.
	await view.click('#to-notes');
	await view.waitForSelector('#notes');
	check(await view.textContent('#notes-user') === grace, 'the second visit is the same person');

	// Leaving the act stops it. The document it depended on stays, because the next page may
	// want it and it was never this act's to close (design 242).
	await view.click('#to-home');
	await view.waitForSelector('#home');
	const afterLeaving = await trace();
	check(afterLeaving.includes('notes/Page stopped'), 'leaving the act ran its stop');
	check(!afterLeaving.includes('notes/Current stopped'), 'and the module it depended on stayed loaded');
	check(afterLeaving.filter((line) => line === 'notes/Current opened').length === 1,
		'so a second visit shares no second document');

	await view.click('#to-notes');
	await view.waitForSelector('#notes');
	check((await trace()).filter((line) => line === 'notes/Current opened').length === 1,
		'and the visit after that reused it');

	// The page going away is what unloads the rest, in reverse load order.
	await view.evaluate(() => { (globalThis as unknown as { unmountApp: () => void }).unmountApp(); });
	const afterUnmount = await trace();
	check(afterUnmount.includes('notes/Current stopped'), 'taking the page down closed the share');
	check(afterUnmount.indexOf('notes/Page stopped') < afterUnmount.lastIndexOf('notes/Current stopped'),
		'and it stopped the act before the module underneath it');

	check(problems.length === 0, `the page threw nothing${problems.length === 0 ? '' : `: ${problems.join(', ')}`}`);

	// --- the two mail acts, on the addresses this page named them at --------------------------

	// Forgot, while anonymous: the form takes an address, and the link the mail carries opens the
	// same act with a token, which is the new-password form.
	await view.goto(`${http}/reset`);
	await view.waitForSelector('form[aria-label="Reset your password"]');
	await audited('the forgot form');
	await walked('the forgot form');
	await view.fill('input[name="email"]', 'grace@example.com');
	await view.click('form[aria-label="Reset your password"] button');
	await view.waitForFunction(() => /link is on its way/.test(
		(globalThis as unknown as { document: { body: { textContent: string } } }).document.body.textContent));
	check(mails.length === 1, 'the forgot form mailed one link through the mailer the server was given');
	await view.goto(`${http}/reset?token=${linkIn(mails[0]!.body)}`);
	await view.waitForSelector('input[name="password"]');
	await audited('the new-password form');
	await view.fill('input[name="password"]', 'a new horse battery');
	await view.click('form[aria-label="Reset your password"] button');
	await view.waitForFunction(() => /Your password is set/.test(
		(globalThis as unknown as { document: { body: { textContent: string } } }).document.body.textContent));
	check(true, 'the link\'s page set the password');

	// Every session is over, so the gated page is behind the form again, and the new password opens it.
	await view.goto(`${http}/notes`);
	await view.waitForSelector('form[aria-label="Sign in"]');
	await view.fill('input[name="email"]', 'grace@example.com');
	await view.fill('input[name="password"]', 'a new horse battery');
	await view.click('form[aria-label="Sign in"] button');
	await view.waitForSelector('#notes');
	check(await view.textContent('#notes-user') === grace, 'and the new password signs the same person in');

	// Verify, while signed in: the button mails the link, and opening it grants `verified`, which
	// the page reads off the roles share with no reload.
	await view.goto(`${http}/verify`);
	await view.waitForSelector('section[aria-label="Verify your email"] button:not([disabled])');
	await audited('the verify page');
	await walked('the verify page');
	await view.click('section[aria-label="Verify your email"] button');
	await view.waitForFunction(() => /on its way/.test(
		(globalThis as unknown as { document: { body: { textContent: string } } }).document.body.textContent));
	check(mails.length === 2 && mails[1]!.to.user === grace, 'the verify page mailed the signed-in person a link');
	await view.goto(`${http}/verify?token=${linkIn(mails[1]!.body)}`);
	await view.waitForFunction(() => /is verified/.test(
		(globalThis as unknown as { document: { body: { textContent: string } } }).document.body.textContent));
	await view.click('#to-home');
	await view.waitForSelector('#home');
	await view.waitForFunction(() => /holds verified/.test(
		(globalThis as unknown as { document: { getElementById(id: string): { textContent: string } | null } })
			.document.getElementById('names')?.textContent ?? ''));
	check(await view.textContent('#names') === 'holds verified', 'and the page holds the name, read off the roles share');

	// The same forms, with the operating system asking for dark.
	await view.emulateMedia({ colorScheme: 'dark' });
	await view.goto(`${http}/join`);
	await view.waitForSelector('form[aria-label="Sign in"]');
	await audited('the sign-in form in dark mode');
	await view.goto(`${http}/reset`);
	await view.waitForSelector('form[aria-label="Reset your password"]');
	await audited('the forgot form in dark mode');
	await view.goto(`${http}/verify`);
	await view.waitForSelector('section[aria-label="Verify your email"]');
	await audited('the verify page in dark mode');
	check(problems.length === 0, `the page threw nothing on the mail acts${problems.length === 0 ? '' : `: ${problems.join(', ')}`}`);
} finally {
	await browser.close();
}

await server.stop();
await store.stop();

console.log(`\n${String(checks - failed)}/${String(checks)} checks passed`);
if (failed > 0) process.exitCode = 1;
