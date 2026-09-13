# 240: The server builds its own loader, loads what the sources list, and hands `store` in as the one prop

## Decision

`createServer({ sources, store, gate, listener, handlers })`. The server makes the loader
itself and nobody hands it one.

```ts
const server = createServer({
	sources: [fromDirectory('./modules'), auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});
await server.start();
```

**The server builds the loader synchronously, inside `createServer`.** It calls
`createLoader({ sources, props: { store } })`, and leaves `props` out entirely when no `store`
was given, so a module's factory can tell a store it was never handed from one that is there.
`store: undefined` is the same as no `store` at all: a caller who reads a store out of their
own configuration and finds nothing is passing the absence, not asking for a prop holding
`undefined`.

**`server.loader` is the loader, readable.** It is what `follow` takes, what a test reads
instances off, and what an application loads or unloads a module through while the server
runs. Everything design 063 says about a loader still holds: which modules load, when, and
for how long are the caller's, and the server changes only the answer at boot.

**`loader` and `props` are not options.** Either one present in the options object is refused
at `createServer` with a `ServerError` whose reason is `not-an-option` and whose fix names the
shape: `Pass sources, and make anything you would have passed as a prop a module that others
deps on.` The refusal is on the key being present, not on its value, because
`props: undefined` written out is the same mistaken idea as `props: {}`.

**`start()` loads every module every source lists**, before anything else it does. It asks
each source for its candidates, hands every name to `loader.load(names)` in one call, then
resolves a gate named as a string (design 241), then builds the route table, then starts the
listener. There is no load list, and a name a source lists is loaded whether or not anything
asks for it. A modules directory therefore holds modules and nothing else, and a file dropped
in it is running after the next boot with no second edit anywhere.

**The props rule, as a guarantee this package makes: the platform hands in `store`, and
nothing else.** There is no second prop today and adding one is a design decision, not an
option. Anything the application makes is a module that others name in `deps`: a rules
object, a scheduler, a document held open, a client of another service. That is what `deps`
and `imports` are for (design 061), and a prop bag beside them is a second way to do the
same job with none of the ordering.

**A loader failure during `start()` is thrown as it is.** A factory that throws reaches the
caller as the `ModulesError` with reason `failed` that the loader raised, carrying the throw
as its cause and naming the module. Wrapping it in a `ServerError` would cost the caller the
one thing they need, which is which module broke and why. The server is left not started: the
listener never starts, and `start()` may be called again after the cause is fixed.

**What is already loaded when `start()` fails stays loaded**, which is the loader's own rule
(design 063), and `stop()` unloads it. `stop()` after a failed `start()` is safe and is the
way to let go: it ends nothing (there are no connections), stops a listener that never
started, and then unloads. So a program that boots, fails, and exits still runs the `stop` of
every module that got as far as being made.

**`stop()` unloads every loaded module, in reverse load order**, after the listener has
stopped and every connection has ended. `loader.loaded()` is the order the factories finished,
which is a dependency order, so reversing it stops a module before the modules it depends on.
Each module's own `stop` runs, which is what `unload` does. A `stop` that throws is reported to
`handlers.failed` under that module's name and the rest still unload, because the modules that
have not been reached yet are the ones underneath it, holding the sockets and files; `stop()`
itself does not throw and the server is stoppable afterwards either way. The loader belongs to this server
and nothing else can be holding it, so there is nobody to strand: a module shared between two
servers would be a reason to leave it loaded, and under this shape there is no way to write
one. A server started again after `stop()` loads everything from the sources afresh.

## What this amends

**Design 071** says `createServer({ loader, gate, listener })`, all three required. Two of the
three stand. `loader` is replaced by `sources`, and `store` joins them as the one optional
field. Everything else in 071 is untouched: the gate is still required, still outside every
module, still two plain functions, and the server still interprets nothing in a context and
reads nothing off a module on the gate's behalf. Who may reach a module, and how a gate answers
that, is untouched; only who builds the loader changes.

**Design 072** describes the connection and says the server runs the `connection` hook of
every loaded module the gate allows, in load order, and reads the route table off the loader
each time. Both still hold, over the loader the server now owns. What changes is which modules
are loaded when the first connection arrives: everything the sources list, rather than
whatever the application had named by then. The two paragraphs about a module loaded or
unloaded while the server runs are unchanged, and `server.loader` is where that happens now.

**Design 063** (`modules` decides no policy) is not amended. A loader still decides nothing;
the server decides, for its own loader, that everything the sources list is loaded at boot.
Nothing in `@aweftjs/modules` learns about a server.

## Why

