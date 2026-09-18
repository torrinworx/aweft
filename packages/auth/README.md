# @aweftjs/auth

The first battery: server modules for who is on a connection and what they may do. A gate that
reads `public` and `needs`, sessions as documents in your store, sign-in and sign-up by email
and password, the names a person holds, and a per-user state document shared on every
connection of theirs. A second source, `mail`, adds email verification, password change,
forgot and reset, and needs the notify battery. `@aweftjs/auth/client` is the browser half: who
the page is, what they hold, signing in and out, that state document, the mail calls, and four
page modules a stage loads by name.

## Quickstart

```ts
import { auth, mail, paths } from '@aweftjs/auth';
import { fromDirectory } from '@aweftjs/modules/node';
import { notify } from '@aweftjs/notify';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths, title: ['title'] } });

const server = createServer({
	sources: [fromDirectory('./modules'), auth, mail, notify],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

`auth` is a source, so `start` loads all six of these modules with everything else your
sources list, and each reads the `store` the server handed in. `gate: 'auth/Gate'` names the
gate; to keep this policy and add a rule of your own, write a module that `deps` on
`auth/Gate` and name that instead. `paths` is the three store declarations they query: `email`
on user documents, `user` and `expires` on session and link documents. Your own source goes
first, so a module of the same name in your directory replaces one of these. `mail` is the
two modules that send email, and `notify` is what they send through: leave both out and
`auth` alone loads as before; list `mail` without `notify` and `start` refuses with `missing`,
naming `notify/Send`.

## The modules

| module | public | what it does |
|---|---|---|
| `auth/Gate` | | `identify` reads the session cookie; `access` allows a module that declares `public: true` to anyone, one that declares `needs` to a signed-in user holding the name, and any other module only to a signed-in user |
| `auth/Session` | yes | `issue(user)`, `revoke(token)`, `revokeAll(user, except?)`, `whoIs(request)`, `setCookie(token, request)`, a `call` answering `{ user }` for the asking connection, and `DELETE /api/session` |
| `auth/Roles` | | `may(user, name)`, `grant(user, ...names)`, `revoke(user, ...names)`, `names(user)`; shares `roles:<user>` read-only under the topic `roles`, and a `call` answering the `implies` table |
| `auth/Enter` | yes | `enter(email, password)` signs in, or signs up when nobody has the email; `checkPassword(password)` answers the reasons the rules refuse one; `POST /api/session` does the first and sets the cookie |
| `auth/Check` | yes | `exists(email)`, and a `call` answering `{ exists }` for `{ email }` |
| `auth/State` | | shares `state:<user>` from the store on the connection, under the topic `state` |

And in `mail`, both naming `notify/Send` in their `deps`:

| module | public | what it does |
|---|---|---|
| `auth/Verify` | yes | `send(user)` mails a one-time link; `confirm(token)` takes it, writes `emailVerified` and grants the name `verified`; `POST /api/verify/send` and `POST /api/verify` |
| `auth/Password` | yes | `change(user, current, password, keep?)`, `forgot(email)`, `reset(token, password)`; `POST /api/password`, `POST /api/password/forgot`, `POST /api/password/reset` |

**A module of yours declares `public: true`, `needs`, or nothing.** Absent means private: only
a connection with a user reaches it. `needs: 'reports'` (or a list, meaning every name in it)
means a signed-in user who holds that name; anonymous is refused `private` whatever else the
module declares, and a person lacking the name is refused `needs`. Those are this gate's words;
`@aweftjs/server` does not know them.

## Names

A person holds **names**. A role and a feature are the same kind of thing: `admin`,
`verified`, `posts.delete`, `products.abc123`. A name is non-empty text with no whitespace.
Names are dotted, and holding one covers everything under it: `products` covers
`products.abc123.read`, `products.abc123` covers one product, and `*` covers everything.

```ts
// modules/reports/Monthly.ts: only a person holding `reports` reaches it
export default () => ({ needs: 'reports', call: () => monthly() });

