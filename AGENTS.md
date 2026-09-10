# AGENTS

Rules for anyone, person or agent, working with this repo. Two readers, two halves. The first
half is for building an application with the stack; the second is for changing the stack. Read
the half you are in and stop there. This file is rules and invariants, not the architecture
textbook: read code for specifics and `docs/` for design.

## Building with aweft

Start with the root `README.md`, then `recipes/README.md` for whole programs by the task you
have, then the README of each package you touch, which says what it does and what it will not
do for you. `recipes/full-stack/` is the scaffold: a page and a server in one directory, with
the application's own manifest and `tsconfig` shape in its README. Do not read a package's
source to learn its rules. If a README did not tell you, that is a defect in the README, and
saying so is worth more than the workaround.

### Three ideas underneath everything

- **The document is the API.** State is an observable document. Assign to it, and the change
  is a commit that the page renders, the peer receives and the store keeps. A server module
  shares a document by name; a page shares the same name and holds the same object. There is
  no request for reading state and no event for its change: `observer(doc).path('x').watch()`.
- **Cells against documents.** A cell, `mutable(0)`, is one value a component follows: a count,
  a flag, a draft. A document is the state another end cares about. A page has both, and a
  cell is what a `ui` prop takes.
- **A refusal carries its fix.** Every error the stack raises has a `reason` to switch on and a
  `fix` that says what to do. Read the fix before anything else; it is usually the whole
  answer. `packages/<name>/errors.txt` lists every reason a package can refuse with.

### Five rules an application trips on

1. **Theme segments are a list, not an underscore string.** `theme={['button', 'quiet']}`
   reaches `button` and `button_quiet`; `theme="button_quiet"` is one token naming the variant
   alone, so the element gets the variant's colours and none of `button`'s box.
   `packages/ui/README.md`, The theme; `recipes/ui/`.
2. **`each` builds one shape per list.** A row component renders the same tags in the same
   order on every row. A button on some rows and nothing on others is wrong silently; vary a
   value, not the shape. `packages/dom/README.md`; `recipes/todo-list/`.
3. **The root entry paints nothing.** Your page entry sets `background`, `color` and a
   `minHeight` of the viewport, and the page's HTML carries `<style>body { margin: 0 }</style>`,
   because a theme entry cannot reach `body`. `packages/ui/README.md`, The look;
   `recipes/full-stack/page/`.
4. **The Node loader resolves from the working directory and reads `AWEFT_DEFAULT_H`.** Run
   `node --import @aweftjs/build/loader main.ts` from the application root. A `.tsx` file
   that imports no `h` of its own is given `dom`'s unless `AWEFT_DEFAULT_H=@aweftjs/ui` is
   set, and that value has to be the `defaultH` the vite config passes, or a page rendered on
   the server and bundled for the browser will not hydrate. `packages/build/README.md`;
   `recipes/ssg/`.
5. **A page reaches a backend in development through a same-origin proxy.** The cookie belongs
   to the page's origin, so the dev server proxies the auth routes and a socket path of its own
   (`/ws`, with `ws: true`) to the backend, and the page names that path in
   `createClient({ url })`. A proxy entry for `/` takes the dev server's own socket with it.
   `recipes/full-stack/`.

### The loop for a page

1. Scaffold from `recipes/full-stack/`.
2. Write the server's modules and the page. What a module may return is
   `packages/modules/README.md`, and the hooks a server module gets (`connection`, `call`,
   `routes`, `public`) are `packages/server/README.md`. Public exports only: a deep import into
   a package fails at import time by design, and needing one is a finding to report, not a
   thing to work around.
3. Before saying it is done, drive the page in a real browser: every state reachable by
   keyboard, both modes, no page error and nothing written to the console at error level.
   `recipes/full-stack/main.ts` shows the two listeners and `recipes/ui/main.ts` the walk.
   Tests for an application are `node --test` files run under the loader.
4. A stack bug found while building gets its test in the stack's package, in this repo, and
   the fix goes upstream; the application never carries a patched copy. The rest of this file
   says how.

