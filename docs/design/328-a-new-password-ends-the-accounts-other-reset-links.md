# 328: A new password ends the account's other reset links

Amends design 290 (the mail flows) and design 294 (a taken link is kept, marked).

## Decision

**When an account's password is set, every unused reset link mailed for that account stops
working.** `change` removes all of them. `reset` removes all but the link it was opened with,
which stays, marked taken, until its end, so opening it again is still told it was used
(design 294).

The sessions end first and the links second, so a removal that fails partway leaves the new
password written and nobody signed in on the old one.

The links are found by their `user` path, which the battery already declares, and filtered to
the `reset:` prefix. A verification link is a different prefix and is not touched: it proves an
address, not a way in.

`links` grows `drop(user, except?)` for this. It is not exported.

## Why

`forgot` mails up to `forgotPerEmail` links in a window, each good for `resetMs`. Before this,
using one of them, or changing the password while signed in, left the others live. Someone who
could read an older reset mail (a shared inbox, a forwarded message, a mailbox read once) could
set the password again inside the hour, after the owner believed they had closed the account
up by changing it. A reset and a change already end the account's sessions and close their
connections (design 323); a waiting link is the same kind of way in and now ends with them.

## What this costs

One query by `user` on each change and reset, and one removal per link found, at most
`forgotPerEmail` of them.

An earlier link of the same account that was already used is removed too, so opening it again
answers `token` (not one that can be used) rather than `taken`. Only the link just used keeps
its mark.

A link mailed in the instant between the password being written and the removal survives. It
was asked for after the new password existed, so it is not a link to the old state.

A link stored under its plain token by a version before design 324 holds a `user` as well and
is removed the same way.

## Evidence

`packages/auth/tests/password.test.ts`: of two links mailed for one account, a reset through
the first leaves the second refused as `token` and the first answering `taken`; a change with
the right current password ends a waiting link, and a refused change ends none; another
account's link still opens.

The same file: a change whose link removal throws has already ended the account's other
sessions.

`packages/auth/tests/internal.links.test.ts`: `drop` removes a user's links of its prefix but
the excepted one, and leaves another user's link, a link of another prefix and a session.