// modules/products/Read.ts: a rule finer than a module, asked of auth/Roles
import { codecError } from '@aweftjs/codec';

export const deps = ['auth/Roles'];
export default ({ imports }) => ({
	call: async ({ id }, context) => {
		if (!(await imports.Roles.may(context.user, `products.${id}.read`))) throw codecError('needs', `product ${id} is not yours to read`, 'Ask for access.');
		return product(id);
	},
});

// modules/admin/Grant.ts: who grants is yours; this one lets an administrator hand out names
export const deps = ['auth/Roles'];
export default ({ imports }) => ({
	needs: 'admin',
	call: ({ user, name }) => imports.Roles.grant(user, name),
});
```

**A table says which names imply others**, and it is configuration on `auth/Roles`, the same
same-named-file way every battery module is configured. `first` is the names the first person
to sign up is granted, so a fresh application has an administrator without a script:

```ts
// modules/auth/Roles.ts
export const config = {
	implies: { admin: ['*'], moderator: ['posts.delete', 'posts.hide'], member: ['products.read'] },
	first: ['admin'],
};
```

`may(user, name)` is true when the person was granted the name, was granted one that covers
it, or was granted one the table implies it from, transitively. The table is keyed by the
exact name held: `admin.super` implies what `admin.super` lists, not what `admin` does, so a
hierarchy of roles is written into the table. `holds(granted, implies, name)` is the same
check as a plain function, exported from the root for code that already holds a list.

**Every check reads the store.** There is no cache and no per-connection snapshot: a grant or a
revoke is seen by the next call, request or connection the person makes, and by the page they
have open, through the share. A module with no `needs` costs nothing new; a gated one costs one
document read per check.

**Who grants is yours.** No route ships. `grant` and `revoke` are for a module of your own,
inside the process, which is the one place the security suite's administrator case says a
grant can come from. `first` goes to the first person to sign up after the module is loaded on
a store with nobody in it, and a marker document (`auth:first`) says it has happened; loaded on
a store where people already exist, the module writes the marker for nobody as it is made, so
an application that configures `first` once its people exist hands nothing to the next
stranger. Two sign-ups in the same instant in one process settle to one first; two processes
over one store can each see a first, the same way two sign-ups for one email can both succeed.

**`verified` is a name like any other.** `auth/Verify` grants it once the person has opened the
link, so a module that wants a verified person says `needs: 'verified'`.

## Signing in and out

```
POST /api/session      { "email": "ada@example.com", "password": "..." }
  201 { "user": "<id>", "created": true }     the email was new: signed up
  200 { "user": "<id>", "created": false }    signed in
  401 { "reasons": [{ "code": "password", ... }] }
  400 { "reasons": [{ "code": "email" | "password", ... }] }
  403 { "reasons": [{ "code": ..., ... }] }        a sign-up your refuseSignUp closed the door to
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
`x-forwarded-proto`. Where the site is served over TLS, name the cookie `__Host-session`: a
browser then refuses to take it from anywhere else, and refuses it over plain HTTP, which is
why that is not the name it ships with.

**A session that ended is swept.** `revoke` writes `expires` as the moment it happened, and
`auth/Session` removes every session whose end is more than `keep` days ago (30), when the
module is made and every `sweepMs` (an hour). A session with no lifetime that was never revoked
is never swept. Both are configuration beside `sessionMs`.

## The bounds

The sign-in route counts before it hashes, so a flood buys no hashing. Each number is
configuration on `auth/Enter`, the same same-named-file way:

```ts
// modules/auth/Enter.ts
export const config = {
	attemptsPerEmail: 5,        // per email inside the window; a sign-in that succeeds clears it
	attemptsPerAddress: 20,     // per peer address inside the window, whatever the emails
	attemptsWindowMs: 900_000,  // fifteen minutes
	hashesInFlight: 8,          // beyond it, 503 with Retry-After: 1 and no hash started
	passwordMin: 8,             // characters; shorter is 400 before anything is hashed
	passwordMax: 256,           // longer is 400 too, so a hash is never asked of a megabyte
	refusePassword: null,       // (password) => boolean | Promise<boolean>: true refuses with 400
	refuseSignUp: null,         // (signUp) => Refusal | undefined, sync or async: a refusal answers 403
};
```