## Changing aweft

Everything below is for a change to the stack itself.

### WHERE TO READ WHAT

- `boundaries.json`: the tier and plane table, and per package the list of packages it may
  import. `packages/testing/src/boundaries.ts` is the check that enforces both, and it has
  its own tests.
- `spec/`: the normative wire format and its conformance fixtures. `spec/CHANGELOG.md` is
  append-only.
- `docs/architecture.md`: the plan, stated on aweft's own terms.
- `docs/design/`: one file per design decision, `NNN-short-name.md`. What was decided,
  why, what it costs, and what evidence would reverse it. A superseded note stays and says
  what superseded it.
- `packages/<name>/README.md`: what the package is for and what it will not do for you.
  Beside it, `surface.txt` is the generated public surface and `errors.txt` the generated
  refusal vocabulary; both are checked in the gate.
- `recipes/`: everything that works, as programs the gate runs.
- `bench/`: the scripts behind every performance claim.

### THE GOVERNING RULE

This problem domain has decades of prior art and a great deal of it is subtle. Assume a
behavior that looks odd has a reason behind it until you have found that reason. Any
change to a key concept (the list is in `docs/architecture.md`) gets a design note in
`docs/design/` BEFORE it is built. No note, no change.

An experiment that shows a proposed improvement is unnecessary is a good result. The plan
loses a change it did not need, and unnecessary changes are how foundations acquire bugs.

### DECISION HIERARCHY

1. System invariants
2. Architecture coherence
3. Module clarity
4. Style rules
5. Local convenience
6. Micro-optimizations

If a change violates a higher tier, it is wrong even if it works.

### THE LOOP FOR A CHANGE

Start, in order:

1. Read this file.
2. Read the `docs/architecture.md` sections and the `docs/design/` notes for the packages
   the change will touch.
3. Confirm a clean tree on the default branch (`git status`). If it is dirty, stop and
   ask.
4. State the goal in one line before editing anything.
5. List the design calls the change expects to make, each marked as yours or the
   maintainer's with the two tests in DECIDING applied. A design call is a change to a key
   concept, to the wire, or a concept the library grows that the application did not have
   to give it. The maintainer's are asked, as two or three concrete options with the code
   shape each produces, before any code is written. A call found mid-way stops and is
   asked then. What a package exports is not a design call: it goes through the two tests
   like everything else and is written down, not asked.

During:

- Hit a fork in the design? Settle it and write the design note (see DECIDING, AND WHEN TO
  STOP). Escalate only what that section says to escalate.
- Changing a key concept? Write the design note first.
- Proceeding on an assumption to stay unblocked? State it in one line, up front.

End, in order:

1. Run the root gate: `npm test` at the repo root (typecheck, dependency rules, the public
   surface files, the refusal vocabulary, the theme contract, every package's tests with
   coverage, fixtures, recipes). Report the command and its output; never claim a result
   from a run you did not do.
2. If green, commit only with the maintainer's approval, and put in front of them what the
   review needs: the diff of every `surface.txt` that changed, the gate command and its exit
   code, and the proposed commits as titles.

   **Commit standard.** One logical change per commit; a title needing "and" is two
   commits. Title in the imperative, 72 characters or fewer, no trailing period. Blank
   line. Body wrapped at 80, saying what changed and why, not how. Cite design note ids
   where a commit implements one. No attribution trailers of any kind. A commit that only
   reformats or only renames says so in its title and contains nothing else, so it can be
   skipped during review.
3. A blocked or red change is reported as blocked, with the exact failing command.

### DEFINITION OF DONE FOR A PACKAGE

A package is foundational-complete only when all of the following hold:

1. Its public API is fully typed and reachable only through its `exports` map. Every
   public export carries a block comment (Params, Returns, Examples), attached to the
   symbol a caller reaches for: a block comment on the interface a function returns does
   not reach an editor hovering the function. The package has a README that shows the job
   it is for, because item 8 has nothing to run on without one.
