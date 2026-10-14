# @aweftjs/client

One connection to an aweft server, for the life of a page. It makes the socket, attaches the
sync link and the request channel before the socket opens, shares documents, asks server
modules, and comes back on its own after a drop with the same document objects the page is
already holding.

## Quickstart

```ts
import { createClient } from '@aweftjs/client';

const client = createClient();                                  // the page's own origin
const board = await client.share<Board>('board').ready;         // the server's document, here
board.title = 'renamed';                                        // applies here, and goes

const report = await client.ask('notes/Export', { month: '2026-09' });
client.status.effect((now) => banner.hidden = now === 'open');
```

`createClient({ url?, open?, reconnect?, timeout? })` returns one connection. Nothing is held
at module scope, so a page with two servers makes two clients.

The socket is made before `createClient` returns, and the link and the request channel are on
it, so the share and the ask above reach the server even though they are written while the
socket is still connecting. That order is the point of this package: a server's hooks run at
the handshake and its first frames are on the wire before the browser fires `open`, and a
message that arrives before anything is listening is lost.

## Where it is: `status`

```ts
client.status.effect((now) => banner.hidden = now === 'open');   // follow it
if (client.status.get() === 'open') send();                      // or read it once
```

`client.status` is a read-only cell of `'connecting'`, `'open'` or `'closed'`. It reads
`connecting` while a socket is coming up, `closed` after a drop and between retries, and
`closed` for good after `close()`. Writing it throws `read-only`.

## Asking a module: `ask`

```ts
const report = await client.ask('notes/Export', { month: '2026-09' }, {
	progress: (value) => bar.set(value),
	timeout: 5000,
});
```

The arguments, the result, `progress` and a refusal's `reason` and `reasons` are exactly what
`@aweftjs/sync`'s `requests` carries; this adds when the ask goes out. While no socket is open,
an ask waits and goes out on the next socket that opens. An ask already in flight when the
socket drops rejects with `closed` and is never sent again, because it may have had a side
effect at the far end. `timeout` on the options wins over `timeout` on the client, and neither
ships a default.

## A cell that follows an ask: `asking`

```ts
const query = mutable('');
const found = asking<Post[]>(client, 'posts/Search', query.map((text) => ({ text })));

found.get();   // { state: 'waiting', data: null }, then { state: 'ready', data: [...] }
```

`asking(client, name, args?, options?)` is a read-only cell of the latest answer to
`client.ask(name, args)`. `args` may be a cell, and every value it takes asks again. An answer to an
ask a newer one replaced is dropped, so a slow answer to an old query never lands over a new one.
It reads:

- `{ state: 'waiting', data }` while an ask is out. `data` is the last answer's, or `null` before
  the first, so a list dims in place rather than blanking.
- `{ state: 'ready', data }` with the answer.
- `{ state: 'failed', data: null, error }` with what the ask rejected with: a refusal's `reason`,
  `timeout`, or `closed` when the socket dropped under it. It is not asked again on the next
  socket.

**It asks only while something watches it**, the way a cell from `fromEvent` listens only while
watched. The first watcher asks. When the last one stops, an answer still out is dropped, and the
next watcher asks again with the arguments as they are then. A component that unmounts stops
watching, so nothing has to stop it. `found.get()` with nothing watching reads the state it holds
and asks nothing. Writing it throws `read-only`.

`options.pending` is handed the first ask, settled either way: a component passes its own
`pending` (its fourth argument), and a render on a server waits for the answer. `options.timeout`
is each ask's.

