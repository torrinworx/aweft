# 290: The mail flows: verify, change, forgot and reset, in a source that requires notify

Amends design 074. Design 275's password rules are read, not copied.

## Decision

**A second source, `mail`,** exported from `@aweftjs/auth` beside `auth` and `paths`, holding
`auth/Verify` and `auth/Password`. Both `deps` on `notify/Send`, so an application lists
`sources: [own, auth, mail, notify]`, and one that lists `mail` without `notify` hears `missing
notify/Send` at start. `auth` alone loads as it did: a dependency in `deps` that no source
lists is `missing` at load, and there is no optional dependency, so the two modules that need
a mailer cannot sit in the source every application loads.

**`auth/Verify`**, public, two routes:

- `POST /api/verify/send`, for a signed-in user (anonymous is 401 `private`): mints a token,
  writes `verify:<token>` `{ user, expires, createdAt }`, and mails the link. A user already
  verified is refused 409 `verified`. Counted per user (`sendsPerUser`, 5, inside
  `sendsWindowMs`, a day) with `resendMs` (a minute) between two sends; over either is 429 with
  `Retry-After` and the reason `attempts`.
- `POST /api/verify` with `{ token }`, for anyone: a token that names no live document, or one
  past `expires`, is 400 `token`; otherwise `emailVerified` and `modifiedAt` are written on
  `user:<id>`, the name `verified` is granted (design 289), the token document is removed, and
  the answer is 200 `{ user }`. A token is used once.

**`auth/Password`**, public, three routes:

- `POST /api/password` with `{ current, password }`, for a signed-in user: a wrong current
  password is 401 `password`; the new one goes through `auth/Enter`'s `checkPassword`, so the
  length and the application's `refusePassword` apply once and in one place; the hash is
  rewritten and every other session of the user is revoked (V7.4.3), the one making the
  request kept. Counted per user (`attemptsPerUser`, 5, inside `attemptsWindowMs`, fifteen
  minutes), because the current password is a password being guessed.
- `POST /api/password/forgot` with `{ email }`, for anyone: 200 whatever the address. A known
  address gets a token, `reset:<token>` `{ user, expires, createdAt }`, and the link by mail;
  an unknown one gets nothing and the same answer, because the mail route is the one that
  costs a send and a sign-in form already answers whether an address exists through
  `auth/Check`. Counted per email (`forgotPerEmail`, 5) and per address (`forgotPerAddress`,
  20) inside `forgotWindowMs` (a day); over either is 429 `attempts`.
- `POST /api/password/reset` with `{ token, password }`, for anyone: a token that names no
  live document or is past `expires` is 400 `token`; the password goes through
  `checkPassword`; the hash is rewritten, every session of the user is revoked, and the token
  document is removed. 200 `{ user }`.

**`auth/Session` gains `revokeAll(user, except?)`**, revoking every active session of a user
but the one named, and answering how many. The two routes above use it, and so can a module
that disables an account (V7.4.2).

**`auth/Enter` gains `checkPassword(password)`**, the reasons a password is refused (400's
`password`), for the two routes above. The sign-in route runs the same two checks in its own
order, the shape before the count and `refusePassword` after it, so a flood buys no lookup.

**The mail.** Each route sends through `notify/Send` with `channels: ['email']`: `title` is
the module's `subject` (config, with a default), `body` says what the link is for, `html` is the
escaped body and the link. The link is `config.url(token)`, and no default ships, because a
battery picks no URL (design 245): a module loaded without `url` is `invalid-config`. A send
whose `delivery.email` is not `ok`, or that throws, or that answers a shape notify never would,
answers 502 with the reason `mail` and the token still stands, so the person asks again once
the mailer is back.

**Tokens** are what a session token is: sixteen random bytes from the platform's secure source,
twenty-two characters, one use. `verifyMs` (a day) and `resetMs` (an hour) are their
lifetimes. A token document carries `user` and `expires`, both paths the battery already
declares, and each module removes its own expired documents on start and every `sweepMs` (an
hour) with the same query the session sweep runs. The rate counts are in memory and a restart
clears them, as sign-in's are.

**The client half.** `createAuth` gains `verify()` (send), `verify(token)`, `change(current,
password)`, `forgot(email)` and `reset(token, password)`, each answering `{ ok: true }` or `{
refused }` in the shape `enter` uses, and rejecting `<name>-failed` for any other status.
`reset` reconnects, because the session the page held is revoked; `change` keeps the session
that made the request and reconnects nothing. Two act modules join `authClient`: `auth/Verify`,
which with a token in the act's parameters or the query confirms it and shows the outcome, and
without one offers a signed-in person the send; and `auth/Reset`, which without a token is the
forgot form and with one is the new-password form. Neither picks a URL: the application names
them in its acts map, and its `url` configuration points the mail at those addresses.

**What is never decided here.** An email change: none ships, and what one does to `verified` is
that note's. A second factor. A mail template beyond `subject` and `url`: `html` on the send
is where an application's own goes, in a module of its own. Whether a page shows the forms:
the application puts them on an address or writes its own over the five calls.

## Why

The ASVS table carried four rows saying "no change or reset route ships; both wait on the
notify battery". The battery is built (design 268), the seam is `notify/Send`, and every
application that signs people up by email needs these three flows on its first day.

A second source rather than a `send` function in config. A function would make `auth` mail
without knowing notify, but it would also make every application write the glue notify already
is, and configure a mailer twice. Requiring notify makes the flows one line in `sources` and
keeps the mail where the inbox, the caps and the provider already are.

The password rules are read from `auth/Enter` rather than repeated. Two copies of a length
rule are one that drifts; the application that raised `passwordMin` to twelve raised it once.

`forgot` answers 200 for an unknown address although `auth/Check` enumerates. The two differ
in cost: `Check` is a lookup, `forgot` is a send, and the one that costs a send is the one that
ought not be steerable by a stranger typing addresses.

## What this costs

An application that wants password reset carries notify, and configures a mailer. The
predecessor did too.

Two more modules, two more prefixes in the store, two more sweeps. Two more forms in the
text catalogue.

`reset` signs the page out even when it was signed in as the same person, because every
session goes; the person signs in with the new password.

## Evidence

The predecessor shipped the same four routes with the same lifetimes and caps (a day, an
hour, five a day, a minute between sends) and no change-password module; its applications
wrote one each. The security suite's session cases pin what revocation has to mean at the next
handshake and the next request, and the two new revocations are proven the same way.

## What would reverse this

A mailer of the stack's own that is not notify: then `mail` would depend on it, and nothing
here changes shape. An application that needs the flows without a mailer, for a token handed
over another channel: then `url` and `send` as one seam, as a note of its own. A measured
need to keep used tokens for audit: then a `status` and the sweep as `auth/Session` keeps
sessions, rather than removal.
