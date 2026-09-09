# 185: The auth client half hands identity as a cell

## Decision

`@aweftjs/auth/client` exports `createAuth(client, { fetch?, origin? })`, which returns `user`,
`enter`, `leave`, `state`, `check` and `stop` over a `@aweftjs/client` connection. `stop()` stops
following the connection and stops the state handle; the client is left open, because it is the
application's.

```ts
import { createClient } from '@aweftjs/client';
import { createAuth } from '@aweftjs/auth/client';

const client = createClient({});
const auth = createAuth(client);
const outcome = await auth.enter('ada@example.com', 'correct horse battery staple');
const state = await auth.state<State>().ready;
```

`user` is a read-only cell: `undefined` until the server has answered, `null` for an anonymous
connection, the user's id otherwise. It is refreshed on every socket that opens, by asking
`auth/Session`, which gains `call` answering `{ user }` from the connection's context. The module
is already public, so an anonymous connection hears `{ user: null }`.

`enter(email, password)` posts to `/api/session` with same-origin credentials. On 200 or 201 it
reconnects the client and resolves once `user` is known again, with `{ user, created }`; on 400
or 401 it resolves with `{ refused }` in the module's own `Entered` shape. `leave()` deletes the
session, reconnects, and resolves once `user` is null. `origin` defaults to the page's; `fetch`
defaults to the global, and a Node program hands in one that carries the cookie.

`state()` is the `state` share for the signed-in user. Its `ready` rejects at once with
`anonymous` when `user` is null and waits for the answer when it is not yet known. Calling it
again on the same connection hands back the same handle, stopped or not: a link carries one topic
per name and the server offers `state` once per connection, so a second share would wait forever
(measured; the general rule for `sync` is still open). `leave()` and `enter()` let go of it,
and the socket they open is what produces a new one, because another user's state is another
document.

`check(email)` asks `auth/Check`.

An identity that changes underneath the page stops the handle the page holds: the handle was made
for the old user, so when a refresh answers a different value it is stopped and followed no
further, and the next `state()` answers for whoever the connection is now.

Every method on a stopped auth refuses at once with `stopped`, before any HTTP call is made, and
`enter` and `leave` refuse with `closed` when their route answered but the client is closed, since
no socket will ever carry the new identity.

## Why

Identity is fixed for a connection's life (design 074), so the only moment a page can learn who
it is comes after a socket opens, and asking on that socket costs nothing a page was not already
paying. An HTTP route would be a second round trip before the first frame, and a second place
identity is answered. A page reaches for a route when nothing over the socket answers; the call
answers it.

`state()` rejecting for an anonymous connection is what stops a wait that never ends:
`link.share('state')` on an anonymous connection waits forever, because the server never offers the topic, and the auth half
knows before it shares whether there is a user to share for.

A cell rather than a promise, because a page renders `user` in three states and follows it
through sign-in and sign-out, which is what a cell is for and a promise is not.

## What this costs

One more `call` on `auth/Session`. A page that never signs in still asks once per socket.

## What would reverse this

A gate that can change a connection's identity without a new socket. Design 074 stands against
that, and this note would go with it.
