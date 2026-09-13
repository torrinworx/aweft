# 272: Limits and the Origin rule stand before the gate, and a broken module says nothing to a client

Amends designs 071, 072 and 073.

## Decision

`createServer` gains two options, both with a value here, both checked before `identify` runs:

- **`limits.requests`**, `{ count, windowMs }`, per peer address as the listener reports it,
  over a sliding window: 600 in 60 000 ms. The request or handshake over it is answered 429
  with a `Retry-After` header in seconds and the reasons `[{ code: 'limit', message }]`, and
  for a handshake no socket opens. `limits: { requests: false }` removes it. The address is the
  listener's word: behind a proxy the listener needs `forwarded` (design 273), or every request
  is one address.
- **`origins`**: when a request carries an `Origin` header and is a handshake or has a method
  other than `GET`, `HEAD` or `OPTIONS`, the origin's host must equal the request's own host,
  port included. Otherwise 403 with `[{ code: 'origin', message }]`, and no socket opens. A
  request with no `Origin` header passes: that is a client that is not a browser, and it holds
  no cookie a browser set. `origins: ['https://app.example']` adds hosts; `origins: 'any'`
  removes the rule.

Both stand in `createServer` rather than on the listener because a request carries both headers
whatever listener delivered it, and the harness (design 254) then exercises them with no port.

**A call that throws something other than a refusal** answers its caller `failed` with the words
`the call failed` and nothing of the error, and is reported through `handlers.failed` under the
module's name. A thrown refusal, one carrying a `reason`, crosses as before with its reason,
message and reasons: that is the shape a module throws on purpose, for the caller. Design 072
said a throwing call is not reported because the caller heard; the caller now hears only that it
failed, so the operator is told instead. With no `handlers.failed`, a call's error is written to
the console and the process goes on: any client can reach a public call, and a bug in one must
not be a way to end the process. A hook, a route or the gate that throws with no handler is
still raised where nothing catches it, as design 072 says.

**`sliding({ count, windowMs })` is exported**, the counter behind the limit, for a module that
counts something of its own: `take(key)` answers `{ ok: true }` or `{ ok: false, retryAfter }`
and `clear(key)` forgets a key. `auth/Enter` is the first such module (design 275). The map is
bounded at 65 536 keys: past it, the oldest key under its count among the oldest few is let go,
else the oldest, so a flood of fresh keys bounds the memory it costs without freeing a key at
its count, and only a flood that puts that many keys at their count frees one. `retryAfter` is
never more than the window, whatever the clock did.

## Why

Design 072 kept every limit out of `server`. A bound with no value is the one every deployment
forgets, and the sign-in route is public and runs a memory-hard hash on every request: an
unbounded rate on it is a memory exhaustion an anonymous client can cause. The count is coarse
on purpose: it is the outer wall, and the sign-in route keeps its own attempt counts (design
275). Sliding rather than fixed windows, because a fixed window lets twice the count through at
its edge.

The Origin rule covers the two things the browser's own rules do not. SameSite=Lax keeps the
session cookie off a cross-site POST and off a cross-site handshake, so a request forged from
another site arrives anonymous; it does not stop a sign-in forged from another site, which needs
no cookie and signs the victim in as the attacker, and it does nothing once an application
widens the cookie. A host comparison is what the standard asks for at the handshake, and a
client that is not a browser sends no header and is not in the rule's way.

A module's throw is the module's bug, and a bug's message names files, values and sometimes the
thing that was being looked up. The stack's refusals carry a reason and a fix on purpose and are
meant to cross; anything else was not written for the client.

## What this costs

One map entry per address seen inside the window, pruned as the window moves. Clients behind
one address share one count; a deployment with a fleet behind a proxy sets `forwarded` or
raises `count`. A page on another origin talking to the server has to be named in `origins`,
which it already had to be for its cookie to reach the socket. The caller of a call that broke
learns nothing of why from the answer; the operator's `handlers.failed` has it.

## Evidence

`packages/server/tests/limits.test.ts`: the request over the count in a window from one address
is 429 with `Retry-After` and a second address still answers; the window slides; the handshake
refuses at the same count; `false` removes it. `packages/server/tests/origin.test.ts`: a foreign
Origin is 403 on a POST and at the handshake and passes on a GET; the same host passes; a listed
origin passes; no header passes; `'any'` passes everything. `packages/server/tests/connection.test.ts`:
a call throwing a plain error answers `failed` with the fixed words and is reported; one
throwing a refusal crosses whole. `securityChecks()` (design 271) proves the three from outside.

## What would reverse this

A listener that can hand the server a trustworthy address behind any proxy, which would move
the count there; or a use of the socket from a page on many origins, which would want the rule
off by default.
