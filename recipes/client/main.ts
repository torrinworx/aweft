// The proof for @aweftjs/client and the auth battery's client half: a page, in Node.
//
// The job: someone opens an app. It shares a document and asks a module before the socket is
// open, learns it is nobody, signs up, gets its own state document, and keeps working while
// the server is restarted underneath it: the same document object comes back holding what the
// server wrote meanwhile, and an ask made while it was down is answered on the new socket.
// Then it signs out, is nobody again, and signs back in to the state it left.
//
// A browser needs no seams for any of this. Node needs two, and only two: a socket that
// carries the cookie header, and a fetch that keeps the cookie, because Node's keeps none.
//
// Run: node recipes/client/main.ts

import { createAuth } from '@aweftjs/auth/client';
import type { FetchInit, FetchResponse } from '@aweftjs/auth/client';
import { auth, paths } from '@aweftjs/auth';
import type { AuthContext } from '@aweftjs/auth';
import { createClient } from '@aweftjs/client';
import { createObject, observer } from '@aweftjs/core';
import { fromBundle } from '@aweftjs/modules';
import { createServer, open } from '@aweftjs/server';
import type { Connection } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
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

type State = { theme?: string; badge?: string };
type Board = { title: string };

// The application's own document, one copy for the whole server, offered to every connection.
const board = createObject<Board>({ title: 'the notice board' });

// --- the application's own modules ---------------------------------------------------------

const app = fromBundle({
	// Public: anyone reads the notice, signed in or not.
	'./notes/Notice.ts': { default: () => ({ public: true, call: () => 'the notice of the day' }) },
	// Private: only a signed-in connection reaches it, and it answers with who asked.
	'./notes/Mine.ts': { default: () => ({ call: (_args: unknown, context: AuthContext) => `notes for ${String(context.user)}` }) },
	// Public too, and it shares a document rather than answering a call.
	'./notes/Board.ts': { default: () => ({ public: true, connection: ({ link }: Connection<AuthContext>) => { link.share('board', board, open); } }) },
});

// --- the server, and the store both it and this program read ---------------------------------

const driver = memoryDriver();
const store = createStore({ driver, declare: { ...paths } });
const boot = { sources: [app, auth], store, gate: 'auth/Gate' } as const;
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
await server.stop();
await store.stop();

console.log(`\n${String(checks - failed)}/${String(checks)} checks passed`);
if (failed > 0) process.exitCode = 1;
