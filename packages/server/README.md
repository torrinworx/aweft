# @aweftjs/server

Connections and requests behind a gate. A listener you supply hands over web-standard
requests and WebSocket handshakes; the server asks the gate who each one is and what it may
reach, turns each accepted socket into a sync link plus a call channel, and runs the hooks of
the modules the gate allows. It opens nothing, mints nothing, and knows no user.

## Quickstart

```ts
import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });

const server = createServer({
	sources: [fromDirectory('./modules'), auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

That is the whole boot, and everything else your application does is a module in
`./modules`. **The sources** say where modules come from, and `start` loads every module every
one of them lists, in dependency order: there is no load list, and a file you drop in that
directory is running after the next boot. **The gate** says who may reach what, as an object
or as the name of a module that is one; there is no default. **The listener** is where
connections come from; `node()` ships, and the contract is small enough to write for another
runtime. `store` is optional and is the only thing this package hands a module.

**The props rule, which is a guarantee, not a habit: the platform hands your factories `store`
and nothing else.** There is no `props` option and no way to add one, so anything your
application makes (a rules table, a scheduler, a document you hold open, a client of another
service) is a module, and the modules that need it name it in `deps`. That is what gives you
the ordering for free: a module that opens a document is built before the module that shares
it, because it said so. `server.loader` is the loader this built, for `follow`, for a test, and
for loading or unloading while the server runs.

A microservice that knows nothing about users installs no auth, keeps no store, and types the
one word:

```ts
import { createServer, open } from '@aweftjs/server';
const server = createServer({ sources: [fromDirectory('./modules')], gate: open, listener: node({ port: 8081 }) });
```

`stop()` ends every connection, stops the listener, and then unloads every module in reverse
load order, so each module's `stop` runs after nothing can reach it. A `stop` that throws
reaches `handlers.failed` under its module's name and the rest still unload, so one module that
cannot let go does not strand the ones underneath it.

## The gate

A gate is any object with two functions. A module instance is one; an object literal is one;
`open` is one.

```ts
interface Gate<C> {
	identify(request: Request, peer: { address }): { context: C } | { refused: Refusal[] };
	access({ name, instance }, context: C): Refusal[];     // empty allows
}
```

`identify` runs once per connection (at the handshake, before any socket opens) and once per
HTTP request. What it answers as `context` reaches every hook as an argument; a refusal
answers 401 with the reasons, and for a handshake no socket is ever opened. `access` runs
before a module sees a connection, a call or a request, and its reasons refuse the call, 403
the request, or skip the hook. Both may be asynchronous. A throw out of either is a defect:
500, and reported (see below), never a refusal.

**A gate may be named instead of passed.** `gate: 'auth/Gate'` is the name of one of the
modules your sources list, and `start` reads it off the loader. A name that is not loaded, or
whose instance has no `identify` and `access`, is refused at `start` with reason `missing`.

**A composed gate is a module.** To keep the battery's policy and add a rule of your own, write
a module that `deps` on the gate you are wrapping and name yours:

```ts
export const deps = ['auth/Gate'];

