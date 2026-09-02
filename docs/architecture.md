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
                                   CONTRACTS
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
    schema/                commit validation and mutation authority
    sync/                  commit replication over any channel
    store/                 persistence and its driver interface
    modules/               the isomorphic module system, static and dynamic
    sandbox/               isolated execution for stored module code
    dom/                   direct DOM binding, hydration, static render
                           + dom/router subpath: history and URL to state
    ui/                    components and theming
    icons/                 icon driver interface plus one driver
    server/                http and websocket runtime, wiring modules to sync and store
    jobs/                  scheduling and queues
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
| `core` | Observers, observables, deltas, commits, scopes, identity | DOM, network, storage, schema |
| `schema` | Validating a commit, and who may mutate what | Transport, storage |
| `sync` | Moving commits between trees and over a channel | DOM, storage internals |
| `store` | Persisting commits, the driver interface | DOM, transport |
| `modules` | Discovery, dependency order, injection, lifecycle | Whether it runs on a client or a server |
| `sandbox` | Isolated execution and the capability bridge | What the code it runs is for |
| `dom` | Mounting, hydration, static render, URL and history | Storage, transport, components |
| `ui` | Components, theming | Storage, transport, server |
| `server` | HTTP and websockets, wiring modules to sync and store | Component internals |
| `jobs` | Scheduling, queues, retries | Component internals |
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

---

## Decisions already taken

Each has a record in `docs/design/`. This is the summary, not the reasoning.

### The commit is the unit that crosses every boundary

`sync` replicates commits, `store` persists commits, `schema` validates commits. A consumer
that rebuilds state by applying deltas one at a time passes through states where invariants
spanning two slots are false. Applying a whole commit does not, because every delta is
validated, then every delta is applied, then listeners are notified once.

The consequence for the API: whether a local listener sees a torn state depends on whether
the mutations were made atomically, not on which subscription it used. Two assignments in one
synchronous block outside an atomic section are two commits, and both callbacks see the
break. So the atomic primitive has to be ergonomic enough that people reach for it.

### The wire format needs no merge rules

Coalescing keyed by slot is lossless. The producer guarantees a commit is minimal, and the
format states the rules a coalescer must satisfy rather than defining an algebra for
receivers to re-derive. See `spec/format.md` section 5 and design 003.

### Identity and credentials use different doors

`core` produces object identity: cryptographically secure, no weak fallback, and no global
generator that a test can replace. `server` produces credentials, in a different module with
a different call site, so using an id as a session token is not expressible. See
`spec/identity.md` and design 005.

### One observable array, and no identity option

There is one array implementation and it has no identity mode. Every element is addressed by
an ordered position key, which does not shift when the array is edited elsewhere, so tracking
identity separately would add a second internal path and buy nothing the addressing does not
already give. See design 014.

### Cross-tree bridging is a supported seam, not a reach-in

Bridging two live trees that do not share an id space needs three things, and all three are
public API rather than something a caller improvises: applying a commit with caller-supplied
refs, an insert-at-position primitive on identity arrays, and echo suppression. Needing an
unexported internal is an escalation, never a deep import.

### `schema` is mandatory at the wire

The server side of `sync` refuses a remote commit that has no mutation authority policy, even
if that policy is an explicit allow-everything the developer had to type. An authenticated
client is not an authorized one, and making the check optional by configuration ships the
hole it exists to close. Local-only trees may skip it.

### Authority is per path, and actions are a pattern built on it

A policy is declarative patterns over paths, and that is the only authority the wire checks.
An application that wants named intents writes the intent into the document as state, and a
server-side handler with wider authority reads it and writes the outcome. Both writes pass the
same validator, so there is one enforcement mechanism rather than two. See design 009.

### One attach edge decides where an observable lives

Every reachable observable has exactly one attach edge; every other reference to it is an
alias that grants nothing and revokes nothing. This is what makes "where does this live" a
walk up rather than a search, and it makes privilege escalation and privilege freezing through
a reference unrepresentable rather than merely guarded against. See design 010 and
`spec/format.md` section 1.1.

### A refused commit converges the client, then reports

When the server refuses a commit, the client rolls back to the last accepted state and replays
what was accepted. That is the framework's job, not the application's choice, because anything
else is a replica fork. The refused commits are then handed to the application as one group,
with their reasons and prior values, after the document is consistent again.

