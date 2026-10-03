# 300: A new account can be mailed its verification link at sign-up

Amends design 290 (the mail flows). Asked for by an application whose sign-up form is the
battery's own `auth/SignIn`, which never tells the page whether the account is new, so the page
had no moment to call `verify()` and the person was told to open a mail nobody sent.

## Decision

**`auth/Verify` takes `atSignUp`**, a boolean, `false` by default. When it is `true`, every
account `auth/Enter` makes is mailed its link, through the sign-in route or through `enter()`
called from a module. The send is the one `POST /api/verify/send` makes and is counted the same
way, so a page that asks again inside `resendMs` is 429, not a second mail.

**`auth/Enter` gains `afterSignUp(listener)`**, which hands each new account's id to the
listener once the user document is settled and `auth/Roles` has made its first grant. It answers
a function that removes the listener. `enter()` waits for every listener before it answers, so a
page that hears 201 can say "check your inbox" and be right. Every listener runs whatever another
does; when one rejects, `enter()` rejects with the first rejection once all have settled, and the
route answers 500, with the account already made. The route waits for the listeners after it has
given back its `hashesInFlight` slot, so a slow mailer never turns someone else's sign-in away as
busy.

**`auth/Verify` names `auth/Enter` in `deps`** to listen. Both are in sources every application
with mail already lists.

A mail that does not go does not fail the sign-up: the send answers its `mail` refusal, the
listener drops it, and the link stands for the person to ask again from the page once `resendMs`
has passed, as after a failed send from the route.

## Why

The README said a module of yours calls `Verify.send(user)` after `enter`. That works for a
module that calls `enter` itself. The route is the battery's, and its answer reaches only the
page that posted, which for `auth/SignIn` is the battery's own form. Mailing the link where the
account is made reaches every way in at once.

A listener on `auth/Enter` rather than a setting on `auth/Enter`: the setting would need a
function that can reach `auth/Verify`, and configuration cannot reach another module's instance.

Waiting rather than firing and forgetting: a send that is not awaited has nowhere to report a
throw, and a page that says the mail went must be able to believe it.

## What it costs

A sign-up with `atSignUp` takes one mailer round trip longer to answer. `Verify` loads with
`Enter`, so a test that builds `Verify` alone passes an `Enter` too. `afterSignUp` is a second
way for code to run at sign-up beside `refuseSignUp`; the two differ in that `refuseSignUp` is
asked before the account exists and can stop it, and a listener hears of it after and cannot.

## What would reverse it

A mailer slow enough that the wait at sign-up costs more than a missed mail. Then the listener
would be fired without waiting and its failures sent to the server's `failed` handler.
