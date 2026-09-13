// The proof for @aweftjs/server and @aweftjs/auth: a full-stack notes app, over a real port.
//
// The job: people keep notes. They sign up over HTTP, connect with the cookie, and their
// state document (theme, notes) is shared on the connection and kept in the store. A private
// module exports their notes with progress reports. An anonymous connection reaches only what
// is public. A bad cookie never opens a socket. Signing out makes the old cookie anonymous.
// Then the same server package runs a microservice with `gate: open`, and a ten-line
// allowlist gate with no session in it stands where auth stood.
//
// Every boot here is the rail: sources, a store, a gate, a listener. Nothing builds a loader,
// nobody lists what to load, and the gate is named (designs 240, 241).
//
// Run: node recipes/server/main.ts

import { auth, paths } from '@aweftjs/auth';
import type { AuthContext } from '@aweftjs/auth';
import { createArray, createObject } from '@aweftjs/core';
import { fromBundle } from '@aweftjs/modules';
import type { ModuleExports, ModuleProps } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Connection, Gate, Peer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Store } from '@aweftjs/store';
import { connect, fromWebSocket, requests } from '@aweftjs/sync';
import type { Link, RequestError, Requests, SocketLike } from '@aweftjs/sync';
import WebSocket from 'ws';

let checks = 0;
let failed = 0;
const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const settle = async (rounds = 30): Promise<void> => { for (let i = 0; i < rounds; i++) await new Promise((done) => setTimeout(done, 2)); };
const reasonOf = (error: unknown): string => String((error as RequestError).reason);

type State = { theme: string; notes: string[] };

// --- the application's own modules -------------------------------------------------------------

const app = fromBundle({
	// Private: only a signed-in user exports notes, and only their own.
	'./notes/Export.ts': {
		default: ({ store }: ModuleProps) => ({
			call: async (_args: unknown, context: AuthContext, { progress }: { progress(v: unknown): void }) => {
				const held = await (store as Store).open(`state:${String(context.user)}`);
				const notes = ((held.root as State).notes ?? []) as string[];
				const lines: string[] = [];
				for (const [i, note] of notes.entries()) {
					progress({ done: i + 1, of: notes.length });
					lines.push(`- ${note}`);
				}
				await (store as Store).close(held);
				return lines.join('\n');
			},
		}),
	} satisfies ModuleExports,
	// Public: anyone may read the notice of the day.
	'./notes/Notice.ts': {
		default: () => ({ public: true, call: () => 'welcome to notes' }),
	} satisfies ModuleExports,
});

// --- a client, as a browser or a native app would be ---------------------------------------------

interface Client { link: Link; asks: Requests; socket: WebSocket; }
const client = (port: number, cookie?: string): Client => {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/`, cookie === undefined ? {} : { headers: { cookie } });
	// Attached before the socket opens: the server speaks first.
	const shaped = socket as unknown as SocketLike;
	return { link: connect(fromWebSocket(shaped)), asks: requests(shaped), socket };
};
const closed = (socket: WebSocket): Promise<void> => new Promise((done) => {
	if (socket.readyState === WebSocket.CLOSED) { done(); return; }
	socket.once('close', () => done());
});
const handshake = (port: number, cookie: string): Promise<number | 'opened'> => new Promise((done) => {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { cookie } });
	socket.once('unexpected-response', (_req, res) => { done(res.statusCode ?? 0); socket.terminate(); });
	socket.once('open', () => { done('opened'); socket.close(); });
	socket.once('error', () => {});
});

// --- the notes app, behind the auth battery -------------------------------------------------------

console.log('a notes app behind auth');
const driver = memoryDriver();
const store = createStore({ driver, declare: { ...paths } });
const listener = node({ port: 0, host: '127.0.0.1' });
const server = createServer({ sources: [app, auth], store, gate: 'auth/Gate', listener });
await server.start();
check(
	server.loader.loaded().length === 7,
	`start loaded all ${String(server.loader.loaded().length)} modules the two sources list, with no load list anywhere`,
);
const port = listener.port!;
const http = `http://127.0.0.1:${port}`;

// Sign up over HTTP.
const signUp = await fetch(`${http}/api/session`, {
	method: 'POST', headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ email: 'ada@example.com', password: 'correct horse battery staple' }),
});
const made = await signUp.json() as { user: string; created: boolean };
const cookie = signUp.headers.getSetCookie()[0]!.split(';')[0]!;
check(signUp.status === 201 && made.created === true, 'signing up over HTTP made an account');
check(/HttpOnly/.test(signUp.headers.getSetCookie()[0]!) && /SameSite=Lax/.test(signUp.headers.getSetCookie()[0]!), 'and set an HttpOnly, SameSite=Lax cookie');

// Connect with the cookie; auth/State shares the state document.
const ada = client(port, cookie);
const state = await ada.link.share<State>('state').ready;
await settle();
check(state !== undefined, 'connecting with the cookie shared the state document');
state.theme = 'dark';
state.notes = createArray<string>(['buy milk', 'write the proof']) as unknown as string[];
await settle();

// A call with progress frames.
const progress: unknown[] = [];
const exported = await ada.asks.ask('notes/Export', {}, { progress: (p) => progress.push(p) });
check(exported === '- buy milk\n- write the proof', 'a private module exported the notes the client just wrote');
check(JSON.stringify(progress) === '[{"done":1,"of":2},{"done":2,"of":2}]', 'with a progress frame per note');
check(await ada.asks.ask('auth/Check', { email: 'ada@example.com' }).then((r) => JSON.stringify(r)) === '{"exists":true}', 'and a public call answers too');