2. The root gate is green, including the package's branch coverage threshold.
3. Every public export is exercised by the package's own suite, and every export a
   `@aweftjs/testing` harness covers goes through that harness rather than around it.
   The harness is the discipline where one exists; it is not a reason to invent harness
   surface whose only consumer is this rule.
4. If it touches the wire format (core, sync, store), it passes the `spec/fixtures`
   conformance suite.
5. Its share of the behavioral corpus is landed and passes (see TEST POLICY). A case lands
   stated as a requirement on aweft, and a case that is deliberately left out needs a design
   note saying why.
6. Its recipe exists, runs in the root gate, and asserts its own outcome. What each
   package's recipe must demonstrate is the table in `docs/architecture.md`, under
   "Recipes" (design 105).
7. Every changed key concept has its design note. None pending.
8. A reader who has only the docs has built something real against the package: someone
   who has not read the source, using its README, its block comments and its types, and
   nothing else. What they get stuck on is the finding, and behavior they discover by
   crashing into it is a documentation defect however correct the behavior is. A reviewer
   who reads the source cannot produce this, because reading it stops them needing the
   docs.

   Give them the editor's view, not the repository. Emit declarations, which carry the
   block comments and drop every function body:

   ```
   npx tsc packages/<pkg>/src/index.ts --declaration --emitDeclarationOnly \
     --outDir <scratch>/api/<pkg> --target es2023 --module nodenext \
     --moduleResolution nodenext --allowImportingTsExtensions --strict \
     --skipLibCheck --rewriteRelativeImportExtensions
   ```

   Hand over that directory and the README, put `packages/` and `recipes/` out of
   bounds, and give them a job the package is for rather than a tour of its exports. They
   need somewhere inside the repo to run from, because a workspace import does not resolve
   outside it. Verify each finding at the source before acting on it: they are reporting
   what happened to them, which is evidence, not a diagnosis.
9. A review by someone who wrote none of the package's code has passed, against the
   judgment list in ARCHITECTURAL COORDINATION, and the maintainer has signed it off.
   Fresh context reviews without the author's blind spots. The first item on that list is
   whether the package's surface does the job its design notes describe and nothing beside
   it; approval of the quality is not approval of the shape.

Do not start the next build-order phase (`docs/architecture.md`, Build order) until the
current phase's packages are foundational-complete. Foundation time is spent here, at
these gates, not on a calendar.

#### Recipes

Everything that works lives in `recipes/` (design 105). A recipe is a small real program
that does a job someone would actually have. It consumes public exports only, runs headless
in the root gate, and exits nonzero when its assertions fail. A recipe that restates a unit
test does not count. Friction found while writing one is fixed in the package or escalated;
a recipe never absorbs a workaround.

Recipes are indexed two ways and the second is the point.

- **One per package.** It demonstrates the hardest thing that package does, and it answers
  "does this still work". The table is in `docs/architecture.md`.
- **One per task**, which no per-package program could be. A todo list, two clients
  converging, an optimistic write the server refuses. It answers "how do I do this", which
  is the question a reader actually arrives with, and it crosses whichever packages the task
  crosses.

An **integration recipe** is a task recipe that deliberately spans packages. Those are what
catch two packages disagreeing and a design being unpleasant to use, neither of which a
per-package program can see. The documentation site is not in this repo and is not what
proves the stack; recipes are.

This is the operational meaning of "proven": for every capability that matters, the gate
runs a check that fails when the capability regresses. A recipe that goes stale turns the
build red, which is both the enforcement and the maintenance.

Real applications are the last tier of proof and come later, ordered by what each one
exercises rather than by size. That order is in `docs/architecture.md`.

### TEST POLICY

Banned: any test-line-count or test-to-source-ratio measure, in the gate or in review. It
measures padding, not proof. Do not reintroduce it in any form.

One runner and one assertion library everywhere: `node --test` with
`node:assert/strict`. (Zero dependencies in the test path matches a zero-dependency
core.) The root gate fails if any package declares a dependency outside the allowlist,
checked by `packages/testing/scripts/check-dependencies.ts`, which is also where the
allowlist lives.

