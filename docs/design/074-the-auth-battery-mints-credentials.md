# 074: The auth battery mints credentials, keeps them as documents, and fixes identity per connection

## Decision

`@aweftjs/auth` is server modules and nothing else: `auth/Gate`, `auth/Session`,
`auth/Enter`, `auth/Check` and `auth/State`, handed to a loader as one `Source` (`auth`) so
an application's own directory wins over them by name, and read through `imports` by any
module that needs one. They read `store` from the loader's props.

**Stored shape.** Three kinds of document, in the application's store, named by prefix:

- `user:<id>`: `email`, `name`, `password` (the hash, never the password), `emailVerified`,
  `createdAt`, `modifiedAt`. Never shared on a link.
- `session:<token>`: `user`, `expires` (a time, or null for never), `status` (`active` or
  `revoked`), `createdAt`.
- `state:<userId>`: whatever the application keeps per user. This is what `auth/State` shares
  on a connection, under the topic `state`.

Ids and tokens come from the stack's id source, `createId` in `codec`, the same twelve
random bytes core mints an observable with, written as sixteen characters. The battery
states the two paths the application declares on its store: `email` on users and `user` on
sessions, exported as `paths`.

**Passwords** are hashed with Node's own `scrypt`, no dependency, and the stored text carries
the parameters and the salt beside the hash so a later change of parameters re-hashes on the
next sign-in rather than by migration. Comparison is constant-time.

**Identity is fixed for a connection's life**, read from the session cookie at the
handshake. Sign-in and sign-out are HTTP routes, because a cookie cannot be set on an open
socket: `POST /api/session` with `{ email, password }` signs in, or signs up when the email
is new, and sets `session=<token>; Path=/; HttpOnly; SameSite=Lax` (`Secure` when the request
came over TLS, `Max-Age` when a lifetime is configured); `DELETE /api/session` revokes the
session and clears the cookie. After either, the client reconnects. The POST route is on
`auth/Enter` and the DELETE route on `auth/Session`, because `Enter` needs `Session` to issue
and a route the other way round would be a cycle.

**The gate** (`auth/Gate`): `identify` reads the cookie and answers `{ user, session }` or `{
user: null, session: null }`; `access` allows a module that declares `public: true` to
anyone and any other module only to a connection with a user. `Session`, `Enter` and `Check`
are public; `State` is not.

**What the cookie means.** No cookie is anonymous. A cookie whose value is not a token at
all is refused at the handshake: nothing this battery writes could have produced it. A token
that names no session, or names one that is revoked or expired, is anonymous: that is what a
client holds after a store reset, a sign-out or a timeout, and refusing it would leave the
client unable to reach the route that clears it.

**No lifetime ships.** `sessionMs` on `auth/Session`'s config sets one; without it a session
lasts until revoked.

Email verification and password reset wait for the email battery; client views, reconnect
and cookie helpers wait for the client runtime.

## Why

Documents rather than a table of our own, because a session and a
user are state, and state in this stack is a document: it persists through the store the
application already has, its history is its commit tail, and `auth/State` can share a
document over a link with nothing added. The id source rather than a second random source,
because there is one and it is already the right width for a credential nobody can guess.

Fixed identity per connection, because the cookie is read once at the handshake and a
connection whose identity changed under a module's hook would have to re-run every gate
decision already taken. Reconnecting is one line at the client and the client runtime will
own it.

The architecture table's line for design 005 reads "the auth battery mints credentials"
rather than "`server` mints credentials": `server` mints nothing and knows no user.

## What it costs

A session token in the cookie is the name of that session in the store, so anyone who can read the
store can read the tokens; the store is the application's boundary. Two sign-ups for one
email in the same instant can both succeed, because a unique index is the driver's and none
ships. A sign-in with a mistyped new email creates an account, which is what one module for
both means.

## What would reverse this

A need for separate sign-in and sign-up, for a lifetime that ships, or for identity
that can change on a live connection. Each is a new design note.

## Amended

**The cookie policy above is reversed in one respect: this gate never refuses at the door.**
An earlier shape said a cookie whose value is not a token could only come from tampering. It
cannot: a browser sends every cookie of the name whose scope matches, so a `session` cookie
from another path or another application on the host arrives beside ours, and `session=`
with an empty value is what the battery's own clearing header leaves. Refusing either locked
a client out of `DELETE /api/session`, the route that exists to clear the cookie. Measured:
`session=; session=<good token>` was refused with 401.

So `whoIs` reads every cookie of the name in the order sent, skips empty values, skips a
value that is not a token, skips a token that names no live session, and answers the first
live one; none is anonymous. Nothing is ever refused, and the malformed case is anonymous
like the stale one. What a refusal at `identify` is for is a gate that keys on something a
client cannot repair by signing in, such as the address allowlist in the proof.

Two more: `sessionMs` that is not a positive finite number is refused when
the module is made rather than ignored, because a session that quietly never expires is the
failure a typed lifetime was meant to prevent; and the password comparison is stated as
Node's `timingSafeEqual`, not as "constant time", because no check here measures timing and
the repo's rule is that a claim without a check is a defect.
