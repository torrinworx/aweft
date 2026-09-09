# 183: `client` is the client plane's mirror of `server`

## Decision

`@aweftjs/client` is a package on the client plane, tier 6, beside `dom`. It imports `codec`,
`core` and `sync` and nothing above them. It owns one connection to an aweft server for the life
of a page: it makes the socket, attaches the link and the requests before the socket opens, asks
server modules, shares documents, and comes back after a drop (design 184).

```ts
import { createClient } from '@aweftjs/client';

const client = createClient({ url: 'wss://app.example/' });
const board = await client.share<Board>('board').ready;
const report = await client.ask('notes/Export', { month: '2025-03' }, { progress: (p) => bar.set(p) });
```

`createClient({ url?, open?, reconnect?, timeout? })` returns one connection, an instance: nothing
is held at module scope, which is design 109's rule for `ui` applied here. `url` defaults to the
page origin with the `ws` or `wss` scheme and path `/`, and is never sniffed from anything else;
with no `location` in scope it is required, and its absence is refused with the fix. `open(url)`
makes the socket, `new WebSocket(url)` by default; a Node program hands in one that carries a
cookie header, which is the one seam the recipe needs. `timeout` is the default for every ask and
none ships, as `sync` ships none.

The client exposes `status`, a read-only cell (`connecting`, `open`, `closed`); `ask`, the request
channel of the current socket; `share`, a handle per name; `reconnect()`; and `close()`.

An ask made while no socket is open waits for the next one and goes out on it, bounded by its own
timeout when it has one. An ask on a client that was closed rejects `closed`.

The auth battery's client half is `@aweftjs/auth/client` (design 185), a subpath the way
`@aweftjs/ssg/client` is one. It takes a client and adds identity on top; it does not open sockets.

## Why

Every page against an aweft server wrote the same 90 to 140 lines, and the ordering is the part a
newcomer gets wrong: the server's first frames are on the wire
before the browser's `open` event, so a link or a request channel attached late loses them. The
auth README, design 074 and the architecture all deferred this to the client runtime. This is it.

A package of its own rather than a subpath on `sync`, because design 053 says `sync` has no host,
no client and no session, and a thing that reconnects and holds a socket is a client. Not all of
it under `auth`, because a server with `gate: open` still wants a connection. The plane table
already had the hole: `server` and `jobs` on one side, `dom`, `ui` and `icons` on the other, and
nothing on the client side that talks to a server.

## What this costs

A package whose whole job an application could write in a hundred lines, which is what this repo
usually refuses. It ships because those hundred lines were written five separate times and were
wrong in the same place each time.

## What would reverse this

`sync` growing a channel that reopens itself, which would put the reconnect below this package
and leave it with the identity half only. Design 053 stands against that today.
