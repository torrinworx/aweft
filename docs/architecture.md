# Architecture

Status: living. What the stack is, what each package owns, and the decisions already taken.
Changes to a key concept need a design note in `docs/design/` before they are built.

`aweft` is a full stack JavaScript framework built on one idea: **there is one definition of
a piece of state, and it works the same on a client, on a server, and in a database.** Every
change to state is a delta, deltas group into commits, and a commit is what crosses every
boundary in the system.

---

## The shape

```
                        aweft  (batteries included, meta-package)
                                        |
        +-------------------------------+-------------------------------+
        |                                                               |
   CLIENT PLANE                                                   SERVER PLANE
   ui, icons                                                      server, jobs
   dom (+ dom/router)                                                   |
        +-------------------------------+-------------------------------+
                                        |
                                  ORGANIZATION
                                 modules, sandbox                (isomorphic)
                                        |
                                   DATA PLANE
                                  sync      store                (isomorphic)
                                        |
                                    SHAPE
                                     schema                      (isomorphic)
                                        |
                                      CORE
                                      core                       (isomorphic)
                                        |
                                     ENCODING
                                      codec                      (isomorphic)
                                        |
                                       SPEC
                             format + identity + fixtures        (no code)
```

**The one rule:** a package imports from its own tier or any tier below it. Never upward,
never across the client and server planes. The tiers are in `boundaries.json`;
`packages/testing/src/boundaries.ts` enforces them and has its own tests.

**Two exceptions, both named rather than implied:**

1. **Integrators may import across planes.** `aweft`, `ssg`, `testing`, the batteries
   packages, and applications compose the whole stack by definition. They sit above the rule,
   not inside it. Nothing may import an integrator.
2. **`build` is tooling** and sits outside the runtime rule entirely.

An exception the machine knows about is enforceable. An unstated one is how a layering
violation gets built and then depended on.

---

## Repo layout

One monorepo, many published packages, npm workspaces. No extra build orchestrator; the
tooling stays as plain as the code.

```
aweft/
  spec/
    format.md              the delta and commit format, normative
    identity.md            the id scheme
    fixtures/*.json        language neutral conformance vectors
    CHANGELOG.md           append only

  packages/
    codec/                 the encoding: values, deltas, commits, ids, positions
    core/                  observers, observables, deltas, commits, scopes
    schema/                the shape a document must keep, checked before a commit lands
    sync/                  commits between documents over any channel, both ends equal
    store/                 persistence and its driver interface
    modules/               the isomorphic module system, static and dynamic
    sandbox/               isolated execution for stored module code
    dom/                   direct DOM binding, hydration, static render
                           + dom/router subpath: history and URL to state
    ui/                    components and theming
    icons/                 icon driver interface plus one driver
    server/                connections and requests behind a gate: a listener, the link and
                           the call channel on one socket, the modules' hooks
    auth/                  the first battery: the gate, sessions, sign-in, per-user state
    jobs/                  a scheduler over an array the application hands in
    ssg/                   static generation
    build/                 transforms, in two modes
    testing/               conformance runners and harnesses

  examples/                one proof program per package, plus the integration app
  docs/
```

**Why a monorepo.** Understanding a stack should not require learning where its pieces live.
Separate repositories produce version skew between packages that ship together, several test
runners, and documentation spread across places nobody reads. A monorepo is not a monolith:
every directory above is separately published with its own `package.json`, and all of them
version in lockstep.

---

## What each package owns

