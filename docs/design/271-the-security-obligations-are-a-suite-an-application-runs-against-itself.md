# 271: The security obligations are a suite an application runs against itself

## Decision

`@aweftjs/testing` exports `securityChecks()`: one named obligation each, the shape of
`roomChecks()` (design 070), run against a server the caller starts. Each carries the ASVS 5.0
requirement id it proves (design 270).

```ts
interface SecurityCheck {
	readonly name: string;
	readonly requirements: readonly string[];
	run(start: StartTarget): Promise<void>;
}
interface StartOptions {
	readonly sources: readonly Source[];
	readonly gate: Gate | string;
	readonly handlers: { failed(name: string, error: unknown): void };
}
type StartTarget = (options: StartOptions) => Promise<SecurityTarget>;
interface SecurityTarget {
	fetch(path: string, init?: RequestInit): Promise<Response>;
	open(options?: { headers?: Record<string, string>; url?: string }): Promise<Opened>;
	readonly server: Server;
	stop(): Promise<void>;
}
```

`start` is the caller's. It loads what the suite hands it beside the caller's own: a store
declaring the auth paths, and a session battery answering `POST` and `DELETE /api/session` in the
shape `@aweftjs/auth` documents. It starts under the gate the suite names, which is the caller's
own gate (`securityChecks({ gate })`) with one rule of the suite's composed on top, marked by a
word of the suite's own so the caller's gate keeps its word `admin`. It hands the server the
handlers the suite gives it, so a module the suite breaks on purpose is reported to the suite
and the suite can assert the operator was told. `loadServer` (design 254) answers the target
shape as it is, so over the harness a case is one line, and a target is called through rather
than spread, so one whose methods live on a prototype keeps them. The suite runs over the
harness; a target over a real port would adapt `fetch` and `open` to it, and none ships, so the
transport's own bounds are pinned by the listener's tests and not by the suite. The suite ships
its own probe modules (a private one, a public one, one whose route and call throw, one reserved
for an administrator behind the composed gate, whose list no client can reach, one that shares
without `accept`) and imports no battery, so `testing` depends on none.

The suite is append-only: a case is added for every hole ever found and none is removed. A case
that cannot run because the caller left something out fails naming it; nothing is skipped.

It runs in three places: `packages/auth/tests/security.test.ts` with the real battery over the
harness; `recipes/full-stack/tests/security.test.ts`, the application every scaffold starts
from; and `packages/testing/tests/security.test.ts` over a session stand-in of a few dozen
lines, so the suite's own branches are covered by the package that ships it.

The first cases, each with the requirement it cites:

- a private module refuses an anonymous call, share and route, and a public one answers
  (V8.3.1, V8.2.2)
- the context a module sees is the gate's word and never the client's: a header, a body or an
  argument naming another user changes nothing (V8.3.1)
- one user reaches nothing of another's: the private share is their own, a write to it stays
  out of the other's (V8.2.2)
- a module reserved for an administrator refuses a signed-in user whatever they write into
  their own document, and the list the gate reads is out of their reach; the one way in is a
  grant from inside the process (V8.2.3, V8.2.1)
- a commit the module refuses is reported at the client with its undo, and the server's copy
  is unchanged (V2.2.2)
- the session cookie is HttpOnly, SameSite and Secure over TLS (V3.3.2, V3.3.4)
- every sign-in mints a new token of at least 128 bits, never repeated (V7.2.2, V7.2.3,
  V7.2.4, V11.5.1)
- after sign-out the old token is anonymous at the next handshake and the next request (V7.4.1)
- a foreign Origin is refused on a state-changing request and at the handshake, and passes on a
  read (V3.5.1, V4.4.2)
- more requests than the window allows from one address are 429 with Retry-After, and so is the
  handshake (V2.4.1)
- attempts on one email and from one address are counted, and hashing in flight is bounded
  (V6.3.1, V15.2.2)
- a password shorter than eight or longer than the ceiling is refused, and any composition of
  eight is taken (V6.2.1, V6.2.5, V6.2.9)
- a route that throws answers a bare 500, and a call that throws answers `failed` with nothing
  of the error, and the operator was told of both (V16.5.1)
- bytes that are not a frame end the link and the server goes on answering (V16.5.3)
- a share without `accept` never opens, and the operator was told (V8.3.1)

## Why

Design 070 is the pattern: a runner is not trusted to be a sandbox, it passes the escape suite.
A server is not trusted to be secure, it passes this one, and an application that boots its own
modules behind the same server passes it too. That is the point: the checks are not about the
stack's fixtures, they are about whatever is behind `start`.

Named obligations citing a requirement are what let `docs/security.md` say "verified by" and
mean it: `npm run security` checks that every `stack` row names a case here.

## What this costs

The auth routes are spoken by contract here, so a battery that replaces `auth` under another
route shape cannot run the session cases unchanged. Every case boots a server, so the suite is
seconds rather than milliseconds.

## Evidence

Each case was red against the code before its fix and green after. The three files above run
them in the gate.

## What would reverse this

A second session shape in the stack, which would want the session cases behind a seam the
caller fills.
