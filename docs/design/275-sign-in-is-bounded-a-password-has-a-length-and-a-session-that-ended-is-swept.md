# 275: Sign-in is bounded, a password has a length, and a session that ended is swept

Amends design 074.

## Decision

**The gate hands the address on.** `auth/Gate`'s `identify` puts the peer's `address` in the
context beside `user` and `session`, so a route the gate protects can count by it.
`AuthContext` gains `address: string | undefined`.

**Sign-in attempts are counted**, in `auth/Enter`'s route. Configuration `attempts: { perEmail:
{ count: 5, windowMs: 900000 }, perAddress: { count: 20, windowMs: 900000 } }`: every `POST
/api/session` counts once for its email and once for its address before anything is hashed;
over either count the answer is 429 with `Retry-After` and the reason `attempts`; a sign-in that
succeeds clears its email's count. The counts are in memory and a restart clears them. A count
or window that is not a positive number, or a window over what a timer holds, is
`invalid-config`.

**Hashing in flight is bounded.** `hashing: { inFlight: 8 }`: when that many passwords are being
hashed, the route answers 503 with `Retry-After: 1` and starts no hash.

**A password has a length.** `password: { min: 8, max: 256 }`: shorter or longer is refused with
400 before hashing, and any character is allowed. `password.refuse`, a function of the password
answering true or a promise of it, is the application's hook for a list of passwords it will
not take; a refusal from it is 400 with the reason `password`.

**A session that ended is swept.** `revoke` writes `expires` as the moment it happened beside
`status: 'revoked'`, so `expires` is when any session stopped being valid. `auth/Session`
removes every session whose `expires` is older than `keep` days (30) on start and every
`sweepMs` (an hour); `paths` gains `expires` so the sweep is a query. A session with no lifetime
that was never revoked is never swept.

**A token is sixteen random bytes of its own.** Design 074 minted tokens from the id source,
twelve bytes. A credential needs 128 bits, and an id needs the width a document needs, so the
two part: a session token is sixteen bytes from the platform's secure source, twenty-two
base64url characters, and `whoIs` skips a cookie value of any other shape. Ids stay twelve
bytes; an id was never a credential (design 006).

## Why

Design 074 hashed with a memory-hard function on a public route and counted nothing, so one
client could hold sixteen mebibytes per request open for as many requests as it could send, and
could try passwords as fast as the hash allowed. The per-email count is what makes the
enumeration the battery accepts survivable: `auth/Check` answers whether an email exists, and a
sign-up answers 201 against a sign-in's 200, so knowing an email exists buys five tries in
fifteen minutes and no more. The in-flight bound is the memory bound; the attempt counts are the
rate bound; the outer count on every route is design 272's.

The length rule is NIST SP 800-63B's and ASVS's: at least eight, at least sixty-four permitted,
no composition rules. A ceiling, because a password is hashed and a hash of a megabyte is a way
to spend a core. The breached-password list is the application's because the list is a
dependency or a network call, and the stack ships neither; the hook is where it goes.

Sessions were never removed, so a store held every session ever issued. `expires` was already
the moment a session stops being valid; writing it on revocation makes one declared path answer
the sweep's question.

## What this costs

Counts per address share a proxy's address unless the listener reads the proxy's entry (design
273). The counts are bounded in memory (design 272): a flood that puts tens of thousands of
emails or addresses at their count inside one window frees the oldest of them, so the lock on
one email holds against a flood of fresh emails and not against one that locks that many. A
password over 256 characters is refused, and a manager that generates longer ones meets that at
sign-up. A session document is gone thirty days after it ended, so a record of who was signed in
when is not this battery's to keep past that.

## Evidence

`packages/auth/tests/enter.test.ts`: the sixth attempt on one email in a window is 429 with
`Retry-After`, the twenty-first from one address is, a success clears the email's count, the
ninth concurrent hash is 503, seven characters and 257 are 400 and eight of anything is not,
`refuse` is asked and its answer honoured. `packages/auth/tests/session.test.ts`: a revoked
session carries `expires`, the sweep removes one older than `keep` and leaves one newer and one
with no end. `securityChecks()` (design 271) proves the counts and the length from outside.

## What would reverse this

Attempt counts kept in the store rather than in memory, for a fleet; or a list shipping with the
battery.
