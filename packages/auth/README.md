# @aweftjs/auth

The first battery: server modules for who is on a connection. A gate that reads `public`,
sessions as documents in your store, sign-in and sign-up by email and password, and a
per-user state document shared on every connection of theirs. No client half yet.

## Quickstart

```ts
import { auth, paths } from '@aweftjs/auth';
import { createLoader } from '@aweftjs/modules';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';
import type { Gate } from '@aweftjs/server';

const store = createStore({ driver: memoryDriver(), declare: { ...paths, title: ['title'] } });
const loader = createLoader({ sources: [fromDirectory('./modules'), auth], props: { store } });
await loader.load(['auth/Gate', 'auth/Enter', 'auth/Check', 'auth/State']);

const server = createServer({ loader, gate: loader.get('auth/Gate') as Gate, listener: node({ port: 8080 }) });
await server.start();
```

`auth` is a source for the loader, and the modules read `store` from the loader's props.
`paths` is the two store declarations they query: `email` on user documents, `user` on
session documents. Your own source goes first, so a module of the same name in your directory
replaces one of these.

## The modules

| module | public | what it does |
|---|---|---|
| `auth/Gate` | | `identify` reads the session cookie; `access` allows a module that declares `public: true` to anyone and any other module only to a signed-in user |
| `auth/Session` | yes | `issue(user)`, `revoke(token)`, `whoIs(request)`, `setCookie(token, request)`, and `DELETE /api/session` |
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
a list in it with `createArray`, an object with `createObject`, and group writes with
`atomic`. **Keep its root an object.** `paths` declares `email` and `user` for every document
in the store, and the store refuses a declared path that meets an array, so a document whose
root is an array cannot be written to a store that declares them; a list goes in a field.

Ids and tokens are the stack's ids: twelve random bytes from the platform's secure source,
sixteen characters. Passwords are hashed with Node's own `scrypt` and compared with Node's
own `timingSafeEqual`; there is no dependency, and no test here measures timing.

Two sign-ups for one email in the same instant can both succeed, because a unique index is
the store driver's and none ships. A sign-in with a mistyped new email creates an account:
that is what one module for both means, and `auth/Check` exists so a form can ask first.

## What waits

Email verification and password reset wait for the email battery. Client views, the
reconnect after sign-in, and cookie helpers wait for the client runtime. Nothing here runs in
a browser.

The decisions are in `docs/design/` 071 and 074.