| Package | Owns | Must not know about |
|---|---|---|
| `codec` | The encoding: values, refs, deltas, commits, ids, array positions | Observables, reactivity, transport, storage |
| `core` | Observers, observables, deltas, commits, scopes, identity, the seam that can refuse a commit | DOM, network, storage, schema |
| `schema` | The shape a document must keep, and whether a commit keeps it | Who made a commit, transport, storage |
| `sync` | Moving commits between documents over a channel, both ends equal | Who may write, what a commit means, DOM, storage internals |
| `store` | Persisting a document as observable rows, its commit tail, the driver interface | DOM, transport |
| `modules` | Reading module definitions from a directory, a bundle map or a document; dependency order; injection; load and unload | Whether it runs on a client or a server; storage, transport, history; who may load or run anything; which modules load or when |
| `sandbox` | The window: a loader on the far end of a link, the grants, calls as rows, and the runners that make a room | What the code it runs is for; what wall is around the room; who may load, grant or call; how many rooms and for how long |
| `dom` | Mounting, hydration, static render, URL and history | Storage, transport, components |
| `ui` | Components, theming | Storage, transport, server |
| `server` | Accepting connections and requests through a listener; one socket as a link and a call channel; running the modules' `connection`, `call` and `routes` hooks behind the gate the application supplies | Who is on a connection, who may reach a module, who may write a commit, which modules load; users, sessions, storage; component internals |
| `auth` | The gate that reads `public`, sessions as documents, sign-in and sign-up, the per-user state document, as server modules | Which application loads it; the client, this round |
| `jobs` | When a row runs, over an observable array the application hands in: the timers, the cron arithmetic, `last` written onto the row | What a job does; who may add, edit or remove a row; storage; queues, retries, catch-up; modules; component internals |
| `testing` | Conformance suites and harnesses for every layer | Nothing. It may know everything |

---

## Key concepts

A change to any of these needs a design note in `docs/design/` **before** it is built.
This is the list `AGENTS.md` refers to.

1. **The delta and commit model.** What a delta is, what a commit is, and which one crosses a
   boundary.
2. **The wire format.** Anything normative in `spec/`. A change here also needs an entry in
   `spec/CHANGELOG.md`.
3. **The observable kinds.** Object, array, map, and what each guarantees.
3b. **Attach edges and aliases.** Where an observable lives, and what a second reference to
   it does and does not mean.
4. **Scopes.** How a listener narrows which part of a tree it sees.
5. **The replication model.** How commits reach another tree, and what happens when one
   cannot be applied.
6. **Identity.** How ids are made, how wide they are, and what they may not be used for.
7. **The module contract.** What a module is, how it is discovered, ordered, and injected.
8. **The sandbox boundary.** What isolated code can reach, and how a capability is granted.
9. **The mounting model.** Mount, hydrate, and static render as modes of one path.
10. **The boundary rule.** Tiers, planes, and their named exceptions.
11. **The gate.** Who may reach a module, decided outside every module by two functions the
    application supplies, and never by the module.

---

## Decisions already taken

Each has a design note in `docs/design/`, and the note carries the reasoning and the evidence.
This is the one-line summary. A superseded note stays in `docs/design/` and says what
superseded it.