What must exist:

- **Branch coverage thresholds**, per package: core, schema, sync, store, modules,
  sandbox, dom at 90; ui, icons, client, server, auth, jobs, ssg, static, build, testing at
  80. Each package declares its number as `aweft.branchCoverage` in its `package.json`, and
  `packages/testing/scripts/run-tests.ts` runs every package's tests in a coverage pass
  scoped to that package's own sources, failing below the declared number. Line coverage
  is not gated. Thresholds only ratchet upward; lowering one needs a design note.
- **Conformance fixtures**: `spec/fixtures` is the normative suite for the wire format.
  The gate's conformance suite fails on any byte a regeneration would change. Changing a
  fixture requires a `spec/CHANGELOG.md` entry.
- **Adversarial and property tests**, on the surfaces where they pay: serialization
  round trips over seeded random trees; commit coalescing (the coalesced result applied
  to a copy must equal the uncoalesced sequence applied in order); array identity
  operations; schema bypass attempts; the sandbox escape suite, which is append-only
  and gains a permanent case for every escape ever found. `@aweftjs/testing` exports the
  seeded generator (`randomFrom`, `randomBelow`) and every property test draws from it, so a
  failure prints its seed and the run repeats exactly; the failing seed is committed as a
  named regression case. One implementation, not one per suite: copies drift, and a seed
  that reproduces a failure under one copy reproduces nothing under another. No external
  property-test framework.
- **The behavioral corpus**: a curated set of hard-won edge cases this problem domain is
  known to contain, filed per package as `tests/behavior.*.test.ts`, each stated as a
  requirement aweft must meet. The corpus is append-only; removing a case requires a
  design note, because each one is there for a reason someone paid for.
- White-box tests are allowed but named `internal.*.test.ts` and do not count toward
  the public-export gate. Every other test imports through public exports.

Rules of evidence:

- A test that cannot fail is a defect. Assertions are mandatory.
- A test that waits forever is a red test, not a stuck gate: `run-tests.ts` caps every test
  at 120 seconds.
- **A stated guarantee lands with the check that fails when it stops holding, demonstrated
  red at least once.** This binds anywhere the project speaks with authority: this file, a
  design note, `spec/`, a README, a block comment. Write that something holds and the check
  goes in the same change. A guarantee without its red demonstration is a defect, the same
  as a test that cannot fail.
- **A check may not take its expected value from the thing it checks.** An expected value
  comes from the specification, from a derivation done by hand, or from a second
  implementation. Never from the implementation under test. A fixture whose bytes are the
  encoder's own output compares that encoder against its own past behavior and cannot see
  it disagree with the format. The same mistake wears other clothes: a field name that
  records what the code does rather than what the spec says, and an assertion carrying a
  reason that is false. When a test states why, the why is part of what is being asserted.
- Coverage says a line ran, not that a behavior is pinned. To find out whether a guarantee
  is checked, delete the code that implements it and watch for red.
- A README or doc may not claim a capability that no check backs.
- **A claim about tooling names the check.** "Enforced in CI" is not checkable; the rule,
  the file it lives in, and the command that runs it are.
- Performance claims cite a committed benchmark script and its recorded numbers. The gate
  does not gate on performance.

### ARCHITECTURAL COORDINATION

The machine enforces, on every run of the root gate (`npm test`; there is no remote and no
CI, the gate is the machine):

- **The tier rule**: a package imports from its own tier or below, never upward, never
  across the client/server plane, with exactly the two named exceptions in
  `docs/architecture.md`. Checked by `checkGraph` in `packages/testing/src/boundaries.ts`,
  run over the real import graph by `packages/testing/scripts/check-boundaries.ts` in the
  root gate. Test and script code is outside the graph: it is not shipped, so importing
  the harness from a suite creates no runtime dependency. dependency-cruiser is a separate
  check and covers cycles, orphans and deep package imports, not tiers.