A refusal refuses the commit and never the connection. A well-behaved client produces refusals
through ordinary races, and disconnecting turns every race into a full resynchronization at
the moment the client is busiest. See designs 011 and 012.

### A commit closes with the mutation, or with the atomic block

One mutation is one commit, and `atomic(fn)` makes everything inside it one commit. A block
that throws rolls back and emits nothing. See design 015.

### The inverse is captured where the prior value is free

Core captures prior values as it applies a change, in both directions, and every change it
delivers can build the commit that undoes it. Nothing about the wire changes. See decision
016.

### A scope is a prefix of the path a delta names

A listener narrows what it sees with `path`, `ignore` and `shallow` on an observer chain, and
a delta is in scope when the path from the observer's base to the delta starts with the
scope's keys. A scoped watcher sees the deltas in its scope, not the whole commit. See
design 017.

### Scopes and values are two surfaces of one chain

A scope is about a place in a document and its `watch` delivers commits. A derived value is
about a value: `map` and `all` produce one, its `watch` delivers the value, and both surfaces
carry the same combinators. A derived value is memoized while observed; while unobserved it
holds no subscription and its cache is trusted only while a global write clock has not moved.
Settling is two-phase, marks then one flush behind the commit's own deliveries, so a value
combining two branches never computes against half a commit. See design 023 and its dated
revision.

### Cells are state outside the document

`mutable`, `immutable`, `timer` and `fromEvent` carry the value surface with no deltas, no
commits and no place on any wire, and a cell cannot be attached into a document: the write is
refused. Which tab is open is a cell; the document is the document. Rate limiting (`throttle`,
`wait`) exists only on the value surface, so a commit stream cannot lose a commit to a
limiter by construction. See designs 024 and 026.

### A scope step can be a wildcard

`skip(count)` and `tree(key)` are steps in the ordinary scope grammar, so `path`, `ignore`
and `shallow` compose with them. A wildcard scope names many places and has no single value:
`get()` is undefined and `set()` throws. Only wildcard scopes pay for the backtracking
matcher. See design 025.

### Writing through a derived value is declared, never inferred

`map` is read-only; `setter` declares the write half; `selector` writes back by its own
meaning; `isImmutable` answers before an input renders, and immutability propagates through
derivation. One caching layer exists, at the transform, and deduplication happens there once.
See designs 027 and 028.

### A snapshot rebuilds into a document

`fromSnapshot` inverts `snapshot`: same ids, kinds, slots, positions and aliases, validated
before building. It holds what the document says, not the detached observables the original
still indexes, so replaying resurrection history is the commit log's job. See design 029.

### The delivery plumbing is not public, and there are no view-layer adapters

The listener registry, walkers and dispatch queue stay internal; the public seams are the two
surfaces and `apply`. The stack ships one view binding, `dom`. See designs 030 and 031.

### `store` is not decided

Deliberately open, pending the research that settles it. Until that lands, `store`
carries a snapshot-plus-index design with a driver interface, and the delta stream stops at
the persistence boundary. Closing that gap is the point of the research, and an append-only
log is a candidate rather than the answer.

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

It grows these as the packages that need them arrive, and this list says "today" because it
used to name all three as though they existed:

- a **driver conformance suite**, so a new `store` driver is correct by passing it rather
  than by inspection. Arrives with `store`.
- a **module harness**, so an application tests its own modules with the tools the stack
  tests itself with. Arrives with `modules`.
- a **DOM mock**, so nothing pulls in a full browser emulation. Arrives with `dom`.

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
| `agent` | above `schema` | A language model writes state, and `schema` is what makes that safe |
| `crdt` | data plane, beside `sync` | An alternative merge strategy behind the same commit interface |
| `native` | client plane, beside `dom` | A different render target, parallel to the DOM binding |

The agentic goal is not a package. It is what `core`, `schema`, `store` and `sandbox` are
for. `schema` is the piece that makes an agent a safe writer instead of a dangerous one,
which is why it sits low in the stack rather than being bolted on at the application layer.

---

## Proof programs

Every package ships a proof program in `examples/<package>/`, and `AGENTS.md` holds the rule
about what a proof is. This is what each one has to demonstrate.