| Concept | Decided, in one line | Design notes |
|---|---|---|
| The unit that crosses a boundary | The commit. Every delta is validated, then applied, then listeners hear it once. Whether a local listener sees a torn state is a matter of `atomic`, not of which subscription it used | 001 |
| Merge rules | None. Coalescing keyed by slot is lossless, and the producer keeps a commit minimal | 003 |
| Identity and credentials | `core` mints object identity and the auth battery mints credentials, from one id source, in different modules with different call sites | 005, 074 |
| The observable array | One implementation, addressed by ordered positions that carry randomness and begin with an integer part, so appended keys stay short; no identity option | 014, 040, 082 |
| Cross-tree bridging | A supported seam, not a reach-in: apply with caller-supplied refs, insert at a position, echo suppression. Not built yet | none |
| Authority | None in the library. Who may write where is the application's rule, written into a link's `accept` or a node's own code | 053, 057; 009 superseded |
| Attach edges and aliases | One attach edge decides where an observable lives; every other reference is an alias that grants and revokes nothing. On the wire as the edge kind | 010 |
| A refused commit | Reported at both ends of the link with its commit and undo; the link picks no winner, and `reconcile` is how an end yields. A refusal never closes the link | 054; 011, 012, 043 superseded |
| A link | Two equal ends running one protocol. A channel is four functions and carries frames; each end numbers its own topics; a state moves the document rather than replacing it; nothing resumes | 053, 041, 042, 044; 045 superseded |
| Several networks on one document | Every link, store and watcher on a document hears what the others land, so a link over a socket and a store on one document work together and a node forwards between two links | 055 |
| Echo suppression | The first delivery inside an apply is the applied commit; everything after it was made here | 046 |
| A commit closes | With the mutation, or with the `atomic` block. A block that throws rolls back and emits nothing | 015 |
| The inverse | Captured where the prior value is free, in core, in both directions. Nothing on the wire | 016 |
| Scopes | A scope is a prefix of the path a delta names; a step can be a wildcard; an effect follows the depth of its scope | 017, 018, 025 |
| Scopes and values | Two surfaces of one chain: a scope's `watch` delivers commits, a derived value's delivers the value; memoized while observed, two-phase settling | 023 |
| Cells | State outside the document: `mutable`, `immutable`, `timer`, `fromEvent`, and `mutableArray`, a list whose slots hold anything and whose edits are heard one by one. Not attachable; rate limiting exists only here | 024, 026, 081 |
| Writing through a derived value | Declared, never inferred: `map` is read-only, `setter` declares the write half, one caching layer at the transform | 027, 028 |
| A snapshot | `fromSnapshot` inverts `snapshot`, holding what the document says and not what it still indexes | 029 |
| What is public | The delivery plumbing is not; the stack ships one view binding | 030, 031 |
| Style | Terse helper aliases dropped; trailing-underscore properties kept and mangled; a map carries its methods | 019, 020, 022 |
| The shape of a document | `shape`, `list` and `table` for the three kinds, any Standard Schema validator at a leaf; `check` answers whether a commit keeps the shape, `guard` runs it before every commit lands | 057; 032 to 039 superseded |
| Refusing a commit | `intercept` runs before a commit closes, after every delta applied and before any delivery; a refusal rolls back and throws with its reasons, from any source alike | 058 |
| Persistence | One row per observable and a bounded, derived commit tail; a detached observable keeps its row; a dangling alias is dropped when a document opens; a tail that cannot answer says so; nothing recorded about who wrote a commit | 047, 048, 050, 051, 056 |
| Queries | A query names a declared path and an undeclared one is refused rather than scanned | 049 |
| Giving up | "In a row" is measured in time, not in commits taken | 052 |
| Paging | Every hit carries a cursor the driver minted, naming a position in the order asked for; `after` takes it, so a page after a document that was removed or re-ranked carries on from where it was | 060 |
| The module contract | A module exports `deps`, `defaults`, optional `config` and `extensions`, and a default factory; an instance may return `stop`; `imports` is keyed by the last segment of a dependency's name | 061 |
| Where modules come from | Directories, a bundle map, or a document keyed by module name whose entries carry `source`; a source yields candidates and evaluates nothing until `load`; `compile` turns source into exports, plain ES module import by default | 062 |
| What `modules` does and decides | `load`, `unload`, `dependents`, `dependencies`, and `follow` as an opt-in helper; a loader is an instance; nothing decides which modules load, when, how many, or for how long | 063 |
| What `modules` refuses to know | No history, no authority, no storage, no transport: a module document is an ordinary document and everything that works for one works for it | 064 |
| Isolation | Later, behind G4, after `modules` is proven; `modules` claims none and says that loading a module runs its code | 065 |
| A room | A loader on the far end of a link; three documents cross it (`modules` read-only to the room, `room` read-only to the room, `calls` written by both) and nothing else; nothing inside is ambient | 066 |
| A capability | A granted name on an observable list the application changes; `expose` puts an instance behind a name; inside, the name is an import carrying the instance's functions; a removed name refuses from the next call; modules in one room trust each other | 067 |
| A call | A row in the calls document, in both directions, with JSON text either side and anything that is not data refused by name; the writer deletes an answered row | 068 |
| A runner | `start` makes the room and hands back the channel, `stop` ends it; `inProcess`, `iframe` and `child` ship, bubblewrap and docker are examples; limits are parameters with no defaults; each runner says what it stops and the wall is the operator's | 069 |
| Proof of a runner | The escape suite in `testing`, two halves, append-only, run in every shipped runner and under a real browser for the frame | 070 |
| The gate | Required and outside every module: `identify` once per connection or request answers a context or refuses, `access` runs before a module sees a connection, a call or a request; `open` is the trusted case; a module declares `public` or nothing and the auth gate reads it, `server` does not | 071 |
| A connection | One socket behind a listener the application supplies: the link as binary messages, requests as text; hooks run in load order for the modules the gate allows; a share on it requires `accept` | 072, 073 |
| Sessions and sign-in | Documents in the application's store, tokens from the id source, identity fixed per connection from the handshake cookie; sign-in and sign-out are HTTP routes | 074 |
| Scheduling | One scheduler over an observable array the application hands in: a row says when (`at`, `every`, or `cron` with `tz`) and the application's `run` does the job; `last` is written onto the row and nothing else; nothing is caught up, resumed or retried | 075, 076 |
| The mounting model | One mounter with a host seam: `mount` creates through the page, `render` through the light tree with markers around every dynamic part, `hydrate` claims the server's nodes in place at insert time; user code runs from a queue per root | 077, 078 |
| A component's hooks | `(props, cleanup, mounted, pending)`; `pending` is what `render` waits for; the context is one opaque value threaded through `mount` and never read by the binding | 079, 080 |
| The binding's corpus | Every requirement lands but the cases only a compile step can meet and the build-only internals, which have nothing here to apply to | 083 |