- **Reachability**: every package declares an `exports` map, so a deep import into
  another package's internals fails at import time. Needing an unexported internal is
  an escalation, never a deep import. Every layering violation this rule exists to stop
  began as one reach into a neighbour's internals that worked.
- **One toolchain**: per-package tsconfigs extend the root base (`erasableSyntaxOnly`,
  `verbatimModuleSyntax`), the dependency allowlist scan
  (`packages/testing/scripts/check-dependencies.ts`) passes, and only the one test runner
  exists.
- **Coverage thresholds and fixtures**, per TEST POLICY.
- **The import allowlist**: `boundaries.json` lists, per package, the packages it may
  import. It encodes the "must not know about" column of the ownership table, and
  `checkGraph` refuses an edge the list does not name, so a package cannot come to know
  about a neighbour by importing it.
- **The public surface**: `packages/testing/scripts/check-surface.ts` regenerates
  `packages/<pkg>/surface.txt` from each package's exports and fails on any difference. A
  surface change is therefore a diff in the commit the maintainer approves; that diff and
  the design note are the review. `npm run surface` rewrites the files.
- **The refusal vocabulary**: `packages/testing/scripts/check-errors.ts` regenerates
  `packages/<pkg>/errors.txt`, every reason a package can refuse with and the fix it
  offers, and fails on a refusal with no fix or one built at run time (design 101).
- **The theme contract**: `packages/testing/scripts/check-theme.ts` reads `ui`'s components
  and the recipes for a value written where it stands rather than named (design 119).
- **The words**: `packages/testing/scripts/check-words.ts` reads every tracked file for
  the vocabulary of how the stack was built rather than what it is (who decided a thing,
  when, through which review) and names what to write instead. `npm run words` runs it, and
  the root gate runs it first.

#### Optional external dependencies

The rule for anything the stack can use but must not require: a store driver, an email
provider, file storage, an icon set (design 140).

- The adapter is a **subpath on the package that owns the area**, never a package of its
  own. `@aweftjs/icons/node` reads an installed icon set.
- The third-party package is an **optional peer**: in `peerDependencies`, with
  `peerDependenciesMeta[name].optional` set to true. Never a dependency.
- The subpath reaches the peer **only when it is called**, through a dynamic `import()` or
  a resolve from the directory that asked, and **refuses when it is not there**, in the
  stack's refusal shape. `check-errors.ts` refuses a fix built at run time, so the install
  command goes in the detail and the fix is the sentence that is true of every case.
- The **root entry never touches it**. Importing the package loads no adapter and no peer.
- **Types come from a types-only package or an ambient declaration**, never from
  installing the peer to get its declarations.
- The gate's allowlist **reads peers**, requires every third-party peer to be optional, and
  names each one; a family is one pattern, such as `@iconify-json/*`. The check is
  `checkManifests` in `packages/testing/src/manifests.ts`, with the allowlist in
  `packages/testing/scripts/check-dependencies.ts`, run by `npm run dependencies`.
- Each **real subpath on the exports map** is in `surface.txt`, and the package's suite
  proves the refusal. A subpath the build generates rather than ships
  (`@aweftjs/icons/<set>/<name>`) is on no exports map and so in no surface file; it is
  written down in the owning package's README and in its design note.

Judgment enforces, in review, what the machine cannot:

- **Surface matches the job.** The package's exports do what its design notes describe and
  nothing beside it, and the concepts it introduces are ones the maintainer answered for.
  An export the job did not need is a finding, however good it is.
- Naming: the table in `docs/architecture.md` is canonical (`scope`;
  `add`/`replace`/`remove`; `watch` delivers commits). No synonym drift between
  packages.
- The "must not know about" column of the package ownership table, checked against
  actual imports and actual semantics.
- API conventions: registering a listener returns its unsubscribe function; userspace
  calls are deferred, never made mid-walk; footguns assert loudly; observer chains stay
  lazy and immutable.
- One way per job: no second API that overlaps an existing one.
- Test honesty spot check: pick two or three tests, break the code they cover, confirm
  they fail.
- Claims: sample the package README against what the gate actually checks.

