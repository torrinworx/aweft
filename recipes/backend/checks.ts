// What the boot beside this file is worth, checked against a real port: two people sign up
// over HTTP, the first holds `admin` and reaches what needs it, a name the administrator grants
// reaches the second with no reconnect, one product opens and not the next, a verification link
// mailed through notify grants `verified`, a reset link sets a password and ends every session,
// the board converges between them under the rules module, the scheduler module ran a job, and
// every module's `stop` runs on the way out.
//
// A real application would not have this file. Everything it uses is a public export, apart
// from the mails the configuration file keeps for it.

import { createClient } from '@aweftjs/client';
import type { Client } from '@aweftjs/client';
import { createObject } from '@aweftjs/core';
import type { Server } from '@aweftjs/server';
import type { NodeListener } from '@aweftjs/server/node';
import type { Store } from '@aweftjs/store';
import type { RequestError, SocketLike } from '@aweftjs/sync';

import { mails } from './modules/notify/Send.ts';

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

type Board = { notes?: Record<string, string> };

/** What the checks need, handed over by the boot, so this file imports nothing back from it. */
export const run = async (
	{ server, store, listener }: { server: Server; store: Store; listener: NodeListener },
): Promise<void> => {
	const port = String(listener.port);
	const http = `http://127.0.0.1:${port}`;

	const post = (path: string, body: unknown, cookie?: string): Promise<Response> => fetch(`${http}${path}`, {
		method: 'POST', headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
		body: JSON.stringify(body),
	});

	/** Sign up or in, and answer the whole Set-Cookie a browser would have kept. */
	const signUp = async (email: string, password = 'correct horse battery staple'): Promise<string> => {
		const answer = await post('/api/session', { email, password });
		if (answer.status !== 201 && answer.status !== 200) throw new Error(`${email} could not sign up: ${String(answer.status)}`);
		return answer.headers.getSetCookie()[0]!;
	};
	const linkIn = (text: string): string => text.slice(text.indexOf('token=') + 'token='.length);

	/** A page, as a browser would be, with the one seam Node needs: a socket carrying the cookie. */
	const pageFor = (cookie: string): Client => createClient({
		url: `ws://127.0.0.1:${port}/`,
		open: (url) => new WebSocket(url, { headers: { cookie } } as unknown as string[]) as unknown as SocketLike,
	});

	console.log('a backend whose boot is one createServer call');

	// --- two people sign up, and the first one is the administrator -----------------------------

	const adaSet = await signUp('ada@example.com');
	const bobSet = await signUp('bob@example.com');
	check(adaSet !== bobSet, 'two people signed up over HTTP and hold different sessions');
	check(/Max-Age=3600(;|$)/.test(adaSet),
		'the session lasts an hour, from a file that exports config and nothing else over the battery\'s auth/Session');

	const ada = pageFor(adaSet.split(';')[0]!);
	const bob = pageFor(bobSet.split(';')[0]!);

	check(await ada.ask('app/Wipe') === 'the board was wiped', 'the first to sign up holds admin, from a file that configures auth/Roles, and reaches the module that needs it');
	const refusal = await bob.ask('app/Wipe').then(() => 'answered', (error: RequestError) => JSON.stringify(error.reasons));
	check(refusal === '[{"code":"needs","message":"app/Wipe needs admin"}]',
		'the second is refused with the name the module declared');
	check(await bob.ask('app/Digest').then(() => 'answered', reasonOf) === 'answered',
		'and the rule underneath still lets him reach everything else');

	// --- a name the administrator grants reaches the second person with no reconnect --------------

	check(await ada.ask('app/Reports') === 'the monthly report', 'admin covers reports through the table');
	check(await bob.ask('app/Reports').then(() => 'answered', reasonOf) === 'refused', 'and bob holds nothing yet');
	const bobId = (await bob.ask('auth/Session') as { user: string }).user;
	const bobNames = await bob.share<{ names?: string[] }>('roles').ready;
	check(await ada.ask('app/Grant', { user: bobId, name: 'reports' }) === 'granted', 'the administrator grants it over this application\'s own module');
	check(await bob.ask('app/Reports') === 'the monthly report', 'and the same socket reaches the module on the next call');
	await until(() => (bobNames.names ?? []).includes('reports'), 'the name to reach bob\'s page');
	check((bobNames.names ?? []).includes('reports'), 'the page holds the name through the roles share, with no reconnect');
	check(await bob.ask('app/Grant', { user: bobId, name: 'admin' }).then(() => 'answered', reasonOf) === 'refused', 'bob cannot grant himself anything');

	// --- one product opens and not the next ---------------------------------------------------------

	check(await bob.ask('app/Product', { id: 'p1' }).then(() => 'answered', reasonOf) === 'needs', 'a product is closed until a name under it is held');
	await ada.ask('app/Grant', { user: bobId, name: 'products.p1' });
	check(await bob.ask('app/Product', { id: 'p1' }) === 'product p1', 'products.p1 opens that product');
	check(await bob.ask('app/Product', { id: 'p2' }).then(() => 'answered', reasonOf) === 'needs', 'and not the next');
	check(await ada.ask('app/Product', { id: 'p2' }) === 'product p2', 'while admin covers every product');

	// --- a verification link, mailed through notify, grants verified ---------------------------------

	const bobCookie = bobSet.split(';')[0]!;
	check((await post('/api/verify/send', {}, bobCookie)).status === 200, 'bob asks for the verification mail');
	check(mails.length === 1 && mails[0]!.to === 'bob@example.com', 'notify mailed it to the address on his user document');
	const verifyToken = linkIn(mails[0]!.text);
	check((await post('/api/verify', { token: verifyToken })).status === 200, 'the link is taken');
	await until(() => (bobNames.names ?? []).includes('verified'), 'verified to reach bob\'s page');
	check((bobNames.names ?? []).includes('verified'), 'and bob holds verified');
	check((await post('/api/verify', { token: verifyToken })).status === 400, 'a link is one use');

	// --- a reset link sets the password and ends every session --------------------------------------

	check((await post('/api/password/forgot', { email: 'nobody@example.com' })).status === 200 && mails.length === 1,
		'forgot answers ok for an address nobody has, and mails nothing');
	check((await post('/api/password/forgot', { email: 'bob@example.com' })).status === 200 && mails.length === 2, 'and mails a known one');
	check((await post('/api/password/reset', { token: linkIn(mails[1]!.text), password: 'a new horse battery' })).status === 200, 'the reset link sets the password');
	check((await post('/api/verify/send', {}, bobCookie)).status === 401, 'and every session bob had is over');
	check((await post('/api/session', { email: 'bob@example.com', password: 'correct horse battery staple' })).status === 401, 'the old password is gone');
	const bobAgain = await signUp('bob@example.com', 'a new horse battery');
	check((await post('/api/password', { current: 'a new horse battery', password: 'yet another horse' }, bobAgain.split(';')[0]!)).status === 200,
		'signed in with the new one, he changes it with the current one');

	// --- the document a module holds converges between the two of them ----------------------------

	const onAda = await ada.share<Board>('board').ready;
	const onBob = await bob.share<Board>('board').ready;
	// A slot holds an observable, never a plain object.
	onAda.notes = createObject<Record<string, string>>({ first: 'the kettle is broken' }) as Record<string, string>;
	await until(() => onBob.notes?.first === 'the kettle is broken', 'the note to reach the second page');
	check(onBob.notes?.first === 'the kettle is broken', 'a note written on one page reached the other through the module\'s share');

	const held = await store.open('board:office');
	check((held.root as Board).notes?.first === 'the kettle is broken',
		'and the module\'s own handle is the same document, so the note is in the store');
	await store.close(held);

	// The rules module refuses a removal, so the note stays where it is.
	delete onBob.notes;
	await after(100);
	check(onAda.notes?.first === 'the kettle is broken', 'a removal is refused by the rules module, and the board keeps the note');

	// --- the scheduler module ran a job ------------------------------------------------------------

	let runs = 0;
	const deadline = Date.now() + 10_000;
	while (runs === 0 && Date.now() < deadline) {
		runs = await ada.ask('app/Digest') as number;
		if (runs === 0) await after(20);
	}
	check(runs > 0, `the scheduler module ran its job ${String(runs)} time(s), with nothing about it in the boot`);

	// --- stopping runs every module's stop -----------------------------------------------------------

	const log = server.loader.get('app/Log') as { call(): readonly string[] };
	const loaded = server.loader.loaded();
	const wanted = [
		'app/Board', 'app/Digest', 'app/Grant', 'app/Log', 'app/Product', 'app/Reports', 'app/Rules', 'app/Wipe',
		'auth/Check', 'auth/Enter', 'auth/Gate', 'auth/Password', 'auth/Roles', 'auth/Session', 'auth/State', 'auth/Verify',
		'notify/Devices', 'notify/Inbox', 'notify/Send',
	];
	check(wanted.every((name) => loaded.includes(name)) && loaded.length === wanted.length,
		`start loaded all ${String(wanted.length)} modules the directory and the batteries list, with no load list anywhere`);

	ada.close();
	bob.close();
	await server.stop();

	// What every module holding something should have written, in the reverse of the order the
	// loader built them in, worked out from the load order above rather than from what happened.
	const holders = ['app/Board', 'app/Digest', 'app/Wipe'];
	const expected = loaded.filter((name) => holders.includes(name)).reverse();
	const stopped = log.call();
	check(stopped.join(',') === expected.join(','),
		`every module holding something let go of it, in reverse load order: ${stopped.join(', ')}`);
	check(server.loader.loaded().length === 0, 'and nothing is left loaded');
	await store.stop();

	console.log('\nwhat this recipe does NOT do for you:');
	console.log('  it does not decide what a name means. `admin` and `reports` are this application\'s');
	console.log('  words, in modules/auth/Roles.ts; the battery holds them and reads `needs`, nothing more.');
	console.log('  it does not grant over the wire. app/Grant is this application\'s route for that, and');
	console.log('  yours may be an invitation, a purchase, or nothing at all.');
	console.log('  it does not pick where the mail links go. modules/auth/Verify.ts and Password.ts do.');
	console.log('  it does not keep the board small. Nothing here truncates or sweeps, and a');
	console.log('  document that grows forever is a job for a module you write.');

	console.log(`\n${String(checks - failed)}/${String(checks)} checks passed`);
	if (failed > 0) process.exitCode = 1;
};