---

## `testing` is a shipped package, not a folder

Test discipline decays at the layer boundary where the person who set it stops being the
primary author. A convention will not prevent that. A dependency will.

`@aweftjs/testing` exports today:

- the **conformance runner** for `spec/fixtures`, so any implementation of the format proves
  it rather than claiming it, together with the **document model** it checks against, which is
  a second reading of the format written from the prose rather than from the implementation
- the **boundary checker**, which decides whether an import edge is legal and is run over the
  real import graph by the root gate
- the **seeded generator** for property tests, so a failure prints a seed that reproduces it,
  and one implementation of it rather than one per suite
- the **driver conformance suite**, so a new `store` driver is correct by passing it rather
  than by inspection. Its load-bearing check runs writers concurrently against slots that do
  not overlap and asserts every one survives, because a suite that tests two writers
  sequentially on one field encodes the lost update as the specification
- the **module harness** (`loadModule`), so an application tests its own modules with the
  tools the stack tests itself with
- the **room escape suite** (`roomChecks`), so a `sandbox` runner proves the window holds
  behind it
- the **listener conformance suite** (`listenerChecks`), so a `server` listener written for
  another runtime is correct by passing it
- the **recording host** (`recordingDocument`), a light document from `dom` that writes down
  every node operation, so a test asserts what a mount did and not only what the tree looks
  like after. It is the DOM mock: nothing pulls in a browser emulation

It grows these as the packages that need them arrive.

One test runner and one assertion library everywhere. Gates are the conformance suite,
per-package branch coverage, and a rule that a package publishes only if a harness exercises
its public exports. There is no test-line-count measure of any kind, and it is banned rather
than merely absent: it measures padding, not proof.

---

## `spec/` is not code

`spec/` holds the normative format, the identity scheme, and JSON conformance fixtures. No
JavaScript.

A format that exists only as one function's behavior cannot be implemented in a second
language, because there is nothing to implement against. Fixtures are what keeps that door
open, and they only cost something while there is one implementation to generate them from.
Retrofitting them later is the expensive version.

---

## Routing

Routing is not its own package. It ships as `@aweftjs/dom/router`, a subpath export, because
history is a browser API and `dom` is the browser package. A subpath tree-shakes to nothing
for an application that never routes.

Two concerns stay separate inside `ui`: a component that renders content, and a context
component that wires browser history to it. Mixing them produces a component that does
template selection, URL routing, static-generation guards and child coordination at once,
which is a file nobody can change safely.

**The principle that matters more than the packaging:** routes are declarable as data,
separately from the components that render them. Some routes are data dependent and can only
be known by running the application, so static generation must be able to walk what it can
and render what it must.

---

## How a future package fits

