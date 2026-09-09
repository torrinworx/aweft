# 241: The gate may be a module name, and a composed gate is a module

## Decision

`gate` on `createServer` is a `Gate` object, as it always was, or the name of a module.

```ts
createServer({ sources: [own, auth], store, gate: 'auth/Gate', listener });
```

**A name is resolved after `start()` has loaded the sources**, with `server.loader.get(name)`.
It has to be: the module that is the gate is one of the modules the sources list, and it does
not exist until `start()` has run the factories. So `createServer` accepts a string without
looking at it, and `start()` turns it into a gate before it builds the route table and long
before the listener is accepting anything.

**A name that is not loaded, or whose instance is not a gate, is a `ServerError` with reason
`missing`**, naming the gate and saying what to do: `Name a module the sources list whose
instance is a gate, or pass a Gate object.` One reason covers both, because the two are the
same mistake from the caller's side (the name does not get you a gate), and the detail says
which of the two happened. The check is the two functions, which is all design 071
ever said a gate is: an instance carrying `identify` and `access` is one, whatever else it is.

**A `gate` that is neither a name nor a gate is refused at `createServer`**, by the same check
and with reason `missing`, its fix naming all three shapes: `Pass an object with identify and
access, open, or the name of a module that is one.` Only the absence of the field was refused
before, so `gate: 0`, `gate: {}` and a bare function booted and then answered every request 500,
reported as `gate`. A JavaScript caller who read their gate out of a configuration and got the
wrong thing now hears about it where the mistake is.

**A named gate is read off the loader at every use**, at `identify` for a handshake or a
request and at `access` for each check, which is how the route table has always been read
(design 072). It is not resolved once at `start()` and held. A gate module is a module: it can
be reloaded through `follow(server.loader, ...)` like any other, and an instance captured at
boot would leave the stopped instance deciding policy while every route around it was the new
one. `start()` still resolves the name once, so a boot naming a gate no source lists still
fails loudly and before the listener accepts anything. In the window where the name has been
unloaded and not yet reloaded, `identify` and `access` refuse with that same `missing` error:
the request answers 500 and is reported as `gate`, which is what an unreachable policy is. A
gate passed as an object is the object, checked once at `createServer` and never looked up.

**A composed gate is a module.** An application that wants the battery's policy plus a rule of
its own writes a module that `deps` on `auth/Gate`, holds it as `imports.Gate`, and returns a
gate whose `identify` is the battery's and whose `access` calls the battery's first and adds
its own reasons:

```ts
export const deps = ['auth/Gate'];

export default ({ imports }) => ({
	identify: (request, peer) => imports.Gate.identify(request, peer),
	access: async (module, context) => {
		const reasons = await imports.Gate.access(module, context);
		if (reasons.length > 0) return reasons;
		return module.instance.admin === true && context.user !== admins.first
			? [{ code: 'not-admin', message: `${module.name} is for the administrator` }]
			: [];
	},
});
```

and names it: `gate: 'app/Gate'`. There is no `compose`, no array of gates and no chain. Two
policies in a row is a function calling a function, which is what a module already is.

**Key concept 11 is unchanged.** The application supplies the gate, by name or by object; no
module decides for itself who may reach it; nothing ships as a default; `open` is still the
one word a trusted service types. A name is a second way of saying which gate, not a second
place the decision is made.

## Why

Under design 240 the server builds the loader, so the boot file no longer has an instance to
read a gate off. Every application was writing the same two lines to get one, and with the
loader gone from the boot file those two lines had nowhere to stand. The name is what is left
when they go.

It also makes the composed gate ordinary. Before this, an application adding one admin rule to
the battery's gate wrote an object in the boot file that closed over `loader.get('auth/Gate')`,
which is the exact habit design 240 exists to remove: a service built in the boot file and
threaded around by hand. As a module it declares what it needs, is built in dependency order,
and is replaceable by name like anything else.

An object is kept because a gate with no session in it (an address allowlist, a shared secret,
a header from a proxy) is a ten-line literal that has no reason to be a file, and because
`gate: open` has to keep working.

## What it costs

A misspelled gate name is a boot failure rather than a type error. `gate: 'auth/Gates'`
compiles, and `start()` refuses it by name. That is the cost of naming anything, and it is why
the refusal names the gate and says what a gate is rather than only that it was not found.

A gate module is loaded like every other module the sources list (design 240), so an
application cannot name a gate that is deliberately not loaded. Nothing wants to.

## What would reverse this

An application that has to pick its gate per request, or one that needs two gates on one
server. Either is a different shape from this one and would be a note of its own; nothing on
the wire moves with it.

## What this amends

**Design 071** says `createServer({ loader, gate, listener })` refuses to start without a
gate, and that a module instance is a gate when it carries the two functions. Both still hold.
This adds the name as an accepted spelling of the second field, and turns that note's
sentence about `loader.load(['auth/Gate'])` answering with a gate into the thing the server
does for you. Its paragraph on composing two policies (a module whose `access` calls both) is
now how it is done rather than a remark, and the example above shows it.

**Design 074** says the battery is server modules read through a loader, with `auth/Gate` the
gate. Unchanged, and now named rather than fetched: `gate: 'auth/Gate'`. The battery's source
and its `paths` do not move, and `auth/Gate` is still what an application replaces by putting
a module of that name in its own source.

## Evidence

`packages/server/tests/boot.test.ts`: a gate named as a string resolved at `start()` and
deciding a real call; a name no source lists refused at `start()` with reason `missing`, with
the fix read off the error; a loaded module that is not a gate refused the same way; a `Gate`
object still accepted, and `open` with it; and a composed gate module that `deps` on another
gate module refusing a call with its own reason while the module it wraps allows it. Also:
`{}`, `0`, `false`, a function and an object carrying only `identify` refused at `createServer`
with the fix read off the error, `open` and a two-function literal accepted; and, over a
`fromDocument` source followed with `follow(server.loader, document)`, a gate module edited
from allowing to refusing, after which the first instance's `stop` has run and the next request
is refused 403 with the new gate's reason. The reload window has its own case: a gate whose
`identify` awaits, unloaded through `server.loader` while one request is inside it, answers that
request 500 and reports it as `gate`.

That suite also catches three changes, each with one test: the non-string gate not checked at
`createServer`, the named gate's instance captured once instead of read at each use, and the
reload window left to the route's own catch, which reported it under the module's name rather
than as `gate`.

`recipes/backend/main.ts` boots on `gate: 'app/Gate'`, an admin rule over `auth/Gate`, and
`recipes/backend/checks.ts` signs two users up and reads the second one's refusal.