Review cadence, tied to milestones, not the calendar:

1. **Every change**: the gate (THE LOOP FOR A CHANGE).
2. **Package completion**: the review by someone who wrote none of it (DEFINITION OF DONE,
   item 9).
3. **Phase boundary**: before a new build-order phase starts, one pass re-reads all
   public APIs built so far, together, against the judgment list above. Drift is fixed
   before new code is written.

### CODING STANDARDS

Decided:

- **TypeScript everywhere**, run natively by Node (type stripping). The root tsconfig
  sets `erasableSyntaxOnly` and `verbatimModuleSyntax`; therefore no `enum`, no
  namespaces with runtime code, no parameter properties, no decorators. Public
  signatures are fully typed; prefer `unknown` to `any` in public API.
- ESM only. One concept per file, named after the concept; the entry file is pure
  re-export. Internal imports name the exact file with its extension.
- Tabs. Single quotes. Semicolons. Same-line braces. Arrow functions unless `this` is
  needed.
- Registering a listener returns its unsubscribe function, universally.
- Observers are lazy immutable chains; new combinators follow the `createImpl` pattern;
  factories, not `class`. The one exception is the chain step itself (`Chain` and `Scope`,
  design 154): its combinators sit on a prototype, because a closure bag per step was the
  largest single allocation site on a ten thousand row page. A factory still builds them
  and neither class is exported.
- Defer userspace calls: internal traversals never call user code mid-walk, because
  user code can mutate the structure being walked. Queue and drain at a safe point.
  This is a correctness invariant, not style.
- `assert()` throws in dev and compiles out in production. Footguns are loud asserts,
  not silent coercion. Dev-only bookkeeping hides inside assert side effects.
- Cross-cutting hooks are exported Symbols probed optionally, not magic string keys.
- Naming: `camelCase` functions and variables, `PascalCase` observables and components,
  `createX` factories. Short locals are fine in hot inner loops.
- Comments explain why, not what. Public API gets block comments with Params, Returns,
  Examples. No em dashes anywhere: not in comments, docs, commit messages, or UI text.
- **Terse helper aliases are dropped** (design 019). Write `x.length`, `a.push(b)`,
  `a instanceof B`.
- **Trailing-underscore properties are kept**, and mangled in release builds (design 020).
- **Two underscore meanings, and they must never be conflated**: leading `_foo` is a
  *behavioral* rule, runtime-private from wildcard observers. Trailing `foo_` is a *build*
  rule, manglable internal surface. Document both at their definition sites. An internal
  surface another package legitimately needs goes behind an exported Symbol or a
  documented subpath export, never a naming convention.
- Intrusive linked structures are the pattern in hot paths; that choice is
  architectural, not byte-saving.

### DECIDING, AND WHEN TO STOP

Most forks in this work have a determinate answer. Find it. A fork you could have settled
with a benchmark, a fixture, or a design note already written is not an escalation, and
filing it as one spends a review and returns nothing.

Two tests decide who answers a question, and both must point at the maintainer before it
goes to them.

**Is it hard to reverse?** A choice is hard to reverse when it lands on the wire, in
`spec/`, or in stored state, so that changing it later means migrating something already
written or sent. If nothing stored or sent constrains the answer, the choice is yours,
however large it looks.

**Can evidence settle it?** Evidence is a measurement, a benchmark against a real
workload, a conformance fixture, or an existing note in `docs/design/`. Taste is not
evidence and neither is symmetry. If evidence can settle it, get the evidence rather than
arguing from either. A note settles a question only when that question is in the note's
Decision section. A premise in its prose settles nothing: one sentence that assumed a host
and a client, in a note about refusals, became the topology of a whole package that way.

**One class of choice is the maintainer's whatever the two tests say: a new concept.**
Whether the library grows a concept (an actor, a role, a host) the application did not
have to give it. That decides how much a user has to build themselves, which is the thing
being judged. Bring two or three concrete options with the code shape each produces, and
ask before the code. What a package exports and which helpers ship are not in this class:
they go through the two tests like everything else, get a design note, and show up as a
`surface.txt` diff in the commit the maintainer approves. Internals, mechanics and every
other reversible fork stay yours.