export default ({ imports }) => ({
	identify: (request, peer) => imports.Gate.identify(request, peer),
	access: async (module, context) => {
		const reasons = await imports.Gate.access(module, context);
		if (reasons.length > 0) return reasons;
		return module.instance.admin === true && context.user !== admin
			? [{ code: 'not-admin', message: `${module.name} is for the administrator` }]
			: [];
	},
});
```

There is no `compose` and no chain of gates: two policies in a row is one function calling
another, which a module already is.

The server interprets nothing in the context and reads nothing off a module for the gate.
`@aweftjs/auth`'s gate reads a module's `public: true` and treats absent as private; that is
that gate's word, and a gate you write may read another or none. A gate with no session in
it fits in ten lines:

```ts
const allowlist = (addresses: string[]): Gate<{ address: string }> => ({
	identify: (_request, peer) => peer.address !== undefined && addresses.includes(peer.address)
		? { context: { address: peer.address } }
		: { refused: [{ code: 'address', message: `${String(peer.address)} is not on the list` }] },
	access: () => [],
});
```

Calls between modules through `imports` are not gated: modules in one process trust each
other. The gate stands between the outside and a module.

## What a module can carry

The server reads five things off a loaded module's instance, all optional:

```ts
export default ({ store }) => ({
	// Once per connection the gate lets this module see. Return the function run when it ends.
	connection: async ({ link, request, context, close }) => {
		const board = await store.open(`board:${context.user}`);
		link.share('board', board.root, { accept: (commit) => mine(commit) ? [] : [{ code: 'not-yours', message: '' }] });
		return () => store.close(board);
	},
	// An `ask` from the client naming this module, after the gate allowed it.
	call: async (args, context, { progress }) => { progress('reading'); return report(args); },
	// HTTP, keyed by exact method and path.
	routes: { 'GET /api/export': async (request, context) => new Response(await csv(context.user)) },
	// An HTTP request no route matched. A `Response` answers it; `undefined` declines it.
	request: async (request) => serve(new URL(request.url).pathname),
	// What the server did, every event, after the fact.
	observe: (event, context) => { if (event.kind === 'call') count(event.name, event.ms); },
});
```

A document a hook shares is an `@aweftjs/core` observable: `createObject`, `createArray` and
`createMap` make one, `atomic` groups writes into one commit, and a plain object or array in
a slot is refused. The store's `open` hands back one ready to share.

`connection` hooks run in load order, which is dependency order, for the modules the gate
allows; the functions they return run in reverse when the connection ends. A call is
answered once every hook has run, so state a hook sets up is there for `call`. `close()`
ends the connection from inside a hook, which is how a middleware module kills one. A module
reloaded while a connection is open keeps that connection's hook state on the instance that
made it, and its end functions with it; calls and routes go to the new instance. **A share on a
connection's link requires `accept`**: the hole where any signed-in client writes anywhere is
refused before anything crosses (`no-accept`). `open` is the handlers for the trusted case.
`accept` is handed the arriving commit before it applies, so the document still reads as it was
and a rule reads `commit.deltas`; the delta shape and the `refused` payload the other end gets
are in `@aweftjs/sync`'s README, under "Your rules go in `accept`", which is where that
behaviour is tested.

`call` answers `ask(name, args, { progress, timeout })` from the other end: `progress`
streams back before the result, a throw answers with its `reason` and `message`. A module
that is not loaded or has no `call` is `missing`; one the gate refuses is `refused` with the
reasons.

`routes` are matched on `METHOD /path` exactly, the query aside; two loaded modules declaring
one key are refused at `start()` by both names, and a conflict a later load introduces
answers 500 to the request that meets it. No match is 404. A route answers with a `Response`;
anything else is 500 and reported as `not-a-response`.

`request` is the rule for what no route matched, for the answers a table of exact paths cannot
hold: a directory of files, or anything under one prefix. Every loaded module that declares it
is asked, in load order, behind the gate, and the first `Response` is the request's answer;
`undefined` declines and the next module is asked. A module the gate refuses is skipped rather
than answered on the spot, so a public module still answers under a private one loaded before
it. When every module declines the request is 404, as it was; when the gate refused one along
the way and nothing answered it is 403 carrying that refusal's reasons, the same shape a
refused route gets, so a private site does not read as an empty one. That body is JSON,
`{ reasons: [{ code, message }] }`. A hook that throws is 500, reported under its module's name,
and it ends the walk: no module after it is asked, because a defect is not a decline. One that
answers something that is not a `Response` is 500 and reported as `not-a-response` (design 248).

`observe` hears what the server did (design 260). Every loaded module that declares it is
handed every event, in load order: `connection` (a socket the gate let in, with the handshake
request) and `closed` (with `ms` since it opened); `call` (the module asked for and its `instance` when one is loaded, the `args` as sent, the
`outcome` as `{ result }` or `{ error }`, and `ms`), for asks the server refused itself too,
where the error is its `missing`, `refused` or `closed`; `request` (method, path,
status, `ms`, and `name`, the module whose route or `request` hook answered, absent when the
server answered itself; never the body); `refused` (a commit a share's `accept` turned away,
with the topic and the reasons; an `accept` that throws is a refusal with the one reason
`accept-threw`, as sync reads it); `failed` (what reaches `handlers.failed`). `context` is what
`identify` answered for that connection or request, and the same reference reaches every hook
and every event of one connection, so an observer that tells connections apart keys on it. The
hook is not gated, because the server is telling its own modules what it did. Nothing waits
for an observer and nothing reads what it answers: a throw or a rejection is reported under the
observer's name and emitted to no one, so an observer that throws on every event does not chase
its own tail, and the event it threw on is unaffected. `args` and `result` are the caller's own
objects, not copies.

## The client

One socket carries both the link (binary) and the requests (text). `@aweftjs/client` opens it
and holds both:

```ts
import { createClient } from '@aweftjs/client';

const client = createClient({ url: 'wss://app.example/' });

