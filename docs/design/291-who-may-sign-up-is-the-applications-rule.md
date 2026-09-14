# 291: Who may sign up is the application's rule, asked at the door

Amends design 074 and design 275. Asked for by roadmap step 47 (maccobylab.com onto aweft): the
application signs people up by invitation, and the battery had no place for that rule.

## Decision

**`auth/Enter` gains `refuseSignUp`**, configuration beside `refusePassword`: `null`, or a
function of the sign-up answering a refusal to close the door and nothing to open it, sync or
async. The route asks it once per sign-up, after the shape checks, the counts and
`refusePassword`, and before anything is hashed, with:

- `email`, the address as it will be stored, normalised;
- `extra`, every field of the request body but `email` and `password`, which is where an invite
  token or a role picked on the form arrives;
- `context`, what the gate identified for the request: `user` is null, `address` is the peer's;
- `store`, the store the battery writes the user into, so a rule that reads a document of the
  application's (an invite) needs no second way to reach it.

A refusal is the route's 403 with that one reason and nothing is made. A sign-in never asks the
rule, because the email is known and there is no door to close. `enter()` called from a module
of the application's never asks it either: the rule is the door's, not the function's, the same
way the attempt counts are the route's and not `enter`'s. A rule that throws is the route's 500,
reported under `auth/Enter`. The battery ships no rule.

**`@aweftjs/auth/client`'s `enter` takes a third argument**, `extra`, sent beside the address and
the password, and a 403 resolves with `{ refused }` as a 400 and a 401 do, so a page shows the
reason the rule gave. A sign-in carries the same fields and the server ignores them.

## Why

The predecessor gave an application one hook on sign-up, handed the extra fields of the
request and the database, and maccobylab.com's whole sign-up policy (an invite that must match
the address being registered, single use, with an expiry) lived in it. The battery had
`refusePassword` for one rule and no place for the other. The alternatives were the
application replacing `auth/Enter` whole, which copies the counts, the hashing bound and the
cookie to keep one rule, or opening sign-up, which changes the product. A rule asked at the
door costs the battery one optional function and one status.

The rule runs after `refusePassword` on purpose: a sign-up refused for its password must not
spend an invite, since a rule that marks its invite used is the one this was built for.

## What it costs

One extra `findUser` on a sign-up when a rule is configured, to tell a sign-up from a sign-in
before `enter()` looks the user up again. Nothing when it is null.

## What would reverse it

An application whose rule needs to run inside `enter()` (a module of its own signing people up
under the same policy): then the rule moves into `enter` behind an option, and this note is
amended.
