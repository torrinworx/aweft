# 071: The gate decides who reaches a module, and a module never decides for itself

## Decision

`server` has one seam for who may do what, and it is required: `createServer({ loader, gate,
listener })` refuses to start without a gate, and no gate ships as a default. A gate is any
object with two functions:

- `identify(request, peer)` runs once per connection and once per HTTP request, before
  anything else does. It answers `{ context }` with whatever it resolved, or `{ refused:
  reasons }`. Refused, the server answers 401 with the reasons, and for a WebSocket that is
  the handshake: no socket is ever opened. `peer` is `{ address }`, because a web-standard
  `Request` carries no address and a gate that keys on one has nowhere else to read it.
- `access({ name, instance }, context)` runs before a module sees a connection, a call or a
  request. It answers the reasons to refuse; empty allows. A refused call answers its caller
  `refused` with the reasons; a refused request answers 403 with them; a refused connection
  hook is not run.

The server interprets nothing in the context and reads nothing off a module on the gate's
behalf. It accepts the socket, asks, and does what the gate said. Both functions may be
asynchronous. A throw out of either is a defect, not a refusal: it answers 500, or closes
the connection, and is reported through `handlers.failed`.

What `identify` resolved reaches every hook as an argument and never as ambient state:
`connection({ link, request, context, close })`, `call(args, context, { progress })`, and a
route `(request, context)`. A module that wants to know who is asking reads its argument.

A module never checks identity. It may declare `public: true`, and the auth battery's gate
reads that word: absent means private. `server` does not know the word; a gate that means
something else by it, or reads another, is free to.

A module instance is a gate when it carries the two functions, so `loader.load(['auth/Gate'])`
answers with one that has the store injected, and a gate that composes two policies is a
module whose `access` calls both. Anyone writes their own gate, session system or auth
library against the same two functions.

Calls from one module to another through `imports` are not gated (design 067 already says
modules in one process trust each other). The gate is between the outside and a module.

`open` is exported and is the trusted case at both seams: as a gate it identifies everyone
with an empty context and allows every module; as the handlers of a `share` it accepts every
commit (design 072). `gate: open` is the one word a microservice types, and it is greppable.

Reasons are core's `Refusal`, `{ code, message, path? }`, wherever a gate speaks, the same
shape a link's `accept` answers with.

## Why

An earlier shape had a module reach auth through its own `deps`, so a module was public
whenever it forgot to, which leaves an agent able to forget it needs to import auth. A module
that is public by omission is the wrong default in a stack whose modules are written by agents.
Modules do not have to authenticate requests and should not need to: they are atomic,
individual things. Who may reach a module is something the batteries or an application
declares. The server itself just allows connections over a websocket, and allows middlewares to
kill connections; it does not determine whether a connection is allowed or valid, and only the
gate is allowed to determine that.

So the seam is required, so it cannot be forgotten; it is outside every module, so no module
decides; and it is two plain functions, so nothing about it is this package's to own.
`public` rather than `authenticated: false` because a double negative is what gets typed
wrong.

`identify` answering a value rather than throwing keeps the ordinary case (an anonymous
client) out of an exception path, and keeps a defect in a gate (the store is down) apart
from a refusal: one is 500 and the other is 401, and a gate that had to throw for both would
have to pick.

## What it costs

Every application writes or loads a gate, even one that wants none: `gate: open`. A gate runs
`access` per hook per connection and per call, so an `access` that reads a store on every
call is the application's cost to notice.

## What would reverse this

A default gate, or a module able to declare who may reach it in a way the server enforces.
Either would be a new design note.
