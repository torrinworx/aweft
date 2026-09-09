// What the boot beside this file is worth, checked against a real port: two people sign up
// over HTTP, one of them is the administrator, the board converges between them under the
// rules module, the scheduler module ran a job, and every module's `stop` runs on the way out.
//
// A real application would not have this file. Everything it uses is a public export.

import { createClient } from '@aweftjs/client';
import type { Client } from '@aweftjs/client';
import { createObject } from '@aweftjs/core';
import type { Server } from '@aweftjs/server';
import type { NodeListener } from '@aweftjs/server/node';
import type { Store } from '@aweftjs/store';
import type { RequestError, SocketLike } from '@aweftjs/sync';

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

	/** Sign up, and answer the whole Set-Cookie a browser would have kept. */
	const signUp = async (email: string): Promise<string> => {
		const answer = await fetch(`${http}/api/session`, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email, password: 'correct horse battery staple' }),
		});
		if (answer.status !== 201) throw new Error(`${email} could not sign up: ${String(answer.status)}`);
		return answer.headers.getSetCookie()[0]!;
	};

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

	check(await ada.ask('app/Wipe') === 'the board was wiped', 'the first to arrive reaches the administrator\'s module');
	const refusal = await bob.ask('app/Wipe').then(() => 'answered', (error: RequestError) => JSON.stringify(error.reasons));
	check(refusal === '[{"code":"not-admin","message":"app/Wipe is for the administrator"}]',
		'the second is refused, with the gate module\'s own reason rather than the battery\'s');
	check(await bob.ask('app/Digest').then(() => 'answered', reasonOf) === 'answered',
		'and the rule underneath still lets him reach everything else');

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
		'app/Board', 'app/Digest', 'app/Gate', 'app/Log', 'app/Rules', 'app/Wipe',
		'auth/Check', 'auth/Enter', 'auth/Gate', 'auth/Session', 'auth/State',
	];
	check(wanted.every((name) => loaded.includes(name)) && loaded.length === wanted.length,
		`start loaded all ${String(wanted.length)} modules the directory and the battery list, with no load list anywhere`);

	ada.close();
	bob.close();
	await server.stop();

	// What every module holding something should have written, in the reverse of the order the
	// loader built them in, worked out from the load order above rather than from what happened.
	const holders = ['app/Board', 'app/Digest', 'app/Gate', 'app/Wipe'];
	const expected = loaded.filter((name) => holders.includes(name)).reverse();
	const stopped = log.call();
	check(stopped.join(',') === expected.join(','),
		`every module holding something let go of it, in reverse load order: ${stopped.join(', ')}`);
	check(server.loader.loaded().length === 0, 'and nothing is left loaded');
	await store.stop();

	console.log('\nwhat this recipe does NOT do for you:');
	console.log('  it does not decide what a module is for. `admin: true` is this application\'s');
	console.log('  word, read by this application\'s own gate module; the server has never heard of it.');
	console.log('  it does not make the first user an administrator. That rule is four lines in');
	console.log('  modules/app/Gate.ts, and yours may be a role on the user document instead.');
	console.log('  it does not keep the board small. Nothing here truncates or sweeps, and a');
	console.log('  document that grows forever is a job for a module you write.');

	console.log(`\n${String(checks - failed)}/${String(checks)} checks passed`);
	if (failed > 0) process.exitCode = 1;
};