Over either attempt count the answer is 429 with a `Retry-After` in seconds and the reason
`attempts`. The address is what the gate put in the context, which is what the listener saw:
behind a proxy, start the Node listener with `forwarded` or every client is one address. The
counts are in memory and a restart clears them; each holds at most 65 536 keys, and past that
the oldest key under its count goes first, so a flood of fresh emails frees no locked email, and
a flood that locks that many does. `refusePassword` is where a breached-password list or a
lookup goes; the battery ships none. Any composition is taken: eight spaces are a password.

**Who may sign up is yours** (design 291). `refuseSignUp` is asked once per sign-up, after the
counts and the password rule and before anything is hashed, with `email` (normalised), `extra`
(every field of the body but `email` and `password`: an invite token, a role picked on the
form), `context` (what the gate identified: `user` null, the peer's `address`) and `store`, so
a rule that reads a document of yours needs no second way to reach it. A refusal it answers is
the route's 403 with that one reason, and nothing is made. A sign-in never asks it, and neither
does `enter()` called from a module of yours: the rule is the door's, not the function's. A rule
that throws is the route's 500. The battery ships none; an application that keeps invites in
its store writes the lookup here, and marks the invite used in the same function, since a
password the rule before it refused never reaches it.

```ts
// modules/auth/Enter.ts: sign-up by invitation
export const config = {
	refuseSignUp: async ({ email, extra, store }) => {
		const token = typeof extra.invite === 'string' ? extra.invite : '';
		if (token === '' || !(await redeem(store, token, email))) return { code: 'invite', message: 'sign-up is by invitation' };
		return undefined;
	},
};
```

Hashing takes memory: scrypt at these parameters holds about 16 MiB per password, so
`hashesInFlight` is the memory bound and the attempt counts are the rate bound. The count on
every route before the gate is `@aweftjs/server`'s (`limits`).

**Enumeration is accepted.** `auth/Check` answers whether an email has an account, and a sign-up
answers 201 where a sign-in answers 200, so anyone can learn whether an address is registered.
A sign-in form asks before asking for a password, and one route signs up and in. What makes it
survivable is the per-email count: knowing an address exists buys five tries in fifteen minutes.

## The mail flows

`mail` is `auth/Verify` and `auth/Password`. Both send through `notify/Send` with
`channels: ['email']`, so `notify` is in `sources` and configured with a mailer. Each needs one
setting with no default, because a battery never picks a URL: `url`, a function from the token
to the address of the page that takes it, which is where you put `auth/Verify` and
`auth/Reset` from the client half.

```ts
// modules/auth/Verify.ts
export const config = {
	url: (token) => `https://app.example/verify?token=${token}`,
	subject: 'Verify your email address',
	verifyMs: 86_400_000,       // the link lives a day
	sendsPerUser: 5,            // mails one person may ask for inside sendsWindowMs (a day)
	sendsWindowMs: 86_400_000,
	resendMs: 60_000,           // and a minute between two
	sweepMs: 3_600_000,         // how often expired links are removed
};

// modules/auth/Password.ts
export const config = {
	url: (token) => `https://app.example/reset?token=${token}`,
	subject: 'Reset your password',
	resetMs: 3_600_000,         // the link lives an hour
	attemptsPerUser: 5,         // change attempts inside attemptsWindowMs (fifteen minutes); the current password is a password being guessed
	attemptsWindowMs: 900_000,
	forgotPerEmail: 5,          // forgot asks per email and per address inside forgotWindowMs (a day)
	forgotPerAddress: 20,
	forgotWindowMs: 86_400_000,
	sweepMs: 3_600_000,
};
```

```
POST /api/verify/send                          signed in: mails the link
  200 { "ok": true }   401 private   409 verified   429 attempts   502 mail