**A page that hydrates reads `waiting` first.** The answer a server's render recorded arrives a
microtask after the hydration starts (`@aweftjs/ssg`'s `replay`), so a component that draws its
waiting state builds elements the server sent no pair for. A page that must keep the server's
markup reads its first answer through `ui`'s `suspend`, which draws nothing while a hydration is
open (design 312).

## Sharing a document: `share`

```ts
const shared = client.share<Board>('board', undefined, {
	accept: (commit) => mine(commit) ? [] : [{ code: 'not-yours', message: 'someone else\'s row' }],
	fault: (reason, message) => report(reason, message),
});
const board = await shared.ready;
shared.stop();
```

One handle per call, holding one document object for its whole life. Every socket after the
first re-shares that same object and pulls the server's state onto it in place, so the page's
watchers see a reconnect as ordinary commits and nothing is rebuilt. `handle.document` reads
`undefined` until the first arrival and the same object forever after.

`accept` and `refused` are `sync`'s, untouched: `refused` is called with
`{ mine, seq, reasons, commit, undo }` for a commit that did not apply at either end, and `undo`
is the commit that takes yours back here, which the page applies itself or ignores to keep its
version. `sync`'s README, under "A refusal is reported at both ends", is the whole of it.
`fault` hears every fault except the `closed` a
dropped socket raises on every topic, which is this package's own business and is answered by
the next socket. A `root-mismatch` after a reconnect does reach `fault`: the server now holds a
different document under that name, and the page has to hear so.

`ready` resolves with the document on its first arrival. It rejects with `closed` when the
client is closed before that, and with the topic's own fault otherwise. `stop()` stops the current
socket's share, which sends `leave`, and takes the handle off the list re-shared on later
sockets.

**A share is how a page asks for a document by name.** A server module that declares `offer`
(`@aweftjs/server`'s README, design 310) opens the document when a page shares a name no share on
its connection is waiting for, and shares it back. A module that refuses ends the share: `ready`
rejects with the module's reason and message, and `fault` hears them. Because every handle is shared
again on every new socket, the page asks again after a drop with no code of its own, and the
document lands on the object it already holds. A refused handle is shared again too, so after a
sign-in, which reconnects, the module is asked as the person who is now signed in. Its `ready`
rejected with the refusal and stays rejected, so the page reads the document off `handle.document`
once it arrives, or shares the name again for a `ready` of its own.

**A link carries one topic per name, so share a name once per client.** A second share of a name
that is already live waits for an offer that never comes, and so does `share('')` and a share of a
name nothing on the server shares, unless a server module's `offer` answers it: a module is asked
about each of them (design 310). Otherwise their `ready` never settles: nothing refuses them, and
nothing answers them either.

**A write applies here at once and crosses on the next frame.** Reading it back through a
server module on the next line can therefore race the frame that carries it, because the link
carries no acknowledgement of a commit today.

## Coming back: `reconnect`

Automatic and on by default. After a drop the client waits 500 ms, then 1000, doubling to a
10 000 ms cap, and goes back to 500 as soon as a socket opens. Where the page globals exist it
also tries at once when the browser fires `online` and when the tab becomes visible, and it
lets go of both listeners on `close()`. `reconnect: false` turns the automatic retry off and
leaves every attempt to the application.

`client.reconnect()` drops the socket and opens a new one now, with the delay reset. That is
the call to make after signing in or out over HTTP: a browser cannot set a cookie on an open
socket, and identity is fixed for a connection's life. On a client that was closed it does
nothing.

**An edit made while `status` is `closed` is lost.** The reconnect moves the document to what
the server holds, so anything typed while there was no socket is gone. An application that must
not lose one turns the automatic reconnect off, or waits for `open` before writing.

## Ending it: `close`

`client.close()` stops reconnecting, ends the link and the socket, rejects every held ask with
`closed`, tells every live handle `closed` through its `fault`, rejects a `ready` that never
arrived, and drops the page listeners. Calling it twice is not an error, and nothing opens a
socket afterwards.

## Outside a browser

Two seams, and a page needs neither.

- `url` defaults to the page's own origin with the `ws` or `wss` scheme and path `/`. Where
  there is no `location`, `url` is required and its absence is refused with `no-url`. Behind a
  dev server's proxy the socket takes a path of its own, `/ws`, proxied with `ws: true`, because
  a proxy entry for `/` takes the dev server's own socket with it; [`recipes/full-stack/`](https://github.com/torrinworx/aweft/tree/main/recipes/full-stack) is that
  setup.
- `open(url)` makes the socket, `new WebSocket(url)` by default, which Node has too, so a script
  with no session needs neither seam beyond `url`. A Node program that signs in hands in one that
  carries a cookie header:

```ts
const client = createClient({
	url: 'wss://app.example/',
	open: (url) => new WebSocket(url, { headers: { cookie } }) as unknown as SocketLike,
});
```

## What this package never decides

- Who is on a connection, or whether one may open. That is the server's gate.
- Which documents a page shares, or what a refusal means to it.
- Where the backend is, beyond the page's own origin. An application declares it; nothing here
  sniffs it from anywhere else.
- Whether an edit made while offline survives. It does not: the server's state wins on every
  reconnect.
- How long a session lasts, or who the user is. Signing in and out, and the `user` cell a page
  renders, are `@aweftjs/auth/client`, over a client this package made.

## When something is refused

Every error carries a `reason`: `no-url` (no `url` and no page origin to read one from),
`closed` (asking or sharing on a client that was closed), and `timeout` (a held ask whose
timeout ran out before any socket opened). Everything else a caller sees comes from below:
`sync`'s own `closed`, `not-data` and `timeout` on an ask that was sent, and a module's own
reason for a refusal.

The design notes are in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design): 183 (what this
package is and what it opens), 184 (the reconnect, and the server winning), 310 (a share a server
module offers) and 312 (`asking`).