// The write landed in the store: reopen it from the same driver after the connection ends.
ada.socket.close();
await closed(ada.socket);
await settle();
await settle();
const again = createStore({ driver, declare: { ...paths } });
const kept = await again.open(`state:${made.user}`);
check((kept.root as State).theme === 'dark' && [...(kept.root as State).notes].join(',') === 'buy milk,write the proof', 'the state read back from a store reopened over the same driver');
await again.close(kept);
// Not stopped: stopping a store closes the driver, and the first store still runs on it.

// An anonymous connection reaches the public modules and not the private ones.
const anonymous = client(port);
check(await anonymous.asks.ask('notes/Notice') === 'welcome to notes', 'an anonymous connection reaches a public module');
check(await anonymous.asks.ask('auth/Check', { email: 'nobody@example.com' }).then((r) => JSON.stringify(r)) === '{"exists":false}', 'and auth/Check');
check(await anonymous.asks.ask('notes/Export').catch(reasonOf) === 'refused', 'and is refused by a private one');
const noState = await Promise.race([anonymous.link.share<State>('state').ready.then(() => 'shared'), new Promise((done) => setTimeout(() => done('not shared'), 300))]);
check(noState === 'not shared', 'auth/State never ran for it, so nothing shares a state');
anonymous.socket.close();
await closed(anonymous.socket);

// A cookie that is not a token, and a token of the right shape that names no session, both
// connect as anonymous: the gate refuses nobody at the door, and a doubled cookie from another
// scope does not hide the live one.
const garbage = client(port, 'session=not-a-token');
check(await garbage.asks.ask('notes/Export').catch(reasonOf) === 'refused', 'a cookie that is not a token connects, as anonymous');
garbage.socket.close();
await closed(garbage.socket);
check(await handshake(port, 'session=AAAAAAAAAAAAAAAA') === 'opened', 'a token that names no session connects as anonymous');
const doubled = client(port, `session=; session=legacy; ${cookie}`);
check(await doubled.asks.ask('notes/Export') === '- buy milk\n- write the proof', 'a live token beside an empty and a foreign cookie of the same name still signs in');
doubled.socket.close();
await closed(doubled.socket);

// Sign in again with the wrong password, then the right one; sign out; the old cookie is anonymous.
const wrong = await fetch(`${http}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ada@example.com', password: 'wrong horse' }) });
check(wrong.status === 401, 'a wrong password is 401');
const signIn = await fetch(`${http}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'Ada@Example.com', password: 'correct horse battery staple' }) });
const second = signIn.headers.getSetCookie()[0]!.split(';')[0]!;
check(signIn.status === 200 && (await signIn.json() as { created: boolean }).created === false, 'signing in with the right one is 200 and a new session');
const signOut = await fetch(`${http}/api/session`, { method: 'DELETE', headers: { cookie: second } });
check(signOut.status === 200 && /Max-Age=0/.test(signOut.headers.getSetCookie()[0] ?? ''), 'DELETE signs out and clears the cookie');
const stale = client(port, second);
check(await stale.asks.ask('notes/Notice') === 'welcome to notes', 'the old cookie still connects');
check(await stale.asks.ask('notes/Export').catch(reasonOf) === 'refused', 'as anonymous: the private module refuses it');
stale.socket.close();
await closed(stale.socket);
await server.stop();
await store.stop();

// --- a microservice: the same server package, no auth, gate: open -------------------------------

console.log('\na microservice with gate: open');
const serviceListener = node({ port: 0, host: '127.0.0.1' });
const microservice = createServer({
	sources: [app], store: createStore({ driver: memoryDriver() }), gate: open, listener: serviceListener,
});
await microservice.start();
const trusted = client(serviceListener.port!);
check(await trusted.asks.ask('notes/Notice') === 'welcome to notes', 'gate: open reaches a public module');
check(await trusted.asks.ask('notes/Export').then(() => 'answered', reasonOf) !== 'refused', 'and a private one, because open interprets nothing');
trusted.socket.close();
await closed(trusted.socket);
await microservice.stop();

// --- a gate with no session in it: an address allowlist --------------------------------------------

console.log('\nan address allowlist gate in place of auth');
const allowlist = (addresses: string[]): Gate<{ address: string }> => ({
	identify: (_request: Request, peer: Peer) => peer.address !== undefined && addresses.includes(peer.address)
		? { context: { address: peer.address } }
		: { refused: [{ code: 'address', message: `${String(peer.address)} is not on the list` }] },
	access: () => [],
});
const board = createObject<Record<string, unknown>>({ title: 'the office board' });
const office = fromBundle({ './office/Board.ts': { default: () => ({ connection: ({ link }: Connection) => { link.share('board', board, open); } }) } });
for (const [addresses, expected] of [[['127.0.0.1', '::1', '::ffff:127.0.0.1'], 'opened'], [['10.0.0.1'], 401]] as const) {
	const gated = node({ port: 0, host: '127.0.0.1' });
	const guarded = createServer({ sources: [office], gate: allowlist([...addresses]), listener: gated });
	await guarded.start();
	const outcome = await handshake(gated.port!, 'session=irrelevant');
	check(outcome === expected, `with ${addresses.join(', ')} on the list, a loopback connection is ${outcome === 'opened' ? 'accepted' : `refused with ${String(outcome)}`}`);
	if (outcome === 'opened') {
		const peer = client(gated.port!);
		const copy = await peer.link.share<Record<string, unknown>>('board').ready;
		await settle();
		check(copy.title === 'the office board', 'and the board is shared with no session anywhere');
		peer.socket.close();
		await closed(peer.socket);
	}
	await guarded.stop();
}

console.log(`\n${checks - failed}/${checks} checks passed`);
if (failed > 0) process.exitCode = 1;
