# 325: Calls on an open connection are counted by address

Amends design 272.

## Decision

`createServer` gains **`limits.calls`**, beside `limits.requests` and in the same shape:
`{ count, windowMs }`, or `false` for none. With nothing set it is 6000 in 60 000 ms.

It counts what an open socket asks the server to run: every `call` request, and every ask for
an offered document (design 310). The count is per peer address, the one the listener reported
at the handshake, across every connection that address holds, in one `sliding` counter. A peer
with no address counts as `'unknown'`, as a request does.

Over the count:

- A call is answered with the reason `limit`. The message says how many seconds until the next
  one fits. Nothing runs: the module is not looked up and the gate is not asked.
- An ask for an offered document ends the page's share with the reason `limit` and the same
  sentence. No module's `offer` is asked.
- The connection stays open. The next call inside the window is refused the same way, and the
  first one after the oldest counted call leaves the window runs.

A refused call is emitted to `observe` as a `call` event whose outcome is the refusal, as a call
the gate refused is. A refused offer emits nothing, as an offer a module refused emits nothing.

What is not counted:

- The sync link's binary messages. A frame is bounded by the listener's `maxPayload`, and a
  commit lands only where a share's `accept` allows it, so their cost is bounded by rules that
  already stand.
- The request named `''`, which a client sends to learn the other end is still there
  (design 317). It is answered before any module is reached.
- An open for a name no module could offer, because no module declares `offer`. Nothing runs
  for it today and nothing is sent.
- An open that a `connection` hook's own share paired with. The count is taken after the hooks
  have run, only for an open still waiting.

A bad `limits.calls` is refused when the server is made, with `invalid-limit`, as a bad
`limits.requests` is.

## Why

`limits.requests` counts a handshake once. After that, one socket could send calls with no
bound, each one a gate check and a module's work. The request count is the outer wall for HTTP
and this is the same wall for the socket.

The count is per address and not per connection because one address can open many connections,
each costing one request. A count per connection would multiply by the request count.

The value is ten times the request count. One page load is a handful of requests, and the page
it loads then asks many reads: a page built from cells asks one read per cell when it mounts and
again on each navigation, and several people behind one address share the count. 6000 a minute
is one address moving to a new page of twenty reads five times a second for the whole minute,
which no person does, and thirty people behind one address each doing so every six seconds.
An application that knows its own pages sets its own number.

The reason is `limit`, the code the request count already answers with, so a page has one word
for "too many, wait". The wait is in the message because an answer to a call carries a reason
and a message and nothing else. Adding a field to carry seconds would change what a request
frame holds for one refusal.

## What this costs

One more map entry per address that holds a connection, pruned as the window moves, and one
`take` per call.

People behind one address share one count. A deployment behind a proxy sets `forwarded` on the
listener, or every connection is the proxy's address and shares one count.

An observer hears every refused call, as it hears every 429. A module that records each event
still does that work for a call the limit refused.

A page whose share was refused with `limit` has to share the name again to ask again. A page
that reads the wait has to read it out of the message.

## Evidence

`packages/server/tests/limits.test.ts`: the call at the count runs and the next is refused with
`limit` and the wait, the module does not run, and the connection goes on answering; a second
connection from the same address shares the count and another address has its own; the window
sliding lets a call through again; an ask for an offered document counts and is refused with
`limit`; the request named `''` is not counted; `false` removes the count; the value with
nothing set is 6000; a bad value is refused at construction. `packages/server/tests/observe.test.ts`:
a call the limit refused is emitted as a `call` event with the refusal as its outcome.

## What would reverse this

A measured page that needs more than the default in ordinary use, which raises the number. A
client that needs the wait as a number, which would add a field to the request frame's error
and to `RequestError`. A listener that counts messages itself before they are parsed, which
would move the count there.
