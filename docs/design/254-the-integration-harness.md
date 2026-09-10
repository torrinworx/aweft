# 254: The integration harness, and the two things it refuses to know

## Decision

`@aweftjs/testing` covers one module in isolation (`loadModule`) and one mount
(`recordingDocument`). It does not cover the level between those and a real deployment: a server
with real modules, a connection to it, and a database that goes away. Four things ship for that.

**`socketPair()` returns two ends of one socket, wired to each other, with no port.** What one
sends the other hears on a microtask; closing one closes the other; each records what it sent.
It behaves the way a real socket does at the edges, because a harness that is kinder than the
transport lets a suite pin something a deployment then breaks: a send before the socket is open or
after it closed reaches nobody, a listener added mid-dispatch does not hear the event it was added
by, and a listener that throws does not stop the ones after it.

An end also carries `peer` and `fire`, which are how it is wired and how an event is delivered to
it. They are public because a suite driving a client's retry has to hand the page its `open` event
itself, which is what `fire('open', {})` is for.

**`loadServer({ sources, gate })` boots a real server on a listener that opens nothing.** It
mirrors `createServer`'s options minus the listener, which is the part a test cannot supply and
the only reason a test would otherwise write its own. It answers with the server, `fetch` for the
HTTP half, `open` for a socket connection through the same handshake, and `stop`.

**`settle(rounds?)`** is the tick loop, ten rounds by default, refusing anything that is not a
whole number of one or more. A suite that settled for its own number keeps passing that number:
the default is this package's, not a decision about anyone else's convergence.

**`@aweftjs/testing/postgres` answers `throwaway()`**: an embedded cluster, a pool, and a teardown.
It takes how the two peers are reached, so the not-installed refusal is checkable without
uninstalling one, which is the shape design 251 used. Every pool it hands out listens for its own
errors, because stopping the cluster drops every connection still open and a pool with no listener
turns that into an uncaught exception in whatever test is running. Its `stop` never lets a pool a
caller already ended keep the cluster alive.

### `socketPair` is not `inProcess`

`sync` exports `inProcess(): [Channel, Channel]`, and a channel is not enough here. A channel is
one plane. The listener seam hands over a `SocketLike`, and one socket carries both the link and
the call channel; `requests(socket)` and `fromWebSocket(socket)` each take the socket, and a
channel cannot be split back into one. The client's retry also reads `readyState` and the `close`
event, which a channel does not have. So the pair is at the socket level, and `inProcess` stays
the answer for a link with no server under it.

### The harness does not depend on the auth battery

The sequence a signed-in test needs is a POST to a session route, the `Set-Cookie` off the answer,
and a socket opened carrying it. It is tempting to ship, and it would tie the harness to one
battery's routes and its idea of what a session is. `loadServer` gives `fetch` and `open` instead,
which are the two seams that sequence needs, and the sequence itself is three lines in the test
that wants it. An application with its own gate and no `auth` gets the same harness.

### The database is an optional peer behind a subpath

`embedded-postgres` unpacks a database server. Every application that installs `@aweftjs/testing`
would carry it, including the ones that never open a store. So it sits behind `/postgres`, reached
through `await import` in a `try`, refusing with the name to install: design 140's shape, and the
one design 251 used for the country data.

## Why

The four hand-written copies are the evidence. `packages/server/tests/helpers.ts` and
`packages/sync/tests/behavior.sync.test.ts` each define a function named `socketPair`;
`packages/client/tests/helpers.ts` and `packages/auth/tests/helpers.ts` each define the same
socket under the name `fake`. A local `settle` or `tick` is defined in 22 files. The sign-up and
`getSetCookie` and socket-with-cookie sequence appears in ten. `recipes/documents-on-postgres`
starts a cluster with its own port search and teardown.

Four copies of one socket is the anti-pattern this repo names: a second DOM mock or an overlapping
API. They also drift. Two of the four record what was sent and two do not, and the two that do
disagree about nothing else, which is what makes the drift hard to see and worth removing.

The definition of done already requires that an export a harness covers goes through the harness.
Until now there was no harness at this level to go through, so the requirement had nothing to bind
and each package answered it alone.

## What this costs

**Every suite that connects is now coupled to one socket.** A bug in `socketPair` is a bug in four
packages' suites at once, where before it was a bug in one. That is the trade the requirement above
already chose, and the harness carries its own tests for the lifecycle the four copies share:
delivery on a microtask, close propagating to the peer, a close after a close doing nothing.

**`loadServer` can boot only what `createServer` can.** It takes sources and a gate and builds its
own loader, so a test cannot inject a loader or a prop, exactly as an application cannot
(design 240). A test that wants a stub reaches for `loadModule` instead, which is the level that
takes one.

**The socket is not a WebSocket.** It carries `readyState`, `send`, `close` and the two events the
stack listens for, and nothing else: no backpressure, no ping, no partial frame, no `bufferedAmount`.
A behaviour that depends on any of those is not reachable here and belongs in a recipe that takes a
real port.

## What is still three copies

`throwaway` is what this package's own suite uses. `packages/store/tests/postgres.test.ts`, the
Postgres recipe and the store benchmark each still boot a cluster of their own, and moving them is
its own piece of work: those files point a pool at a schema they never create, so `search_path`
falls back and the checks share one, and untangling that is a change to what they test rather than
to how they start a database.

`packages/sync/tests/requests.test.ts` keeps a socket of its own on purpose. It is the suite for
the call channel, and running it over this package's socket would check the harness rather than the
thing under test.

## What would reverse this

A second listener seam. `loadServer` supplies the listener because there is one shape of it; if the
server grows a second way to accept a connection, the harness either grows an option or goes back to
being written per suite.
