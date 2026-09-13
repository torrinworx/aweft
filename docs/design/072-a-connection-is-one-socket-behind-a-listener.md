# 072: A listener accepts, and a connection is one socket carrying a link and a call channel

## Decision

**The listener.** `server` opens nothing itself. A `Listener` is `start({ request, socket })`
and `stop()`, the way a `store` driver and a `sandbox` runner are a contract with one shipped
implementation. `request(request, peer)` answers a web-standard `Request` with a `Response`.
`socket(request, peer)` is the WebSocket handshake: it answers a `Response` to refuse the
upgrade, or a function that takes the opened socket to accept it. `peer` is `{ address }`.

`node(options)` ships on `@aweftjs/server/node`: Node's `http` module plus `ws`, the stack's
one runtime dependency, allowlisted for this package alone. `node({ port, host })` owns a
server and closes it on `stop`; `node({ server })` attaches to a server the application made
(for TLS, or to share a port) and leaves its lifecycle alone. `heartbeatMs` pings every open
socket and terminates one that does not answer; `maxPayload` bounds a message. Neither ships
with a value of ours; without `heartbeatMs` nothing pings, and without `maxPayload` the
transport's own bound stands. The listener's `port` is readable after `start`, so a test can
listen on 0. A listener written outside this repo proves itself with `listenerChecks()` from
`@aweftjs/testing`.

**A connection.** One socket carries two things: the sync link, as binary messages, and the
call channel, as text messages (design 073). The server makes both from the one socket,
runs the `connection` hook of every loaded module that has one, in load order, for the
modules the gate allows (design 071), and hands each `{ link, request, context, close }`.
A hook may return the function to run when the connection ends; those run in reverse order.
`close()` ends the connection from inside a hook, which is how a middleware module kills one.

The link a hook receives requires `accept` on every `share`: a share without it
throws `no-accept` before anything crosses. `open` is the handlers for the trusted case.

**Calls.** A request frame naming a module is routed to that module's `call(args, context,
{ progress })` after `access`. No such module, or one without `call`, is `missing`; a refused
one is `refused` with the reasons; one that throws is `failed` with the message.

**Routes.** A module's `routes` is a plain object keyed by exact `METHOD /path`. A request
runs `identify`, matches the key against the loaded modules' routes, runs `access` for the
module that owns it, and calls the handler with `(request, context)`. No match is 404. Two
loaded modules declaring one key is refused at `start()` naming both; a conflict that a
later load introduces is answered 500 by the request that meets it, and reported.

**Failure.** A `connection` hook that throws closes the connection. A route that throws
answers 500. Both, and a throw out of the gate, reach `handlers.failed(name, error)`;
without a handler the error is raised where nothing catches it, as `follow` does. A
`call` that throws a refusal answers its caller with it and is not reported, because the caller
heard what the module meant it to; one that throws anything else answers `failed` with nothing
of the error and is reported (design 272).

`server` decides nothing about who may write a commit (that is `accept`, per share), which
modules load (the application's), or any limit or interval.

## Why

Plugging in any server is what the listener contract is for: a runtime that speaks
`Request` and `Response` writes one, and the Node one is the proof that the contract is
enough. Web-standard types rather than Node's, so that means any runtime and not
any Node server. `ws` rather than a frame parser of our own, because the server
side of the protocol is three hundred lines of parsing hostile input and the escape-suite
mindset would then have to cover it.

One socket per connection, because the handshake cookie is what identifies it (design 074)
and two sockets would mean two identities to keep in step. The link ignores text and the
call channel ignores binary by construction.

Hooks in load order, because load order is dependency order, and a module's hook may rely
on a dependency having set its own connection state up first.

## What it costs

A connection's identity is what the handshake said; a client that signs in reconnects. A
listener author has to write the upgrade path by hand for their runtime; the Node one is the
worked example. `handlers.failed` is one more thing to wire, or one more uncaught error.

## What would reverse this

A runtime where one socket cannot carry text and binary both (there is none among the
WebSocket implementations this stack targets), or a need for the server to own
reconnection. Either is a new design note.

## Amended

Six findings changed what this note describes; each is a mechanic inside the rules above.

- **The socket ends with the link.** Bytes that are not a frame end the link (`spec/replication.md`
  section 1), and the socket adapter closes the socket with it (design 073, amended), so
  the connection's teardown and the socket's close are one event. Earlier, a client that sent
  one bad binary message had its connection torn down while its socket stayed open, and every
  later ask waited forever. The server itself holds no second close: dropping one changes
  nothing observable, because the adapter's close is the one that can be seen.
- **A call is answered after the connection's hooks have run.** The client's first ask can be
  on the wire before the handshake's hooks have finished, and a module that sets connection
  state up in `connection` has to find it in `call`.
- **A route that answers with something that is not a `Response`** is reported as
  `not-a-response` and answered 500, the same as a route that throws.
- **`forwarded`** on `node()`: behind a proxy the listener sees the proxy's socket, so the
  scheme (which decides the cookie's `Secure`) and the peer address come from
  `x-forwarded-proto` and `x-forwarded-for` when the application says the proxy is trusted.
  Off, both headers are ignored. No value ships.
- **`maxPayload` bounds an HTTP body** as well as a WebSocket message: a declared length over
  it is 413 before the body is read, and a body that crosses it is cut off where it does.
  Without it a body is unbounded, and the sign-in route is public.
- **A module reloaded while a connection is open** keeps that connection's hook state on the
  instance that made it, and its end functions belong to that instance; calls and routes go
  to the new one. The README says so.
