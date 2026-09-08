# @aweftjs/server

Connections and requests behind a gate. A listener you supply hands over web-standard
requests and WebSocket handshakes; the server asks the gate who each one is and what it may
reach, turns each accepted socket into a sync link plus a call channel, and runs the hooks of
the modules the gate allows. It opens nothing, mints nothing, and knows no user.

## Quickstart

```ts
import { createLoader } from '@aweftjs/modules';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import { auth, paths } from '@aweftjs/auth';
import type { Gate } from '@aweftjs/server';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });
const loader = createLoader({ sources: [fromDirectory('./modules'), auth], props: { store } });
await loader.load(['auth/Gate', 'auth/Enter', 'auth/Check', 'auth/State', 'notes/Export']);

const gate = loader.get('auth/Gate') as Gate;
const server = createServer({ loader, gate, listener: node({ port: 8080 }) });
await server.start();
```

Three things, all required. **The loader** holds the modules; which ones load, and when, is
yours, and the server reads them off the loader as they are, so a module loaded later is
served without a restart. **The gate** says who may reach what; there is no default. **The
listener** is where connections come from; `node()` ships, and the contract is small enough
to write for another runtime.

A microservice that knows nothing about users installs no auth and types the one word:

```ts
import { createServer, open } from '@aweftjs/server';
const server = createServer({ loader, gate: open, listener: node({ port: 8081 }) });
```

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

The server reads three things off a loaded module's instance, all optional:

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

`call` answers `ask(name, args, { progress, timeout })` from the other end: `progress`
streams back before the result, a throw answers with its `reason` and `message`. A module
that is not loaded or has no `call` is `missing`; one the gate refuses is `refused` with the
reasons.

`routes` are matched on `METHOD /path` exactly, the query aside; two loaded modules declaring
one key are refused at `start()` by both names, and a conflict a later load introduces
answers 500 to the request that meets it. No match is 404. A route answers with a `Response`;
anything else is 500 and reported as `not-a-response`.

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
`heartbeatMs` pings every open socket and terminates one that does not answer; `maxPayload`
bounds a WebSocket message and an HTTP body alike (a declared length over it is 413, a body
that crosses it is cut off); `forwarded` reads the scheme and the peer address from
`x-forwarded-proto` and `x-forwarded-for`, for a listener behind a proxy you trust. None has
a value here: without them nothing pings, a message has the transport's own bound, a body has
none, and the proxy headers are ignored. `port` is readable after `start`, so `port: 0` works
in a test.

A listener for another runtime proves itself with `listenerChecks()` from
`@aweftjs/testing`, the way a store driver or a sandbox runner does:

```ts
for (const c of listenerChecks()) test(c.name, () => c.run(() => {
	const listener = myListener();
	return { listener, url: () => myUrl(listener) };
}));
```

## When something throws

A `call` that throws answers its caller and is not reported: the caller heard. Everything
else reaches `handlers.failed(name, error)` on `createServer`: a `connection` hook that
throws (the connection is closed), an end function that throws (the rest still run), a route
that throws (500), the gate that throws (500), and a route conflict met by a request (500).
Without a handler the error is raised where nothing catches it, and the process says so.

## What this package never decides

Who is on a connection, whether it lives, and who may reach a module: the gate's. Who may
write a commit: `accept`, per share. Which modules load, and when: the application's. Any
limit or interval. Users, sessions, cookies: `@aweftjs/auth`, or whatever you load instead.

When a client sends bytes that are not a frame, the link ends and the connection with it:
the end functions run and the socket closes, so the client hears.

Every error this package raises carries a `reason`: `missing` (`createServer` without one of
its three), `route-conflict`, `no-accept`, `not-a-response`, `started`. The decisions are in
`docs/design/` 071 to 073.
