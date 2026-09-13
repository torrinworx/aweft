// The notify battery under the gate: two pages of one signed-in user hear a send live, mark it
// read for each other, and register a device; email and push go to two fake services on
// localhost that record what they were sent; a second server with no store does a contact form's
// job; and a restart over the same driver shows the same inbox.
//
// Run: AWEFT_DEFAULT_H=@aweftjs/ui node --import @aweftjs/build/loader recipes/notify/main.ts

import { generateKeyPairSync } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import type { Page } from 'playwright';
import { createServer as createViteServer } from 'vite';

import { fromBundle } from '@aweftjs/modules';
import { notify } from '@aweftjs/notify';
import type { Send } from '@aweftjs/notify';
import { createServer, open } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import type { Store } from '@aweftjs/store';

const here = fileURLToPath(new URL('.', import.meta.url));

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// --- two fake services on localhost ----------------------------------------------------------

interface Call { readonly path: string; readonly body: unknown }

const fake = async (route?: (call: Call, reply: (status: number, body: unknown) => void) => boolean): Promise<{ url: string; calls: Call[]; answer(status: number, body: unknown): void; http: HttpServer }> => {
	const calls: Call[] = [];
	let status = 200;
	let body: unknown = { id: 'fake-mail' };
	const http = createHttpServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
		let text = '';
		incoming.on('data', (chunk: Buffer) => { text += chunk.toString(); });
		incoming.on('end', () => {
			let parsed: unknown = text;
			try { parsed = JSON.parse(text); } catch { /* a form body stays text */ }
			const call = { path: incoming.url ?? '', body: parsed };
			calls.push(call);
			const reply = (s: number, b: unknown): void => { outgoing.writeHead(s, { 'content-type': 'application/json' }); outgoing.end(JSON.stringify(b)); };
			if (route?.(call, reply) === true) return;
			reply(status, body);
		});
	});
	const url = await new Promise<string>((done) => { http.listen(0, '127.0.0.1', () => { done(`http://127.0.0.1:${String((http.address() as { port: number }).port)}`); }); });
	return { url, calls, answer: (s, b) => { status = s; body = b; }, http };
};

const resend = await fake();
const fcm = await fake((call, reply) => {
	if (call.path === '/token') { reply(200, { access_token: 'fake-access', expires_in: 3600 }); return true; }
	return false;
});
fcm.answer(200, { name: 'projects/recipe/messages/1' });
const sends = (): Call[] => fcm.calls.filter((c) => c.path !== '/token');

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = JSON.stringify({ client_email: 'push@recipe.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), project_id: 'recipe' });

// --- the backend, on a free port, configured through the environment ---------------------------

process.env.PORT = '0';
process.env.RESEND_URL = resend.url;
process.env.FCM_ACCOUNT = account;
process.env.FCM_URL = `${fcm.url}/v1/projects/{project}/messages:send`;
process.env.FCM_TOKEN_URL = `${fcm.url}/token`;
const backend = await import('./backend/main.ts');
let running = backend.running;
process.env.AWEFT_BACKEND_PORT = String(running.port);

// --- the dev server, with the backend behind it ----------------------------------------------

const dev = await createViteServer({
	configFile: join(here, 'page', 'vite.config.ts'),
	logLevel: 'warn',
	server: { port: 0 },
});
await dev.listen();
const origin = dev.resolvedUrls!.local[0]!;

// --- the pages --------------------------------------------------------------------------------

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 900, height: 700 } });

const titles = (view: Page): Promise<string[]> => view.locator('#items .title').allTextContents();
const states = (view: Page): Promise<string[]> => view.locator('#items .state').allTextContents();
const inboxDoc = async (store: Store, user: string): Promise<{ title: string; delivery: string }[]> => {
	const handle = await store.open(`inbox:${user}`);
	const items = [...((handle.root as { items?: { title: string; delivery: string }[] }).items ?? [])].map((one) => ({ title: one.title, delivery: one.delivery }));
	await store.close(handle);
	return items;
};
const devicesDoc = async (store: Store, user: string): Promise<string[]> => {
	const handle = await store.open(`devices:${user}`);
	const devices = Object.keys((handle.root as { devices?: Record<string, unknown> }).devices ?? {});
	await store.close(handle);
	return devices;
};