A new package declares its tier. The tier tells it what it may import. That is the whole
onboarding rule.

| Future package | Tier | Why |
|---|---|---|
| `auth` | integrator | Sessions and identity are state, but a vertical slice crosses both planes |
| `files` | split | A `store` driver plus a `ui` component. Two packages, because of the plane rule |
| `agent` | above `schema` | A language model writes state, and `schema` is what keeps the document well formed while it does |
| `crdt` | data plane, beside `sync` | An alternative merge strategy behind the same commit interface |
| `native` | client plane, beside `dom` | A different render target, parallel to the DOM binding |

The agentic goal is not a package. It is what `core`, `schema`, `store` and `sandbox` are
for. `schema` keeps what an agent writes well formed, and what an agent may write at all is
the application's rule, checked where the application chooses.

---

## Proof programs

Every package ships a proof program in `examples/<package>/`, and `AGENTS.md` holds the rule
about what a proof is. This is what each one has to demonstrate.

| Package | The proof must demonstrate |
|---|---|
| codec | a stored commit log validates: every frame re-encodes to the bytes it was read from, and every single byte of damage to it is either refused or accepted as the one spelling of what it decoded to |
| core | a headless app model with cross-field invariants: mutation bursts, commit atomicity observed through watch, undo and redo by commit inversion |
| schema | a real document under a guard: the good change applied, the bad local write thrown and rolled back, the bad arriving commit refused before anything lands, a subtree checked at the path it lands on, and `check` used alone at a boundary |
| sync | two live documents over a real channel converge under concurrent edits; the same protocol runs over a second channel unchanged; a conflict is left swapped and then resolved by a handler that yields; a chain of three converges; a document shared over a link and persisted by a store at once |
| store | write, kill the process, reopen, verify; find-or-create under concurrent open |
| modules | an app assembled from all three sources (a directory, a bundle map, a document), with dependency order and injection asserted; a module document shared over a link loads on the far end; `follow` reloads a changed module and its dependents; `unload` calls `stop`; nothing inside the package touches store or sync |
| sandbox | a hostile module runs the escape suite and stays contained, while a benign module does real work through granted capabilities |
| dom | mount and hydrate a page with a dynamic list; edits assert exact DOM operations against the mock |
| ui | an interactive page composed from components, driven and asserted against the mock (plus a manual browser page, outside CI) |
| icons | a page rendering through the driver interface with the iconify driver |
| server | a full-stack app: an authenticated connection syncs state through the application's rules to store and back; an anonymous one reaches only what the gate allows; `gate: open` reaches everything; a gate with no session in it works in its place |
| auth | inside the server proof: sign up over HTTP, connect with the cookie, the state document shared and persisted, sign out and the old cookie is anonymous |
| jobs | a scheduled job runs, persists an effect, and survives a restart |
| ssg | a real multi-page site generates, serves, and hydrates without wiping the DOM |
| build | the transforms build a real example app; assert stripping is verified in the output |
| testing | consumed by every other package's suite; its proof is everyone else's |

---

## Build order

Do not start a phase until the previous phase's packages are foundational-complete, as
defined in `AGENTS.md`.

1. `spec` + `codec` + `testing`. Nothing else compiles without these, and the fixture suite
   has to exist before there is a second consumer of the format.
2. `core`.
3. `schema`. The shape a document must keep, checked before a commit lands.
4. `store` + `sync`.
5. `modules`.
5b. `sandbox` (design 070).
6. `dom` + `build`, with hydration and route data designed in rather than bolted on.
7. `ui`, `icons`, `ssg`.
8. `server`, `jobs`, the batteries. **`server` and the `auth` battery were built 2026-09-04,
   ahead of 6 and 7, after a phase-boundary re-read over the eight packages then built**
  ; `jobs` followed on 2026-09-04. The other batteries wait their turn here.

---

## Naming and API conventions

Conventional names are what humans and agents already have models for. Rename nothing that a
neighbouring library already names well; name distinctively only where the conventional word
is wrong or missing.

**Standard vocabulary, kept:** `Observer`, `mount`, `.watch`, `.effect`, `.map`.