POST /api/verify        { "token": "..." }     anyone: takes the link once
  200 { "user": "<id>" }   400 token

POST /api/password      { "current": "...", "password": "..." }   signed in
  200 { "ok": true }   401 password (the current one is wrong)   400 password (the new one)   429 attempts
POST /api/password/forgot { "email": "..." }   anyone: 200 whatever the address
  200 { "ok": true }   400 email   429 attempts   502 mail
POST /api/password/reset  { "token": "...", "password": "..." }   anyone
  200 { "user": "<id>" }   400 token | password
```

**A link is one use, and lives its lifetime.** A token is what a session token is, sixteen
random bytes; the document `verify:<token>` or `reset:<token>` names who it is for and when it
ends, and is removed when taken or once expired. Taking a verification link writes
`emailVerified` on the user and grants `verified`. Taking a reset link sets the password and
ends every session of the person. A change needs the current password, sets the new one, and
ends every other session, keeping the one that asked. The new password goes through
`auth/Enter`'s `checkPassword`, so `passwordMin`, `passwordMax` and `refusePassword` apply once.

**The mail says one thing and carries one link.** The body is the sentence and the address as
text, the HTML the same with the address as a link, under `subject`. For a mail of your own,
write a module that names `notify/Send` and calls `send` with your `html`; the two here own no
template. A mailer that answers anything but ok, or throws, is 502 with the reason `mail`, and
the link still stands, so the person asks again once the mailer is back. That reason carries
`detail` and `fix` beside `code` and `message`: `message` is the one sentence a page shows the
person, `detail` is what the mailer said, word for word, and `fix` tells whoever runs the server
where to look (design 293).

**`forgot` answers 200 for an address nobody has**, and sends nothing, although `auth/Check`
enumerates: the mail route is the one that costs a send, and a stranger typing addresses must
not steer it. While the mailer is down a known address answers 502 and an unknown one 200,
which tells them apart; `auth/Check` already does. The counts are in memory and a restart
clears them, as sign-in's are.

**A verification mail goes only when asked.** Nothing is sent at sign-up. A page asks for it
with `verify()`, or a module of yours calls `Verify.send(user)` after `enter`.

## The client half

```ts
import { createClient } from '@aweftjs/client';
import { createAuth } from '@aweftjs/auth/client';

const client = createClient();                        // the page's own origin
const auth = createAuth(client);                      // the page's own origin, and global fetch

auth.user.effect((who) => header.textContent = who ?? 'signed out');

const outcome = await auth.enter('ada@example.com', 'correct horse battery staple');
if ('refused' in outcome) show(outcome.refused);
// A sign-up rule on the server reads a third argument: auth.enter(email, password, { invite })

const state = await auth.state<State>().ready;
state.theme = 'dark';                                 // applies here, and goes

deleteButton.hidden = auth.names.map(() => !auth.may('posts.delete'));   // shown or hidden; the server refuses either way
await auth.verify();                                  // the verification mail
await auth.change(current, next);                     // the password; the socket stays signed in
await auth.forgot('ada@example.com');                 // the reset mail, 200 whatever the address
await auth.reset(token, next);                        // from the link; every session ends, this page's too
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

**`names` and `may` are for showing and hiding.** `names` is a read-only cell: `undefined`
until the server has answered, `[]` for an anonymous connection, the granted list otherwise,
following the `roles` share while the socket is open, so a name granted on the server appears
on the page with no reconnect. `may(name)` runs the same check the server's gate runs, over
those names and the table the `auth/Roles` call answered; false until `names` is known. A page
hides a button with it. The server's gate is what refuses, and a page that shows the button
anyway changes nothing.

