# 324: A token is stored as its hash

Amends design 074 (a session is the document `session:<token>`) and design 290 (a link is the
document `<prefix>:<token>`).

## Decision

**A session or link document is named by the SHA-256 of its token**, in base64url:
`session:<hash>`, `verify:<hash>`, `reset:<hash>`. The cookie, the mailed link and
`context.session` carry the token itself, as before. The hash is unsalted and unkeyed: a token
is sixteen random bytes, so there is nothing to guess and a plain digest is enough.

**A document the version before this one wrote is still read.** A token is 22 characters and a
hash is 43, so a stored name says which it is.

- `whoIs` reads the hashed name first and, when there is none, the plain one. A plain session
  found live is copied to its hashed name with the same fields and the plain document removed.
- The timed sweep copies every plain session left to its hashed name the same way, whatever
  its status, so one `sweepMs` after a process starts no stored name is a working token. The
  sweep run when the module is made does not: the version before may still be serving then,
  and it finds a session only by its plain name.
- `revoke` ends the plain document and the hashed one, in that order. `revokeAll` ends the
  sessions it finds under either name, and its `except` is compared by hash.
- A link's `peek` and `take` read the hashed name first and the plain one second. A plain link
  is left where it is: it ends within its lifetime and the sweep removes it.

A copy never revives a session. It copies the fields as they stand, it is skipped when the
hashed document already exists, and it looks at the plain document again once the copy is
written, so a revoke that landed in between is copied too.

**The plain names are read for the move only.** Nothing writes one.

## Why

The store held working credentials. Anyone who could read it (a backup, a database copy on a
laptop, a read-only account) could take a row's name, put it in a cookie and be that person,
or open a reset link that had not been used. With the hash stored, a copy of the store says
who has sessions and gives no way to use one.

Reading the old names rather than ending them: moving to this version would otherwise sign
everyone out and kill every link in someone's inbox, which is a cost to every person using an
application for a change none of them asked for.

Not moving at the first sweep: during a deploy two versions run for about a minute, and the
older one would lose every session moved out from under it.

## What this costs

One hash per request that carries a cookie. While plain documents exist, a cookie that names
no hashed session costs a second read, and so does every `revoke`. The timed sweep asks the
store for every document with a `user` to find the plain sessions among them, on every run,
for as long as the fallback stands.

`whoIs` moves a plain session the first time this version sees it, so the version before no
longer finds that session, and it never finds one this version issued. With traffic moved from
one version to the other in one step that is not seen; with traffic split between the two, or
after a step back to the older version, the people affected sign in again.

A move is two documents and no transaction. Within one process a revoke that lands during a
move is carried over. Across two processes a revoke made by the version before, in the instant
this one moves the same session, can be lost.

A test or a tool that opened `session:<token>` by hand opens `session:<hash>` instead.

## Evidence

`packages/auth/tests/session.test.ts`: no stored document name holds a token that was handed
out, for a session, a verification link or a reset link; a session written under its plain
name is honoured by `whoIs` and afterwards exists only under its hash; the sweep run as the
module is made leaves a plain session and the timed one moves it; `revoke` and `revokeAll` end
a plain session and keep the one `except` names; a revoked or expired plain session is
anonymous before and after a move, and a hashed document already there is not written over.
`a revoke that lands on the plain document while it is being moved is carried to the hashed
one` holds the move at its first write and runs a revoke to its end there, over a store that
answers head 0 for the hashed name meanwhile, as a driver whose write has not landed does.
`verify.test.ts` and `password.test.ts` take a link stored under its token through the route
and through `reset`. The tests take the expected name from `node:crypto` directly, never from
the battery.

## What would reverse this

Nothing reverses the hashing short of a store that hashes names itself.

The fallback goes once no store holds a plain name: every application on the stack has run
this version for longer than its longest `sweepMs` (sessions) and its longest link lifetime
(links). Then the second read, the move and the sweep's query are removed, and a plain name
is a document nothing reads.
