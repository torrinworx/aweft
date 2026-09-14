# 245: `@aweftjs/auth/client` ships a source: `auth/Session` and `auth/SignIn`

Amended by design 290: `auth/Verify` and `auth/Reset` join the source.

## Decision

`@aweftjs/auth/client` exports `authClient`, a `Source` over two modules, beside `createAuth`.
An application puts it in the stage's `sources` and the sign-in form is one line in its acts map.

```tsx
<StageContext
	sources={[app, authClient]}
	client={client}
	acts={{ '': Home, notes: 'notes/Page', join: 'auth/SignIn' }}
	refused="join"
>
	<Stage />
</StageContext>
```

### `auth/Session`

A module over `createAuth`. Its factory takes `client` from the props the stage handed the
loader (design 242) and its instance is the `Auth`: `user`, `enter`, `leave`, `state`, `check`
and `stop`. `stop` on the instance is what the loader calls on unload, so a page that lets go of
the module lets go of the status watcher and the state handle with it.

- **`config.origin` and `config.fetch`** go to `createAuth` as its options, so a page served from
  another origin, or a Node program with a cookie jar, configures the module the way any module
  is configured: an extension file with a `config` in an earlier source.
- **Handed no `client`, it is anonymous at once.** There is no socket at all, not even a stand-in
  that never opens. `user` reads `null` from the first read (known, and
  nobody), `state()` rejects `anonymous` at once exactly as the real one does for an anonymous
  connection, and `enter`, `leave` and `check` refuse `no-client` with the fix on the error.

  The other shape, a client that never opens with `user` never leaving `undefined` and an act
  that waits on identity rendering its waiting state, hangs. A gate that waits for the first real
  answer is the correct way to write one, because `undefined` is not
  an answer and a gate that read it as one would let a stranger in for as long as the handshake
  takes; the recipe's own gate does exactly that. Over a socket that never opens the answer never
  comes, `render` waits on every promise a component handed `pending`, and the render never
  returns. Measured: a static render of the client recipe's gated act was still running after six
  seconds. Anonymous at once ends it: a gate refuses immediately, and the sign-in act is what a
  static render of a gated page holds.
- **Handed a `client` that is not one, it refuses `no-client`**, naming what was missing. An
  absent connection is a render with no page; an object with no `status` is a mistake at the
  boot, and the two should not look the same.

**`createAuth` resolves the page origin when it first calls a route, not when it is built.** It
threw `no-origin` from the constructor, which made the module unbuildable anywhere there is no
`location`: a static render, a Node test, a walk. Nothing about the origin is needed until `enter`
or `leave` sends something over HTTP, and those two still reject `no-origin` with the same fix.
`check` goes over the socket rather than the origin, so it never asks for one.

### `auth/SignIn`

An act module. `deps: ['auth/Session']`, and its factory returns `{ component, title: 'Sign in'
}`.

One form, sign-in and sign-up together, because `enter` does both: an email nobody has is an
account, and the answer says which it was. It is built on `TextField` and `Button` only, because
the Field family is gone; the label, the description and the error are the controls' own props.

- The submit calls `imports.Session.enter(email, password)`.
- A refusal (`{ refused }`) is shown on the form, each reason's message under the control its
  `code` names, so a wrong password reads under the password field.
- **On success it calls the `retry` the stage handed it, and nothing else.** The battery still
  picks no URL: the visitor stays on the address they asked for, and `retry` builds
  the act that address chose (design 244), so a gated page appears in place with no navigation.
  On a URL of its own the form is not standing in for anything, `retry` is absent, and a success
  does nothing at all.

### No gate module ships

A page that needs a signed-in user writes its own gate module. `auth/Session` throws nothing:
`user` is a cell, and reading `null` off it is an answer rather than a fault.

`user` reads `undefined` until the first socket answers, and `undefined` is not an answer, so a
gate has to wait for the first one that is. A gate that read `undefined` as "not signed in" would
let a stranger in for as long as the handshake takes; one that read it as "signed in" would show a
private page to nobody. The wait is safe everywhere, because a static render has no socket and is
anonymous from the first read.

```ts
export const deps = ['auth/Session'];

export default ({ imports }) => ({
	require: async () => {
		// `undefined` is not an answer and `null` is, so only the first one is waited for.
		const held = imports.Session.user.get();
		const who = held !== undefined ? held : await new Promise((done) => {
			const off = imports.Session.user.watch((now) => {
				if (now === undefined) return;
				off();
				done(now);
			});
		});
		if (who === null) {
			throw codecError('anonymous', 'this page is for a signed-in user', 'Sign in first.');
		}
		return who;
	},
});
```

The act `deps` on it and calls `require()` in its factory, the load rejects, and `refused` shows
the sign-in act (design 244). Shipping the gate instead would mean the battery deciding what
"allowed" means for pages it has never seen, and each of four applications means something
slightly different by it: a role, an owner, a plan. `recipes/client` shows the
pattern in eleven lines.

## Why

The two applications that carry auth each hand-write the same wrapper twice: wait for the auth
packet, bounce to sign-in, wait for the synced state, check the role, else 404. The waiting halves
of that are `auth/Session` and the stage's own loading state, and the sign-in form is a form every
application writes from scratch and none of them wants to.

The reason the form can ship at all is that it decides nothing an application would want back:
it has no URL of its own, no redirect, and no opinion about who may see what.

## What it costs

**`auth` on the page pulls in `@aweftjs/ui`.** The client subpath was written so a page bundle
that reaches for it carries no server module and no store (design 185); now it carries the
component library too, for the form. That is a bundle a page with a sign-in form was going to
have anyway, and `authClient` loads the two modules lazily, so a page that never shows the form
never evaluates `SignIn.tsx`.

**The form's look is the default theme's**, and an application that wants another writes a module
of the same name in an earlier source, or a config-only file over this one. That is the same
replacement rule every battery module has.

**`no-origin` moved.** A program that built a `createAuth` outside a page and relied on the
constructor throwing now hears about it at the first route call instead.

**A static render can no longer show a page's "signing in" state.** Identity is answered before
anything can wait on it, so the markup a static render writes for a gated page is the refused act,
never a spinner. A page that wants a spinner in its markup is asking about a connection, and a
static render has none.

## What would reverse this

A second form in the battery (a password reset, an email verification) would reopen whether one
act name per view is the right grain or whether the battery should ship one act with a mode. A
static render that has to hold a page's waiting state rather than its refused one would reopen
anonymous-at-once, and the answer there is a deadline on the wait rather than a never-opening
socket.

## Evidence

`packages/auth/tests/client-modules.test.ts`: `authClient` lists exactly `auth/Session` and
`auth/SignIn`; `auth/Session` over a real client against a `node({ port: 0 })` server signing a
user up and reading the id back; the same module handed no client reading `null` at once, a gate's
wait for the first answer returning immediately, `state()` refusing `anonymous`, and `enter`,
`leave` and `check` refusing `no-client` with the fix on the error; `no-client` refused for a
`client` that is not one; `auth/SignIn` mounted in the light tree, a submit calling `enter`, the
refusal from `enter` shown on the form, and `retry` called on a success and not on a refusal.
A static `render` of a stage whose gated act awaits identity, with `authClient` in `sources` and no
`client`, finishing with the sign-in act in its markup: 5 ms, against a render that was still
running after six seconds under the never-opening shape.

`recipes/client` drives the form in Chromium: a real sign-up sets the cookie, the gated act
appears at the same URL with no navigation, and axe finds no WCAG 2.2 AA violation on the form in
either mode.
