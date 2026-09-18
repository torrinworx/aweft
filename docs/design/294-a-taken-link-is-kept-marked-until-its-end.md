# 294: A taken link is kept, marked, until its end

Amends design 290 (a token document is removed when taken). This is the shape that note named
as its own reversal: a status kept and swept, rather than removal.

## Decision

Taking a verification or reset link marks its document `taken` and leaves it; the sweep that
removes an expired link removes a taken one the same way, once `expires` has passed. A token
therefore names one of three things for the rest of the link's lifetime: a live link, a taken
one, or nothing.

`Verify.confirm` and `Password.reset` answer the reason `taken` for the second, with the
message `this link has already been used`, and keep `token` for the third: a token that was
never issued, one past its end, or text that is not a token at all. `POST /api/verify` and
`POST /api/password/reset` answer `400 { reasons: [{ code: 'taken', ... }] }`, and the client
half's `verify(token)` and `reset(token, password)` hand that reason through as they hand
every reason through. `Password.reset` looks at the link before the password, as it did, so a
taken link is refused before the password is checked and a stranger's guess still costs no
`refusePassword` lookup.

The `taken` mark is a field of the document, not a declared path: nothing queries it. The
sweep already ran on `expires`, so it removes a tombstone with no change.

## Why

A page opening a link answered `token` whether the link never existed or was used a minute
ago, because the document was gone either way. For a verification link the second case is a
success from the person's side: their address is verified, and the page should say so rather
than say the link is bad. The document was already marked `taken` for the width of a race
between two takes; keeping the mark for the link's lifetime is the smallest change that lets a
second opening be told apart, and the sweep needs no new rule.

The alternative was to answer `verified` when the user the link named already carries
`emailVerified`. That needs the link to still name the user, which is the same tombstone, and
it says nothing for a reset link, where a second use is a used link and not a verified one.
`taken` is one reason for both routes, and the page decides what a taken verification link
means to the person.

## Evidence

`packages/auth/tests/internal.links.test.ts` takes a link twice, peeks the tombstone, waits out
the lifetime and sweeps it; `verify.test.ts`, `password.test.ts` and `client.test.ts` answer
`taken` through the calls, the routes and the client half. The operator sweep over `links.ts`
leaves three flips the suite cannot see, each equivalent: `expires <= now` against `< now` is
a one-millisecond boundary no test can land on; and the two in the sweep's guard,
`|| fields.expires >= now` to `&&` and `>=` to `>`, restate what the `find` with `expires lt
now` already excluded, so the guard is a second reading of the query and never the first.

## What this costs

A taken link's document stays in the store until the sweep: a day for a verification link,
an hour for a reset, the same as an unused one. A test that asserted the document gone after a
take asserts it marked instead.

## What would reverse this

A store that has to hold nothing after a take, for a policy on used credentials: then removal
comes back and the route answers `token` for both, which is where design 290 started.