**Deliberate choices:**

| Name | Why this word |
|---|---|
| `scope` | What it does is narrow which parts of a tree a listener sees. `.path()`, `.ignore()` and `.shallow()` read as scope builders. The nearest neighbours in other libraries are selector and lens |
| `add` / `replace` / `remove` | The same three words as JSON Patch. The format is specified for cross-language use, so an implementer reading `replace` already knows the semantics |
| `watch` delivers commits | The safe thing is the default. A subscription that hands out mid-transaction state should have to be asked for by name. `dom`'s `watch(value, fn)` keeps the rule: it is `effect` over a value that may or may not be reactive, and a cell's `watch` delivers that cell's changes |
| `replica` | Replication topology and delta replay are one concern with one name |

**Two underscore conventions, and they are never conflated.** A leading underscore is a
*behavioral* rule: runtime-private from wildcard observers. A trailing underscore is a
*build* rule: an internal surface that release builds mangle. Both are documented at their
definition sites. An internal surface another package legitimately needs goes behind an
exported symbol or a documented subpath export, never a naming convention.

---

## Modules as documents

The most important capability in the stack: **a module stored as data, transmitted, compiled,
and run.** This is the primitive that lets a program write a program, and later, with
`sandbox`, run it safely.

A module document is an ordinary document. Everything that already works for a document works
for a module, and `modules` does nothing to make that so:

- **Stored** by opening the document through `store`. `modules` never sees a store.
- **Sent** by sharing the document over a link. `modules` never sees a link.
- **Versioned** by the document's commit history, which `store` keeps and `truncate` bounds;
  undo is core's inverse. `modules` adds nothing and requires nothing of the history.
- **Run** by handing the document to a loader as one of its sources. The loader reads each
  entry's `source`, turns it into exports through `compile`, and instantiates it through the
  same graph a module from a directory goes through (design 062).

What `modules` does not decide: which modules load, when, how many, for how long, in which
process, or at what rate; and who may read, write, load or run one. Those are the
application's, above the library, and a loader is an instance so an application makes as many
as its tenancy needs (design 063, 064).

**Isolation is a separate package.** `sandbox` runs a loader on the far end of a link inside a
room a runner made, and `modules` needed no change for it (design 066 to 070). `modules`
still claims no isolation and says so: loading a module runs its code. The room's window is
the sandbox package's; the wall around the room is the operator's.

---

## Default modules, the batteries

A full stack application should not start from nothing. The stack ships default module areas:
`auth`, `email`, `files`, `geo`, `moderation`, `notifications`, `posts`, `state`, `static`,
`uploads`, `users`.

The loader gives an application's own directory precedence over the library's, so an
application overrides a default module by writing one with the same name, configures one
without forking, and disables one outright.

A default area is a **vertical slice**: server modules, client components, and a schema. That
crosses the plane boundary, so these are integrators, not members of either plane.

```
@aweftjs/auth        server modules + client views + schema
@aweftjs/files       upload and serve + components + a storage driver
@aweftjs/email       providers and templates
@aweftjs/users       profiles and validation
@aweftjs/posts       the generic content module
@aweftjs/geo         geocoding and map components
@aweftjs/moderation  image and text moderation
```

`aweft`, the meta-package, bundles the common set, so `npm i aweft` gets auth, users, email
and files working. `auth`'s server half is built (design 074); its client views wait for
the client runtime.

They split per area rather than shipping as one package because an application that wants
auth and not posts should not carry posts, and an agent reading `@aweftjs/auth` should find
only auth.

---

## Module history is the document's history

A module document's source is a slot, so every edit is a commit, and the commit tail `store`
keeps is the version history: undo by inversion, any earlier version by replay, replication of
the history over the same protocol, with no machinery in `modules` (design 064).

Two things that follow:

1. **How much history to keep is the application's policy**, set with `truncate` on the
   document, the same as for any document. Nothing in `modules` discards a version or refuses
   a write because a history grew. An application that wants versions readable as data rather
   than by replay keeps them as state in the module document, which is its shape to choose.
