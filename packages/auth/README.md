# @aweftjs/auth

The first battery: server modules for who is on a connection. A gate that reads `public`,
sessions as documents in your store, sign-in and sign-up by email and password, and a
per-user state document shared on every connection of theirs. `@aweftjs/auth/client` is the
browser half: who the page is, signing in and out, and that state document.

## Quickstart

```ts
import { auth, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths, title: ['title'] } });

const server = createServer({
	sources: [fromDirectory('./modules'), auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

`auth` is a source, so `start` loads all five of these modules with everything else your
sources list, and each reads the `store` the server handed in. `gate: 'auth/Gate'` names the
gate; to keep this policy and add a rule of your own, write a module that `deps` on
`auth/Gate` and name that instead. `paths` is the two store declarations they query: `email`
on user documents, `user` on session documents. Your own source goes first, so a module of the
same name in your directory replaces one of these.

## The modules

| module | public | what it does |
|---|---|---|
| `auth/Gate` | | `identify` reads the session cookie; `access` allows a module that declares `public: true` to anyone and any other module only to a signed-in user |
| `auth/Session` | yes | `issue(user)`, `revoke(token)`, `whoIs(request)`, `setCookie(token, request)`, a `call` answering `{ user }` for the asking connection, and `DELETE /api/session` |
| `auth/Enter` | yes | `enter(email, password)` signs in, or signs up when nobody has the email; `POST /api/session` does that and sets the cookie |
| `auth/Check` | yes | `exists(email)`, and a `call` answering `{ exists }` for `{ email }` |
| `auth/State` | | shares `state:<user>` from the store on the connection, under the topic `state` |

**A module of yours declares `public: true` or nothing.** Absent means private: only a
connection with a user reaches it. That is this gate's word; `@aweftjs/server` does not know
it.

## Signing in and out

```
POST /api/session      { "email": "ada@example.com", "password": "..." }
  201 { "user": "<id>", "created": true }     the email was new: signed up
  200 { "user": "<id>", "created": false }    signed in
  401 { "reasons": [{ "code": "password", ... }] }
  400 { "reasons": [{ "code": "email" | "password", ... }] }
  Set-Cookie: session=<token>; Path=/; HttpOnly; SameSite=Lax[; Secure][; Max-Age=...]

DELETE /api/session
  200 { "user": null }, and the cookie is cleared
```

Identity is fixed for a connection's life, read from the cookie at the handshake. After
either route the client reconnects; a cookie cannot be set on an open socket.

**What the cookie means.** This gate refuses nobody at the door. Every cookie of the name is
read in the order the browser sent them (it sends every one whose scope matches, so one from
another path or another application on the host arrives beside ours): an empty value, a
value that is not a token, and a token that names no live session (a store reset, a
sign-out, a timeout) are skipped, the first live one wins, and none is anonymous. An
anonymous client can always reach `DELETE /api/session` to clear what it holds. A refusal at
the handshake is for a gate that keys on something a client cannot repair by signing in; the
server's README shows one.

**No lifetime ships.** A session lasts until revoked. To set one, configure `auth/Session`
the way any module is configured, with a same-named file in your own source:

```ts
// modules/auth/Session.ts
export const config = { sessionMs: 30 * 24 * 3600 * 1000, cookie: 'session' };
```

`sessionMs` that is not a positive number is refused when the module is made. `Secure` is on
the cookie whenever the request came over TLS as the listener sees it; behind a proxy that
terminates TLS, start the Node listener with `forwarded: true` so the scheme comes from
`x-forwarded-proto`.

## The client half

```ts
import { createClient } from '@aweftjs/client';
import { createAuth } from '@aweftjs/auth/client';

const client = createClient();                        // the page's own origin
const auth = createAuth(client);                      // the page's own origin, and global fetch

auth.user.effect((who) => header.textContent = who ?? 'signed out');

const outcome = await auth.enter('ada@example.com', 'correct horse battery staple');
if ('refused' in outcome) show(outcome.refused);