**`verify`, `change`, `forgot` and `reset` are the mail routes**, each answering `{ ok: true }`
or `{ refused }` with the route's reasons, and rejecting `<name>-failed` for any other status.
`verify()` asks for the mail and `verify(token)` takes the link; neither reconnects, and
`verified` reaches `names` through the share. `change` keeps the session that asked. `reset`
reconnects, because every session of the person is over, this page's included when it was
theirs, so `user` reads `null` afterwards.

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
are, the page's own by default and read when a route is first called, so making an auth outside a
page is fine and only calling one refuses `no-origin`. `fetch` makes the two HTTP calls, the
global by default; a Node program hands in one that carries the cookie, because Node's `fetch`
keeps no cookie jar. The client's own `open` seam is the third, and it is `@aweftjs/client`'s: a
Node program hands in a socket carrying the same cookie header.
[`recipes/client`](https://github.com/torrinworx/aweft/tree/main/recipes/client) runs all three.

## The page modules

`@aweftjs/auth/client` also exports `authClient`, a source of four modules for a stage's
`sources`. Put it there and the sign-in form, the verification page and the reset form are
each one line in the acts map.

```tsx
import { authClient } from '@aweftjs/auth/client';

<StageContext
	sources={[app, authClient]}
	client={client}
	acts={{ '': Home, notes: 'notes/Page', join: 'auth/SignIn', verify: 'auth/Verify', reset: 'auth/Reset' }}
	refused="join"
>
	<Stage />
</StageContext>
```

| module | what it is |
|---|---|
| `auth/Session` | `createAuth` over the `client` the stage handed the loader. Its instance is the `Auth` above, so any module of yours that needs to know who the page is names it in `deps` |
| `auth/SignIn` | an act module: the sign-in and sign-up form, in one, because `enter` does both |
| `auth/Verify` | an act module: with a `token` in the act's parameters or the URL's query it takes the link as it mounts and says what happened; without one it offers a signed-in person the mail |
| `auth/Reset` | an act module: without a `token` the forgot form, with one the new-password form |

**The battery never picks a URL.** `auth/SignIn` lands on the address you name it at, and
`refused: 'join'` is what puts it in front of a page your own gate module refused. `auth/Verify`
and `auth/Reset` land where you name them too, and the `url` you configure on the server's
`auth/Verify` and `auth/Password` is what points the mail at those addresses:
`verify: 'auth/Verify'` in the acts map goes with `url: (token) =>
'https://app.example/verify?token=' + token` in `modules/auth/Verify.ts`.

**Configuring `auth/Session`** is the ordinary module thing: a file exporting only `config`, in a
source before this one. It reads `origin` and `fetch`, the same two seams `createAuth` takes.

```ts
// modules/auth/Session.ts, in your own source
export const config = { origin: 'https://api.example.com' };
```

**Replacing any of them** is the same rule every battery module has: a module of that name in
an earlier source wins. A sign-in form of your own is `auth/SignIn` in your own directory.

**`auth/SignIn` picks no URL after a successful `enter`.** The visitor stays on the address they
asked for. When the form is what `refused` put there, the stage handed it a `retry`, and it calls
that: the act the URL chose is built again in place, so the gated page appears with no navigation.
On a URL of its own the form has no `retry` and a success does nothing at all.

**No gate module ships.** "Allowed" means something different in every application, so the page
writes its own and the act that needs it names it in `deps`. A gate that wants a name waits for
`names` the same way it waits for `user`, and reads `may`:

`user` reads `undefined` until the first socket answers, so a gate waits for the first answer that
is not `undefined`. Reading `undefined` as "not signed in" would let a stranger in for as long as
the handshake takes. The wait is safe on a static render too, because there is no socket there and
identity is answered from the first read.

```ts
import { codecError } from '@aweftjs/codec';

export const deps = ['auth/Session'];

/** The first value of a cell that is not `undefined`, which is the first real answer. */
const answered = (cell) => {
	const held = cell.get();
	return held !== undefined ? held : new Promise((done) => {
		const off = cell.watch((now) => {
			if (now === undefined) return;
			off();
			done(now);
		});
	});
};

export default ({ imports }) => ({
	require: async (name) => {
		const who = await answered(imports.Session.user);
		if (who === null) {
			throw codecError('anonymous', 'this page is for a signed-in user', 'Sign in first.');
		}
		await answered(imports.Session.names);
		if (name !== undefined && !imports.Session.may(name)) {
			throw codecError('needs', `this page is for someone holding ${name}`, 'Ask for access.');
		}
		return who;
	},
});
```

The act calls `require()`, or `require('reports')`, in its own factory, the load rejects, and
the stage shows whatever `refused` names. The check on the page is what decides which act
shows; the server's gate is what decides what the act can reach. [`recipes/client`](https://github.com/torrinworx/aweft/tree/main/recipes/client)
is the whole pattern in one small application.

**A static render has no connection.** Handed no `client`, `auth/Session` is anonymous at once:
`user` reads `null` and `names` reads `[]` from the first read, `may` is false, `state()`
rejects `anonymous`, and `enter`, `leave`, `check` and the four mail calls refuse `no-client`.
So it is an anonymous static render: a gated act shows the refused act, and a module reading a
document with no client renders its waiting state. Handed something that is not a client, it
refuses `no-client` too, naming what was missing.

## What is stored

Six kinds of document in your store, named by prefix:

- `user:<id>`: `email`, `name`, `password` (the scrypt hash, with its parameters and salt
  written into it; never the password), `emailVerified`, `createdAt`, `modifiedAt`. Never
  shared on a link.
- `session:<token>`: `user`, `expires` (the lifetime's end, the moment of revocation, or null
  for never), `status` (`active` or `revoked`), `createdAt`.
- `roles:<user>`: `names`, what the person was granted, and `modifiedAt`. Shared to its own
  user under `roles`, refusing every commit. `auth:first` is the one-line marker that says a
  first sign-up has been seen.
- `state:<user>`: whatever you keep per user. `auth/State` shares it under `state`, accepting
  every commit, because it is theirs.
- `verify:<token>` and `reset:<token>`: `user`, `expires`, `createdAt`. Removed when taken,
  or by the sweep once expired.

The state document is an `@aweftjs/core` observable, as every document in the store is: put
a list in it with `createArray` from `@aweftjs/core`, an object with `createObject`, and group
writes with `atomic`; that package's README shows the shapes. **Keep its root an object.**
`paths` declares `email`, `user` and `expires` for every document in the store, and the store
refuses a declared path that meets an array, so a document whose root is an array cannot be
written to a store that declares them; a list goes in a field. A store that does not declare
them refuses `auth/Session` as it is made, naming the fix.

Ids are the stack's ids: twelve random bytes from the platform's secure source, sixteen
characters. A session token is sixteen random bytes of its own from the same source, twenty-two
characters, because a credential needs 128 bits and an id was never one. Passwords are hashed
with Node's own `scrypt` and compared with Node's own `timingSafeEqual`; there is no dependency,
and no test here measures timing.

Two sign-ups for one email in the same instant can both succeed, because a unique index is
the store driver's and none ships. A sign-in with a mistyped new email creates an account:
that is what one module for both means, and `auth/Check` exists so a form can ask first.

The gate puts the peer address in the context beside `user` and `session`, as the listener saw
it, so a route of yours can count by it the way `auth/Enter` does.

## What it never does

Decide which names exist, beyond `verified`, or what any of them means. Grant over the wire.
Expire a name. Show another person's names to a page. Change an email address, and so decide
what one does to `verified`. Send a mail nobody asked for. Own a mail template. Pick a URL.
Cache a check: every `may` reads the store, and an application that loads this battery has
said the read is worth it.

`securityChecks()` from `@aweftjs/testing` runs against this battery from its own suite and from
`recipes/full-stack/tests/security.test.ts`; that file is how an application runs it against
itself.

The design notes are in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design) 071 and 074, 185 and
245 for the client half, 289 for names and 290 for the mail flows.