const board = await client.share('board').ready;
const report = await client.ask('notes/Export', { month: '2026-09' }, { progress: (p) => bar.set(p) });
```

That package attaches the link and the request channel the moment the socket is made, so the
share and the ask above reach the server even though they are written while the socket is
still connecting. It has to, for the reason this section already gives: the server's hooks run
at the handshake and its first frames are on the wire before the client's `open` event fires,
and a message that arrives before anything listens is lost, on every WebSocket implementation
there is.

Identity is fixed for a connection's life: it is what `identify` said at the handshake.
After signing in or out over HTTP, the client reconnects. A browser cannot set a cookie on an
open socket, and `@aweftjs/auth/client` does that reconnect for the page.

## The listener

```ts
interface Listener {
	start({ request, socket }): Promise<void>;
	stop(): Promise<void>;
}
```

`request(request, peer)` answers a `Request` with a `Response`. `socket(request, peer)` is the
handshake: it answers a `Response` to refuse the upgrade with that status, or a function to
hand the opened socket to. `peer` is `{ address }`, because a web-standard `Request` carries
no address and a gate that keys on one has nowhere else to read it.

`node(options)` on `@aweftjs/server/node` ships: Node's `http` plus `ws`, the one runtime
dependency in the stack. `node({ port, host })` owns a server and closes it on `stop`;
`node({ server })` answers on a server you made (TLS, or a shared port) and never closes it.
`heartbeatMs` pings every open socket and terminates one that does not answer, and nothing
pings without it. `maxPayload` bounds a WebSocket message and an HTTP body alike (a declared
length over it is 413, a body that crosses it is cut off): 1 MiB with nothing set, and
`Infinity` is the one way to remove the bound. `forwarded` is for a listener behind a proxy
you trust: `true` reads the scheme from `x-forwarded-proto` and the peer address from the last
entry of `x-forwarded-for`, the one that proxy appended, since the first entry is whatever the
client wrote; `'x-real-ip'` reads the address from that header instead, for a proxy that sets
it. Off, both headers are ignored. A `TRACE` is answered 405 before any handler sees it. `port`
is readable after `start`, so `port: 0` works in a test.

A listener for another runtime proves itself with `listenerChecks()` from
`@aweftjs/testing`, the way a store driver or a sandbox runner does:

```ts
for (const c of listenerChecks()) test(c.name, () => c.run(() => {
	const listener = myListener();
	return { listener, url: () => myUrl(listener) };
}));
```

## Before the gate

Two things are checked before `identify` runs, so a refused request costs no gate work, and
each has a value here that one option changes.

```ts
createServer({
	sources, store, gate, listener,
	limits: { requests: { count: 600, windowMs: 60_000 } },   // the value with nothing set
	origins: ['https://app.example'],                         // beside the request's own host
});
```

**`limits.requests`** counts requests and handshakes per peer address over a sliding window;
over the count, the answer is 429 with a `Retry-After` in seconds and the reason `limit`, and
for a handshake no socket opens. `limits: { requests: false }` removes the count. The address
is the listener's word: behind a proxy, start the Node listener with `forwarded`, or the proxy
is the one address every request shares. Clients behind one address share one count. The count
is coarse on purpose; the sign-in route keeps its own attempt counts (`@aweftjs/auth`).

**`origins`** is the Origin rule. A request carrying an `Origin` header is refused with 403
and the reason `origin` when that origin's host is not the request's own host, port included,
and the request is a handshake or has a method other than `GET`, `HEAD` or `OPTIONS`. A
request with no `Origin` header passes: that is a client that is not a browser, and it holds no
cookie a browser set. A list adds origins a page may send from; `'any'` removes the rule. The
browser's own SameSite rule already keeps the cookie off a cross-site request; this rule is
what stops a sign-in forged from another site, which needs no cookie, and it holds when an
application widens the cookie.

`sliding({ count, windowMs })` is exported, the counter behind the limit, for a module that
counts something of its own: `take(key)` answers `{ ok: true }` or `{ ok: false, retryAfter }`,
and `clear(key)` forgets a key.

Every answer the server gives carries `X-Content-Type-Options: nosniff` unless the module set
the header itself.

## When something throws

A `call` that throws a refusal, an error carrying a `reason`, answers its caller with it and is
not reported: the caller heard what the module meant it to. A `call` that throws anything else
answers its caller `failed` with the words `the call failed` and nothing of the error, and is
reported: a module's own bug names files and values the caller has no business reading.
Everything else reaches `handlers.failed(name, error)` on `createServer` too: a `connection`
hook that throws (the connection is closed), an end function that throws (the rest still run),
a route that throws (a bare 500), the gate that throws (500), and a route conflict met by a
request (500). Without a handler, a call's error is written to the console and the process goes
on, because any client can reach a public call; every other failure is raised where nothing
catches it, and the process says so and ends. Pass a handler in production.

## What this package never decides

Who is on a connection, whether it lives, and who may reach a module: the gate's. Who may
write a commit: `accept`, per share. What a module is for and what it holds: the module's, and
what it needs is `deps`. Users, sessions, cookies: `@aweftjs/auth`, or whatever you load
instead. The two bounds above have values so that a server forgotten about is still bounded;
every other limit or interval is yours.

It does decide one thing about modules, and only one: everything your sources list is loaded
at `start` and unloaded at `stop`. Which modules exist is still yours, and so is anything you
load or unload through `server.loader` while it runs.

When a client sends bytes that are not a frame, the link ends and the connection with it:
the end functions run and the socket closes, so the client hears.

Every error this package raises carries a `reason`: `missing` (`createServer` without one of its
three, or a gate named that is not a loaded gate), `not-an-option` (`loader` or `props` passed to
`createServer`, which builds its own loader), `route-conflict`, `no-accept`, `not-a-response`,
`started`. The design notes are in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design) 071 to 073, 240 and
241.

## The design notes

A `design NNN` above is the note of that number in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design), which says what was
decided, why, what it costs, and what would reverse it.