const state = await auth.state<State>().ready;
state.theme = 'dark';                                 // applies here, and goes
```

`createAuth(client, { origin?, fetch? })` adds identity to a connection. It never opens or
closes the connection for good; `@aweftjs/client` owns the socket. After sign-in and sign-out it
asks the client to reconnect, because identity is fixed per socket.

**`user` has three states.** `undefined` until the server has answered, `null` for an anonymous
connection, and the user's id otherwise. It is a read-only cell, so a page renders all three and
follows the value through sign-in and sign-out. It is asked again on every socket that opens,
because identity is read from the cookie at the handshake and is fixed for the connection's
life. A drop leaves the last value alone; the socket after it refreshes.

**`enter` and `leave` reconnect.** A browser cannot set a cookie on an open socket, so after
either route the client drops that socket and opens a new one, and the call resolves once `user`
is known again. `enter` answers `{ user, created }` on 200 or 201 and `{ refused }` on 400 or
401, in the same shape `auth/Enter` uses on the server. `leave` resolves once the page is
anonymous again.

**`state()` is the signed-in user's own document.** Its `ready` rejects with `anonymous` when
there is no user, at once rather than waiting for a topic the server will never offer, and waits
for the answer when nobody has said yet. One connection carries one state document: the server
offers the topic once per socket, so asking twice hands back the same handle until `stop()`,
after which it refuses `stopped`, and only the socket `enter` or `leave` opens brings a new one.
`check(email)` asks `auth/Check`. `stop()` stops following the connection and leaves the client
running; every call after it refuses `stopped`.

**When `user` changes underneath the page, the handle it holds is stopped.** The server forgets
the session, or another user's cookie replaces it, and the client comes back on its own as
somebody else. The handle the page is still holding was made for the old user, so it is stopped
and follows the server no further; the next `state()` answers for whoever the connection is now,
and a page follows `user` to notice. `enter` and `leave` refuse with `closed` when their route
answered but the client has since been closed.

**Two seams outside a browser**, and a page needs neither. `origin` is where the session routes
are, the page's own by default and required where there is no `location`. `fetch` makes the two
HTTP calls, the global by default; a Node program hands in one that carries the cookie, because
Node's `fetch` keeps no cookie jar. The client's own `open` seam is the third, and it is
`@aweftjs/client`'s: a Node program hands in a socket carrying the same cookie header.
`recipes/client` runs all three.

## What is stored

Three kinds of document in your store, named by prefix:

- `user:<id>`: `email`, `name`, `password` (the scrypt hash, with its parameters and salt
  written into it; never the password), `emailVerified`, `createdAt`, `modifiedAt`. Never
  shared on a link.
- `session:<token>`: `user`, `expires` (or null), `status` (`active` or `revoked`),
  `createdAt`.
- `state:<user>`: whatever you keep per user. `auth/State` shares it under `state`, accepting
  every commit, because it is theirs.

The state document is an `@aweftjs/core` observable, as every document in the store is: put
a list in it with `createArray` from `@aweftjs/core`, an object with `createObject`, and group
writes with `atomic`; that package's README shows the shapes. **Keep its root an object.**
`paths` declares `email` and `user` for every document in the store, and the store refuses a
declared path that meets an array, so a document whose root is an array cannot be written to a
store that declares them; a list goes in a field.

Ids and tokens are the stack's ids: twelve random bytes from the platform's secure source,
sixteen characters. Passwords are hashed with Node's own `scrypt` and compared with Node's
own `timingSafeEqual`; there is no dependency, and no test here measures timing.

Two sign-ups for one email in the same instant can both succeed, because a unique index is
the store driver's and none ships. A sign-in with a mistyped new email creates an account:
that is what one module for both means, and `auth/Check` exists so a form can ask first.

## What waits

Email verification and password reset wait for the email battery. The client half ships no sign-in
or sign-up view, so a page writes its own form and calls `enter`.

The design notes are in `docs/design/` 071 and 074, and 185 for the client half.