| Package | The proof must demonstrate |
|---|---|
| codec | a stored commit log validates: every frame re-encodes to the bytes it was read from, and every single byte of damage to it is either refused or accepted as the one spelling of what it decoded to |
| core | a headless app model with cross-field invariants: mutation bursts, commit atomicity observed through watch, undo and redo by commit inversion |
| schema | a multi-actor scenario: the authorized commit is applied, the unauthorized one is rejected, through the real seam |
| sync | two live trees over a real channel converge under concurrent edits; the same protocol runs over a second channel (postMessage or in-process) unchanged |
| store | write, kill the process, reopen, verify; find-or-create under concurrent open |
| modules | an app assembled from modules through both loaders (filesystem and bundle map), with dependency order and injection proven |
| sandbox | a hostile module runs the escape suite and stays contained, while a benign module does real work through granted capabilities |
| dom | mount and hydrate a page with a dynamic list; edits assert exact DOM operations against the mock |
| ui | an interactive page composed from components, driven and asserted against the mock (plus a manual browser page, outside CI) |
| icons | a page rendering through the driver interface with the iconify driver |
| server | a full-stack app: an authenticated client syncs state through schema to store and back |
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
3. `schema`. The genuinely new library. Mutation authority is the piece nothing else has.
4. `store` + `sync`.
5. `modules` + `sandbox`.
6. `dom` + `build`, with hydration and route data designed in rather than bolted on.
7. `ui`, `icons`, `ssg`.
8. `server`, `jobs`, the batteries.

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
| `watch` delivers commits | The safe thing is the default. A subscription that hands out mid-transaction state should have to be asked for by name |
| `replica` | Replication topology and delta replay are one concern with one name |

**Two underscore conventions, and they are never conflated.** A leading underscore is a
*behavioral* rule: runtime-private from wildcard observers. A trailing underscore is a
*build* rule: an internal surface that release builds mangle. Both are documented at their
definition sites. An internal surface another package legitimately needs goes behind an
exported symbol or a documented subpath export, never a naming convention.

---

## Serialized modules

The most important capability in the stack: **modules stored as data, transmitted, validated,
compiled, and executed in a sandbox.** This is the primitive that lets a program write a
program and run it safely.

Architectural consequences:

- **`sync` must be channel agnostic.** The same replication protocol runs over a websocket,
  over `postMessage` to sandboxed code, and in process. Design around a channel interface,
  not around a websocket.
- **`modules` has two halves.** Static modules, imported at build time, and dynamic modules,
  stored as data with their imports derived from the source and validated by compiling before
  storage.
- **`sandbox` is its own package.** An opaque-origin frame on a client, a permission-limited
  child process on a server, both bridged by the same protocol.
- **Capability grants belong with `schema`.** "May this actor write this path" and "may this
  module reach this host" are the same authority question at different grains.

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
and files working.

They split per area rather than shipping as one package because an application that wants
auth and not posts should not carry posts, and an agent reading `@aweftjs/auth` should find
only auth.

---

## Module history rides on deltas

If a module's source lives in the state tree, every edit already produces a delta, so the
delta log is the version history. That gives full history, undo and redo by inversion, time
travel, an agent searching its own earlier attempts, and replication of history over the same
protocol, with no new machinery.

Three things to handle:

1. **Storage growth is the application's policy, not the library's.** The module system does
   not get an opinion about how much history is too much. It exposes the history and the
   tools to prune it: drop before a time, keep the last few, compact a range into a snapshot.
   It must not silently discard versions, and it must not refuse a write because a history
   got large.
2. **Metadata.** A delta carries a time and an id, not an author or an intent. The arguments
   threaded through commit application are the natural carrier for the actor.
3. **Granularity.** Agents rewrite whole files, so whole-source deltas match the real edit
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

## Gaps with no owner yet

Each needs a home before the build order past phase 4 is final.

- **Stored data migration.** `spec/CHANGELOG.md` versions the wire format. Nothing yet owns
  the evolution of data already stored, and upcasting old records is the classically hard part
  of any log-shaped design.
- **Sync conflict semantics.** A client mutating an object another client just deleted must
  have a stated outcome. Throwing wedges the connection. "An alternative merge strategy later"
  does not answer what the default does.
- **Quotas, secrets, and resident processes.** `modules` owns discovery and injection only.
  A platform running other people's code needs all three and none has an owner.