2. **Granularity.** Agents rewrite whole files, so whole-source commits match the real edit
   pattern. Do not reach for a structured source tree to get finer deltas.

---

## Rendering, hydration and SEO

Later phases, but they constrain `dom` from the start, so they are recorded now.

The goal is server and build-time rendering inside a single-page model: a page renders on a
server at request time, or is baked at build time, or runs purely in the browser, from one
source.

Constraints on `dom`, holding from the phase it is built in:

- static render, hydration and normal mounting are **one code path with a mode**, not three
  implementations that drift
- rendering must work with no DOM present
- the same component source runs in all three modes
- there is an async settling primitive, because generation must wait for content before
  serializing
- server-rendered nodes are **adopted in place**. An application that wipes the DOM and
  remounts has a visible flash, and hydration is what removes it

**The head system is part of the rendering design**, not components that happen to write
tags. Two requirements fall out of that:

- **No module-level singleton state.** A head registry at module scope is correct in a browser
  with one document and a correctness bug on a server rendering several pages at once. It
  becomes per-render context.
- **Output snapshot tests.** The whole job of a head component is producing correct output for
  crawlers, and the failure is silent: the page looks fine and the tag is wrong. Render a
  page, assert on the emitted markup.

---

## Contexts

Contexts maintain a real tree: a node knows its parent and its live children. Anything that
needs the shape of that tree must be able to ask for it, rather than rebuild it from
something else.

Three requirements:

1. **Introspection.** A supported way to enumerate nodes, walk from a node to its parent or
   children, and read a node's resolved value from outside a consumer. Static generation needs
   it today, developer tools need it later.
2. **Stable identity.** Context state that is valid only for one mount cycle cannot be
   indexed. A node needs a key that survives a remount.
3. **Per-render registries.** A registry at module scope is the same singleton bug as the
   head system, and it fails the moment two renders share a process.

Sequence this with the rendering work. Server rendering forces the registry question anyway,
and the two fixes overlap.

---

## One transform, two modes

`@aweftjs/build` exposes one transform implementation with two entry points:

- **build mode**, a bundler plugin, the normal path for application code
- **runtime mode**, callable in a browser, for compiling source that did not exist at build
  time

One implementation, shared conformance tests proving both modes produce identical output for
identical input. That equality is testable and is a fixture suite, not an assumption.

**Why it is not optional.** If the transform that *validates* stored module source differs
from the transform that *executes* it, then a module validates, is stored, and breaks at
render. Three consumers need the runtime mode: validating serialized modules before storage,
compiling inside the sandbox, and the playground in the documentation site.

The build-mode half stays development-only, so a browser bundle carries a parser only when a
page actually compiles code.

---

## Proving the stack works

Three tiers, because each catches failures the others structurally cannot.

**Tier 1, per-package proof programs.** A small real program per package, public exports only,
running in the root gate and asserting its own outcome. Catches a broken API. The table of what each must
demonstrate is in `AGENTS.md`.

**Tier 2, one integration app: the documentation site and playground.** Catches two packages
disagreeing, and catches a design being unpleasant to use, neither of which a per-package test
can see. It is chosen because it is genuinely needed, so it gets used rather than built
lazily, and because it exercises the hardest surfaces: static generation, routing, head
output, components, persistence for saved snippets, and sandboxed execution of visitor-written
code.

**Tier 3, real applications**, ordered by what each exercises rather than by size, so a
failure lands somewhere recoverable.

| Application | What it proves |
|---|---|
| A small static site | static generation, head and SEO, hydration, routing |
| A second static site | the same surfaces again, confirming the first was not a fluke |
| A content site with a backend | server modules, scheduled jobs, a data pipeline, database access |
| A live collaborative app | sync under load, agent-written modules, the sandbox, high-rate mutation |
| A multi-tenant platform | serialized modules, capability grants, resident processes, isolation |

---

## Publishing

- **`aweft`**: the unscoped meta-package, batteries included. What someone installs to get
  the whole stack.
- **`@aweftjs/*`**: the individual packages.
- Site: `aweft.dev`.

All packages version in lockstep.

---
