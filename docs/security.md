# Security

The stack's security standard is the OWASP Application Security Verification Standard (ASVS),
version 5.0, at level 2, the way its components hold to WCAG 2.2 AA. This file says what that
claim means, what the stack owns, what an application built on it still owns, and the rules that
keep the second list short.

## The claim

Every level 1 and level 2 requirement in the standard has an owner in
[`security/asvs.csv`](security/asvs.csv): `stack`, `application`, `operator` or `none`. A `stack`
row names the check that proves it: a case of `securityChecks()` on `@aweftjs/testing`, a test in
a package's own suite, or a section of a document. `npm run security` fails when a `stack` row
names a check that does not exist, or a case cites a requirement the table does not give to the
stack, and the root gate runs it. So "the stack meets every requirement it owns" is a sentence
the gate checks, and the `application` rows are the whole list an application has left to do.
Each of those rows names the pattern or the tool that meets it. `npm run security` prints the
counts.

The standard is written for applications. A framework meets the requirements it builds
(sessions, the gate, the bounds, the encoders, the files it serves) and cannot meet the ones that
depend on what the application stores and who its users are. Level 2 rather than 1, because
anything with a sign-in is past level 1 by the standard's own guidance; rather than 3, because
level 3 asks for what sits outside one process.

The table carries ids and the stack's own columns only. The requirement text is the standard's,
at https://owasp.org/www-project-application-security-verification-standard/ .

## What the stack owns

- **The gate.** Required, outside every module: `identify` once per connection or request,
  `access` before a module sees a connection, a call or a request. A module is private unless it
  says `public: true`, and one that says `needs: 'admin'` is for a signed-in person who holds
  that name, read live off `roles:<user>` at every check. The context a module sees is the
  gate's word and never the client's: no header, body or argument moves it.
- **Sessions.** Tokens are sixteen bytes from the platform's secure source, a new one on every
  sign-in, dead at the next handshake and request after sign-out, swept once over for thirty
  days. The cookie is HttpOnly, SameSite=Lax, Secure over TLS. Passwords are eight to 256
  characters of any composition, hashed with scrypt, compared in constant time, and never
  stored.
- **The bounds.** Six hundred requests a minute per address before the gate. Five sign-in
  attempts per email and twenty per address in fifteen minutes, eight password hashes in
  flight. A body and a frame of at most 1 MiB. Every number is a default one line of
  configuration widens or removes.
- **Origin.** A browser that names another origin is refused on a state-changing request and
  at the handshake; a client that names none passes.
- **Errors.** A route that throws answers a bare 500. A call that throws anything but a
  refusal answers `failed` and nothing of the error; the operator hears it through
  `handlers.failed`, or on the console when there is none, and the process goes on. Bytes that
  are not a frame end the link and nothing else.
- **The encoders.** `decodeCommit`, `decodeValue` and `decodeFrame` parse what an attacker
  sends and answer or refuse in the stack's own shape, never anything else, under seeded fuzz.
  A slot named `__proto__` is a slot.
- **Files.** The static battery decodes a path once, refuses `..` and dotfiles, serves the type
  its table says, lists nothing, and answers `nosniff` on everything; every answer the server
  gives carries the same header.
- **Drawings fetched at run time.** `fromUrl` refuses a body that can run or reach out.
- **What the logs hold.** The logs battery records no typed value, no private slot, and no
  password field's key.

## The rules an application follows

1. **Authority lives in a document the user cannot write, and the gate reads it.**
   `auth/State` shares the user's own document and accepts every commit, because it is theirs.
   A `role` kept there is the user's to set. `auth/Roles` keeps the names a person holds in
   `roles:<user>`, shared to its own user read-only and written only by `grant` from a module
   of the application inside the process; `auth/Gate` reads a module's `needs` against it, and a
   module reads `imports.Roles.may` for anything finer than a module. No route grants. The
   server reads no such word: the auth gate gives it meaning. `securityChecks()` proves this
   shape with its administrator case, over a gate of its own composed on yours and a word of
   its own, so your gate's word is untouched.
2. **Never share a document holding a secret.** A document shared to a page or into a room
   crosses whole, underscore slots included. The leading underscore keeps a slot from wildcard
   observers, and so from the logs, not from the wire. A secret goes in a document nobody
   shares, or in a slot of a module's instance.
3. **Every share says who may write.** A share on a connection without `accept` ends the
   connection. In `accept`, refuse what the module does not own: a commit is `deltas`, and a
   write to a slot of the root object is a delta whose `ref` is `{ kind: 'object', key }`, so
   `commit.deltas.some((d) => d.ref.kind === 'object' && d.ref.key === 'owner')` is the check
   that keeps `owner` the module's. `check` from `@aweftjs/schema` is the tool for a whole
   shape.
4. **Behind a proxy, read the proxy's entry.** `forwarded: true` or `forwarded: 'x-real-ip'` on
   the listener, or every request is one address and the counts see the whole internet as one
   client.
5. **Over TLS, name the cookie `__Host-session`.** `cookie` on `auth/Session`'s configuration.
   The prefix makes a browser refuse the cookie over plain HTTP, which is why it is not the
   default.
6. **A content security policy, HSTS and a referrer policy are yours.** The stack sets
   `X-Content-Type-Options: nosniff` on every answer and no other page policy, because a policy
   depends on what the page loads.
7. **Pass `handlers.failed`.** A call that throws is written to the console when there is no
   handler and the process goes on. A hook, a route or the gate that throws with no handler is
   raised where nothing catches it, and the process says so and ends. That is loud on purpose
   in development; in production, a route bug a client can reach is then a way to stop the
   process, so pass a handler.
8. **Run the suite against your own application.**
   [`recipes/full-stack/tests/security.test.ts`](../recipes/full-stack/tests/security.test.ts) is
   the whole file: your sources, your store, your gate, every case.

## Accepted risks

- **Enumeration.** `auth/Check` answers whether an email has an account, and a sign-up answers
  201 where a sign-in answers 200, so anyone can learn whether an address is registered. A
  sign-in form asks before asking for a password, and one route signs up and in. What makes it
  survivable is the attempt count: knowing an address exists buys five tries in fifteen minutes.
- **A store that can be read holds the tokens.** A session token is the name of its document.
  The store is the application's boundary.
- **Counts are per process, and bounded.** The request and attempt counts are in memory; a
  restart clears them, and a fleet counts per instance. Each holds at most 65 536 keys, and
  past that the oldest key under its count goes first: a flood of fresh addresses or emails
  frees no key at its count, and a flood that puts that many keys at their count frees the
  oldest of them.

## What is not built

No second factor, no inactivity timeout (`sessionMs` is absolute), no administrator beyond a
name an application grants, no email change, no breached-password list (`refusePassword` is
where one goes), no read filtering on a shared document. Password change and reset and email
verification are the `mail` source of `@aweftjs/auth`, and need the notify battery loaded.

## Reporting a vulnerability

[`SECURITY.md`](../SECURITY.md) at the root of the repository.
