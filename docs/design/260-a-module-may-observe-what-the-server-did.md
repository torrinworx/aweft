# 260: A module may observe what the server did

Amends design 072.

## Decision

A server module may carry a fifth optional hook beside `connection`, `call`, `routes` and
`request`:

```ts
observe?(event: ServerEvent, context: C): unknown;
```

The server hands every event it produces to every loaded module that declares `observe`, in
load order, read off the loader at each use the way the route table is. The events, each with
`at`, the time it was made:

- `connection`: a socket the gate let in, before any `connection` hook has run; carries the
  handshake `request`.
- `closed`: that connection ended; carries `ms` since it opened.
- `call`: an `ask` answered, with the module `name` and its `instance` as the loader holds it
  (absent when nothing is loaded under the name), the `args` as the caller sent them, `ms`, and
  the `outcome`: `{ result }`, or `{ error }` with what was thrown, which for an ask that never
  reached a module is the server's own `missing`, `refused` or `closed`. The instance is there
  so a consumer can read a word the module carries, the way the gate reads `public`.
- `request`: an HTTP request answered, with `method`, `path`, `status`, `ms`, and `name`, the
  module whose route or `request` hook answered it, absent when the server answered itself.
  Never the body.
- `refused`: a commit a share's `accept` refused, with the `topic` and the `reasons`.
- `failed`: what reaches `handlers.failed`, with the `name` and the `error`, except an
  observer's own throw.

`context` is what `identify` answered for the connection or the request the event belongs to.
The same reference reaches every hook and every event of one connection, so a module that
needs to tell connections apart keys on it; a gate that answers a primitive gives it nothing to
key on, and both shipped gates answer an object.

The hook is not gated: the server is telling its own modules what it did, and modules in one
process trust each other (design 071). The server neither waits for an observer nor reads what
it answers: a promise's rejection and a throw are reported under the observer's name through
`handlers.failed`, and never emitted as a `failed` event, so an observer that throws on every
event does not chase its own tail. The event an observer threw on is unaffected.

## Why

A module can hear its own hooks and nothing else. What the server did for a connection as a
whole, which modules were asked, what was refused, what threw, was known to the server and
told to no one but `handlers.failed`, which is an option on `createServer` rather than a
module, so an application that wanted a record of it wrote one outside the module system.
This hook is the same shape as design 248's: a module declares it, the server walks the
modules that did, and any number of consumers hear the same events. A logging battery is one;
a metrics module or a harness is another, with nothing added here.

The server interprets nothing in an event, as it interprets nothing in a context: `args` and
`result` are handed whole, and whether to keep, redact or drop them is the consumer's rule.
That keeps the one policy this stack has about call data where it was, with the module that
owns the data.

## What this costs

Every call, request, connection and refusal pays a walk over the loaded modules to find the
observers, and one function call per observer. A server with no observer pays the walk.

An observer that is slow does not slow the call it observed, because nothing waits for it; an
observer that does heavy work on every event is a load on the process all the same, and
nothing here bounds it.

`args` and `result` are the caller's objects, not copies. An observer that mutates them
changes what the module or the caller sees, and nothing here prevents that.

## Evidence

`packages/server/tests/observe.test.ts`: every kind of event in order for one connection that
asks, is refused, and closes; a route, a fallthrough answer and a 404 as `request` with the
answering module's name or none; a share's refusal as `refused`; a throwing hook as `failed`; an
observer that throws is reported under its own name, the event still reaches the observer after
it, and no `failed` event is emitted for it; an observer whose promise rejects likewise; the
context reference handed to `observe` for a call is the one the call received; a module loaded
after start is an observer from then on. Proven to fail: dropping the guard against re-emitting
an observer's throw makes the recursion case time out.

## What would reverse this

A need to observe accepted commits per connection, which is one more event kind in this hook
rather than a new seam. A need for the peer address on an event, which the gate can put in the
context today and which would otherwise be a change to what `identify` is handed.