The boot file was 11 to 35 lines in every application that had been written against the old
shape, and none of that was the problem. What the old shape taught was where to put things.
The application built a loader, so the boot file was the place a store handle, a rules table, a
scheduler and a guarded document got made, and `props` was the way to reach them from a
module. Nothing was loaded that the boot file did not name, so every new module cost an edit
in two places. Setting a backend up should take twenty lines, and everything else an application
does should be a module.

With the loader inside the server there is nowhere in the boot file to put a service object,
so the shared thing becomes a module and the modules that need it name it in `deps`. That is
the same mechanism, used the way it was designed, and it brings the ordering with it: a module
that holds a document open is built before the module that shares it, because it said so.

Loading everything a source lists rather than a named list is the same idea one layer down.
A list of names in the boot file is a second place to remember, and the failure it produces
(a module written, saved, and never loaded) is silent. A directory of modules is the list.

`store` stays a prop rather than becoming a module because the application makes it, from a
driver only the application knows, before there is a loader to make anything in. Everything
downstream of it can be a module; it cannot.

## What it costs

**A module cannot be loaded lazily by leaving it out of a list.** Every candidate is
instantiated at boot, so a source listing a hundred modules builds a hundred instances before
the listener starts. A module whose factory is expensive does its expensive work when it is
first used rather than when it is made, which is the shape a factory should have anyway. An
application that genuinely wants a module present but not built keeps it in a source it adds
later, and loads it through `server.loader`.

**A wrong name in a source is a boot failure rather than a quiet absence.** That is the trade
being bought: the failure is loud and at the start rather than the first time somebody asks.

**Two servers cannot share one set of instances.** Each builds its own loader, so two servers
in one process hold two copies of every module. Nothing in this repo needed one set, and the
alternative (a loader passed in) is the shape this note replaces.

**Every source is listed twice per boot.** `start()` asks each source for its candidates to
learn the names, and `load` asks them again to find each name an implementation. Listing
evaluates nothing by contract (design 062), so for a bundle, a document and a directory this is
a second walk and no more. It is a cost only for a source whose listing is itself expensive (a
network call, say), and the fix if one appears is an entry on the loader that loads everything
its sources list, so the server never has to ask for the names separately.

`server` may not import `@aweftjs/store` (`boundaries.json`, and the tier rule), so `store` is
typed `unknown` on the options and its block comment says what it is. A caller loses nothing:
the store they pass is the store their modules read, and their modules type it themselves.

## What would reverse this

An application that has to run two servers over one set of module instances, or one that has
to load a module lazily and cannot express it as a source it adds later. Either would reopen
whether `loader` comes back as an option. A second thing the platform has to hand every
module would reopen the props rule; it would be a note of its own, and until one is written
`store` is the whole of it.

## Evidence

`packages/server/tests/boot.test.ts`: `start()` loads everything two sources list, in
dependency order, with no list anywhere; a `connection` hook of a module nobody named runs on
a real connection over the node listener on port 0; `loader` and `props` refused by the key
being present, with the fix read off the error; `store` reaching a factory as `store`, and
absent from the props when none was given; `stop()` running every module's `stop` in reverse
load order; a factory that throws leaving the server not started, reaching the caller as a
`ModulesError` with reason `failed`, `start()` accepted again once the cause is fixed, and
`stop()` afterwards still running the `stop` of the module that was made before it;
`server.loader` readable, and `follow` over it reloading a module edited after `start()`; a
middle module whose `stop` throws leaving the module underneath it unloaded anyway, the throw
at `handlers.failed` under that module's name, and the server startable again; and two
`start()` calls raced, one fulfilled, the other refused as `started`, with the listener started
once and the factories run once.

That suite catches each of these changes, with the number of tests that fail beside it: loading
skipped in `start` (24 tests), the gate name not resolved (4), the gate name resolved before
loading (3), the loaded gate not checked for the two functions (1), `props` not refused (1),
`loader` not refused (1), `store` not passed (1), the `store` key present holding `undefined` when
none was given (1), `stop` not unloading (2), the unload order not reversed (1), the route table
built before loading (1), and `started` cleared on a failed `start` (1).

Four more such changes, each caught by one test: the unload loop left to abort on the first throw,
the throw swallowed rather than reported, `started` set after the load rather than before it, and
`listener.stop()` moved below the unload loop, which a count of listener stops cannot see and the
ordered trace does.

`recipes/backend/main.ts` is the boot pattern an application copies: fifteen non-blank lines of
boot, imports included, in a 26-line file whose last three lines run the checks a real
application would not have, and a `modules/` directory beside it. The checks are in
`recipes/backend/checks.ts`.

## Amended

The props rule holds on a third plane (design 277): the platform hands in `store` on the
server, `client` on the page, and `client` in a room, and nothing else. The room's `client` is
shaped like the page's and backed by the host, so an act module runs on either side of the
wall unchanged.
