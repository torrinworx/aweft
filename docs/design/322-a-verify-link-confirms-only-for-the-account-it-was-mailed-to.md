# 322: A verify link confirms only for the account it was mailed to

Amends design 290 (the mail flows), where `POST /api/verify` took the link for anyone who
posted its token, and design 294, which named the two refusals the route answers.

## Decision

**`POST /api/verify` confirms only when the request's user is the link's user.** The route
looks at the link first and leaves it. When the link is live and the request is anonymous, or
is signed in as someone else, it answers

```
401 { "reasons": [{ "code": "sign-in", "message": "sign in to the account this link was mailed to", "email": "<the account's address>" }] }
```

and the link is not taken, so the same link confirms once the person has signed in. A token
that names nothing still answers 400 `token`, and a taken link 400 `taken`, whoever asks.

**The refusal carries the account's address.** Whoever posts a live token read it out of that
mailbox, so the address tells them nothing they do not hold, and the page needs it to fill the
sign-in form.

**`Verify.confirm(token)` is unchanged**: it takes the link with no look at who asks. It is
reached only by server code, which the application wrote and which holds the store anyway. The
route is the one way in from outside, and the route is what checks.

**On the page**, `auth.verify(token)` resolves `{ refused }` for the 401 as it does for the
400, with the reason as the route sent it. `auth/Verify` names `auth/SignIn` in `deps`, and on
`sign-in` it shows the route's sentence and that form under it. `auth/SignIn` takes an `email`
prop: given one, it opens on the password step with that address. `auth/Verify` follows
`user`, and each time it becomes a signed-in user while the link waits, the page posts the
token again, with no second click. The page does not know which account the link is for, only
its address, so the route decides: signed in as the wrong account, the page is refused the
same way and the form stays.

## Why

Signing up asks for no proof of the address and gives a session at once. So a stranger could
sign up as `ada@example.com`, and when Ada opened the mail that followed, wondering what it
was, the stranger's account became `verified` while the stranger still held its password and
its session. Everything an application gives a verified address (a claim made in its name, its
subscription, its mail) went to someone who never saw the mailbox. Design 321 closed the same
hole for a provider's confirmation; this closes it for the link.

Asking for the account's session ties the two halves together: the person who can read the
mailbox must also be the person who can sign in to the account. A stranger cannot open the
mail, and Ada cannot sign in to an account whose password a stranger chose, so the account
stays unproved, which is the truth about it.

Refusing without taking the link, rather than burning it: the ordinary case is a person who
signed up on one device and opened the mail on another. They sign in and the link they
already have works.

One code for both the anonymous case and the wrong account: the page does the same thing for
both, which is to offer the sign-in form with the address filled in.

## What this costs

A person who opens the mail in a browser where they are not signed in types their password
once more. An application with its own verify page and sign-in form has to handle `sign-in`
the way `auth/Verify` does, or its page tells that person the link did not work.

`auth/Verify` on the page now loads `auth/SignIn`, so a stage that lists the first resolves
the second, the battery's or the application's own of that name.

A person who signed up with a mistyped password they cannot repeat can no longer verify until
they reset it. Forgot and reset need only the mailbox, so the way through exists.

## Evidence

`packages/auth/tests/verify.test.ts`, `POST /api/verify confirms only for the account the link
was mailed to, and a refused try leaves the link live`: a link posted with no session and with
another account's session verifies nothing and is left live, the account's own session takes
it, and a second post answers `taken` whoever asks. `integration.test.ts` posts the link with
no cookie and with the account's cookie through the gate. `client.test.ts`, `verify hands a
page the sign-in refusal with the address`, carries the refusal through `auth.verify`, and
`client-modules.test.ts`, `auth/Verify shows the sign-in form on a link opened signed out`,
mounts the act on a refused link and sees the token posted again once `user` names someone,
and not after the page is taken down.

## What would reverse this

An application whose accounts are made only by a confirmed route (a provider, an invite sent
to the address), where no account can exist that its holder did not make. There the check
guards nothing and the extra sign-in is pure cost, and a setting on `auth/Verify` would turn
it off.