So:

- **Reversible**, whether or not evidence exists: decide it, write the design note,
  keep building.
- **Hard to reverse, evidence available**: get the evidence, decide it, and write in the
  note what would reverse it.
- **Hard to reverse, no evidence available today**: escalate.

"Two shapes are both reasonable" is not a stop condition. It is the normal state of design
work and settling it is the job. Pick the one you can defend in a design note, say
what it costs, and name the evidence that would overturn it. Writing "nothing is blocked"
or "nothing on the wire changes" in an escalation is a proof that the escalation should
have been a design note.

Deciding is not guessing. A design note states its evidence and its reversal condition,
so a decision made on thin evidence is visible as such and cheap to revisit. That is what
makes it safe to decide rather than ask.

#### Stop conditions

Any of these means stop that line of work now:

- The established design cannot meet its stated contract.
- You need API from another package that it does not export.
- You believe the dependency rule needs a new exception.
- A behavior the design calls for looks wrong and you cannot find its reason.
- A choice is hard to reverse by the test above and no evidence available today settles it.

On a stop condition:

1. Do not patch around it, do not import internals, do not add the exception yourself,
   and do not shrink the feature to dodge the question.
2. Ask the maintainer, in plain words: what you were doing, what blocked it, **why both
   tests above point at them**, naming what makes it hard to reverse and what evidence you
   looked for and could not get, then two or three options with what each costs. A
   question that cannot answer that is not ready to be asked. A question a later package
   will settle with evidence is written into the owning package's README under its known
   limits instead, with what settles it.
3. Continue unrelated work if there is any; otherwise stop.

A resolution is written down as a design note, an architecture doc edit, or a written
"no change".

### KEEPING ONE SOURCE OF TRUTH

The stack is developed in this repo, and an application that also changes it consumes it as a
git submodule pinned to this repo's default branch. That workflow upstreams by construction: a
fix made inside the submodule and pushed is upstream the moment it lands. An application that
only uses the stack installs the packages from npm, and a fix reaches it in the next release.

- **Every change to stack code is made in this repo**, whether you reached it directly or
  through an app's submodule checkout. Never patch a copy.
- **Push before you stop.** A commit sitting unpushed inside a submodule checkout is the
  one way this workflow strands work.
- **No divergent branches.** Submodules track the default branch. A long-lived
  app-specific branch of a stack package is a fork; if one is genuinely needed, it is an
  escalation.
- **No copies.** A stack file duplicated into an app is a defect. Upstream it in the same
  change.
- **A stack bug found while working in an app** gets its regression test here, in the
  package that has the bug, not in the app.
- All packages version in lockstep, and one version number is the whole set's. `npm run
  publishing` refuses a manifest that carries a version of its own.
- **A release is `npm run build`, then the root gate, then `npm publish --workspaces`.** The
  build writes each package's `dist/`, which is compiled output nothing commits (design 256).
  A publish is the one action here that cannot be taken back, so nothing goes out on a red gate.

**Before drawing any conclusion from a working copy, `git fetch` first.** A stale checkout
reads as a systemic problem when it is a local one. A directory is not a source of truth; a
remote is.

### ANTI-PATTERNS

- Filler tests written to satisfy a metric. There is no line-count metric here, and a
  test that cannot fail is a defect.
- Patching around a design problem instead of stopping (DECIDING, AND WHEN TO STOP).
- Deep-importing another package's internals, or copying a stack file into an app.
- A second test framework, assertion style, DOM mock, or overlapping API.
- Reporting success without the command and output that prove it.
- A change to a key concept built before its design note is written.
- Escalating a reversible choice, or one an available measurement would have settled.
- Settling a design call on the maintainer's behalf, then reporting it to them as a
  technicality.
- Writing how the stack was built into the files that say what it is: who decided, when,
  which review found it. `npm run words` names the sentence.