try {
	const a = await context.newPage();
	await a.goto(origin);
	await a.waitForSelector('#page');
	await a.locator('#who', { hasText: 'nobody' }).waitFor();
	check((await a.evaluate(() => (globalThis as unknown as { __probe(): Promise<string> }).__probe())) === 'refused', 'an anonymous page\'s inbox refuses at once');

	await a.locator('input').first().fill('ada@example.com');
	await a.locator('input[type=password]').fill('correct horse battery staple');
	await a.click('#sign-in');
	await a.locator('#who', { hasText: 'signed in as' }).waitFor();
	const user = (await a.locator('#who').textContent())!.replace('signed in as ', '');
	await a.locator('#unread', { hasText: '0 unread' }).waitFor();

	// A second page of the same browser is the same user, and gets the same inbox.
	const b = await context.newPage();
	await b.goto(origin);
	await b.locator('#who', { hasText: 'signed in as' }).waitFor();
	await b.locator('#unread', { hasText: '0 unread' }).waitFor();

	await a.click('#register');
	await a.waitForTimeout(200);
	check((await devicesDoc(running.store, user)).includes('this-browser'), 'the page registered itself as a device');

	// A send from the application's own module lands on both pages live.
	await a.click('#ship');
	await a.locator('#unread', { hasText: '1 unread' }).waitFor();
	await b.locator('#unread', { hasText: '1 unread' }).waitFor();
	check((await titles(a)).length === 1 && (await titles(b)).length === 1, 'both pages show the item');
	check((await states(b))[0] === 'new', 'and it is new');

	await b.click('#read-all');
	await a.locator('#unread', { hasText: '0 unread' }).waitFor();
	check((await states(a))[0] === 'read', 'read on one page is read on the other');

	// A loud send goes to both services, and the record on the item says so.
	await a.click('#ship-loud');
	await a.locator('#unread', { hasText: '1 unread' }).waitFor();
	await a.waitForTimeout(300);
	const mail = resend.calls[0]?.body as { to: string; subject: string; html: string } | undefined;
	check(mail?.to === 'ada@example.com' && mail.subject === 'Order shipped' && mail.html.includes('<strong>Order shipped</strong>'), 'the mail went to the address off the user document');
	const push = sends()[0]?.body as { message: { data: Record<string, string>; android: { priority: string }; notification?: unknown } } | undefined;
	check(push?.message.android.priority === 'HIGH' && push.message.notification === undefined, 'the push is data only at HIGH priority');
	check(push?.message.data.t === 'Notification' && push.message.data.b === 'You have a new notification', 'and carries no text by default');
	const stored = await inboxDoc(running.store, user);
	const record = JSON.parse(stored[1]!.delivery) as Record<string, { ok?: boolean }>;
	check(push?.message.data.n !== undefined && stored[1] !== undefined && record.inbox?.ok === true && record.email?.ok === true && record.push?.ok === true, 'the item carries ok for all three channels');

	await a.click('#ship-open');
	await a.locator('#unread', { hasText: '2 unread' }).waitFor();
	await a.waitForTimeout(200);
	check((sends()[1]?.body as { message: { data: Record<string, string> } } | undefined)?.message.data.t === 'Order shipped', 'private false sends the text');

	// The service says the device is gone: so is the row.
	fcm.answer(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
	await a.click('#ship-loud');
	await a.locator('#unread', { hasText: '3 unread' }).waitFor();
	await a.waitForTimeout(200);
	check(!(await devicesDoc(running.store, user)).includes('this-browser'), 'a device the service answered unregistered for is forgotten');

	// The mailer fails: the item is kept and the record names the failure.
	resend.answer(500, { message: 'domain not verified' });
	await a.click('#ship-loud');
	await a.locator('#unread', { hasText: '4 unread' }).waitFor();
	await a.waitForTimeout(200);
	const after = await inboxDoc(running.store, user);
	check((JSON.parse(after[4]!.delivery) as { email: { error: string } }).email.error === 'resend answered 500: domain not verified', 'a failed mail is a line in the record and the item is kept');

	// A page's own write into the inbox is refused; the other page and the store never see it.
	await a.evaluate(() => { (globalThis as unknown as { __forge(): void }).__forge(); });
	await a.waitForTimeout(200);
	check((await titles(b))[0] === 'Order shipped' && (await inboxDoc(running.store, user))[0]!.title === 'Order shipped', 'a forged write never reaches the other page or the store');

	// Channels named on a send: email only writes nothing to the inbox.
	const send = running.server.loader.get('notify/Send') as Send;
	resend.answer(200, { id: 'ok' });
	await send.send({ to: { user }, title: 'mail only', channels: ['email'] });
	await a.waitForTimeout(200);
	check((await titles(a)).length === 5, 'channels: [email] wrote nothing to the inbox');

	// The cap: the hundredth send to this person is the last one this hour; somebody else is fine.
	let capped = false;
	for (let n = 0; n < 100; n += 1) {
		try { await send.send({ to: { user }, title: `bulk ${String(n)}` }); } catch (error) { capped = (error as { reason?: string }).reason === 'capped'; break; }
	}
	const other = await send.send({ to: { user: 'somebody-else' }, title: 'theirs' });
	check(capped && other.delivery.inbox !== undefined && 'ok' in other.delivery.inbox, 'the cap is per recipient, and another recipient is under it');

	// A restart over the same driver: the inbox is what it was.
	const before = (await inboxDoc(running.store, user)).length;
	const port = running.port;
	await running.stop(true);
	running = await backend.boot(running.driver, port);
	await a.reload();
	await a.locator('#who', { hasText: 'signed in as' }).waitFor();
	await a.waitForTimeout(300);
	check((await titles(a)).length === before && before > 5, `after a restart the page shows the same ${String(before)} items`);

	// A server with no store, which is a contact form's shape: the mail goes, nothing is refused.
	const bare = createServer({
		sources: [fromBundle({ './notify/Send.ts': { config: { email: { resend: { key: 'k', from: 'site@example.test', endpoint: resend.url } } } } }), notify],
		store: undefined, gate: open, listener: node({ port: 0, host: '127.0.0.1' }),
	});
	await bare.start();
	const contact = await (bare.loader.get('notify/Send') as Send).send({ to: { email: 'owner@example.test' }, title: 'From the form', body: 'hello', level: 'error', replyTo: 'visitor@example.test' });
	await bare.stop();
	check('ok' in (contact.delivery.email ?? {}) && contact.delivery.inbox !== undefined && 'skipped' in contact.delivery.inbox && contact.delivery.push !== undefined && 'skipped' in contact.delivery.push, 'with no store the mail goes and the rest is skipped');
	check((resend.calls.at(-1)?.body as { reply_to?: string }).reply_to === 'visitor@example.test', 'and the visitor is who a reply goes to');

	// Outward off: neither service is reached and the record says why.
	const quiet = createServer({
		sources: [fromBundle({ './notify/Send.ts': { config: { outward: false, email: { resend: { key: 'k', from: 'site@example.test', endpoint: resend.url } } } } }), notify],
		store: undefined, gate: open, listener: node({ port: 0, host: '127.0.0.1' }),
	});
	await quiet.start();
	const seen = resend.calls.length;
	const silent = await (quiet.loader.get('notify/Send') as Send).send({ to: { email: 'owner@example.test' }, title: 'never sent', channels: ['email'] });
	await quiet.stop();
	check(resend.calls.length === seen && 'error' in (silent.delivery.email ?? {}) && String((silent.delivery.email as { error: string }).error).includes('outward'), 'outward: false sends nothing and records the refusal');
} finally {
	await browser.close();
	await dev.close();
	await running.stop();
	resend.http.close();
	fcm.http.close();
}

console.log(`\n${checks - failed}/${checks} checks passed`);
process.exit(failed === 0 ? 0 : 1);
