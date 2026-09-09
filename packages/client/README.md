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

**A link carries one topic per name, so share a name once per client.** A second share of a
name that is already live waits for an offer that never comes, and so does `share('')` and a
share of a name the server never offers. Their `ready` never settles: nothing refuses them, and
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
  a proxy entry for `/` takes the dev server's own socket with it; `recipes/full-stack/` is that
  setup.
- `open(url)` makes the socket, `new WebSocket(url)` by default. A Node program hands in one
  that carries a cookie header, which is how a script signs in:

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

The design notes are in `docs/design/`: 183 (what this package is and what it opens) and 184
(the reconnect, and the server winning).
