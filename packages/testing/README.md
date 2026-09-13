# @aweftjs/testing

The checks the rest of the stack is held to: the conformance suite, a model reading of the
format to check real implementations against, the tier rule, and seeded randomness.

This package is an integrator. It sits outside the tier ordering because everything is
allowed to depend on it, and nothing it exports ships to a user of the library. It is where
a claim about the stack becomes a check that fails when the claim stops being true.

## Conformance

A fixture is one case stated as plain JSON: the bytes, what they mean, the document before and the
document after. Nothing about this repo's types is needed to read one, which is the point. An
implementation in another language reads
[`spec/fixtures/`](https://github.com/torrinworx/aweft/tree/main/spec/fixtures) and is conformant
when it agrees with every file there.

```ts
import { checkFixture, type Fixture } from '@aweftjs/testing';

const fixture: Fixture = JSON.parse(readFileSync('spec/fixtures/001-object-slots.json', 'utf8'));
checkFixture(fixture);   // throws naming the fixture and the check that failed
```

`checkFixture` runs the case both directions. It decodes the stated bytes and compares the
deltas to the stated JSON, encodes the stated JSON and compares to the stated bytes, applies
the commits and compares the document to the stated ending, and re-runs each commit with its
own deltas shuffled and reversed to check that the order they arrive in changes nothing.

The commits themselves keep their order. Section 4 of the format requires that, and only the
deltas inside one commit are unordered.

The encode direction matters more than it looks. Bytes checked only by decoding them are
checked against the package that produced them, so the fixture asks the implementation
whether it agrees with itself. The stated JSON is authored (the documents by hand, the delta
order by the generator's own rule), so encoding it asks a question the decoder's own output
cannot answer. The bytes in a fixture were produced by the reference encoder when the fixture
was generated; what anchors that encoder to the prose of the format is a pair of commits
spelled out by hand, head by head, in codec's own tests. A second implementation proves itself
by agreeing with those fixtures byte for byte.

`checkInvalidFixture` is the other half. Each case in
[`spec/fixtures/invalid/`](https://github.com/torrinworx/aweft/tree/main/spec/fixtures/invalid)
names a `reason` and a `stage`, and an implementation that refuses the input for a different
reason has not agreed on the format, it has agreed on rejecting one string.

```ts
import { checkInvalidFixture, type InvalidFixture } from '@aweftjs/testing';
checkInvalidFixture(JSON.parse(readFileSync('spec/fixtures/invalid/011-truncated.json', 'utf8')));
```

## Checking a real implementation

Both check functions take an `Applier`: one reading of the format, as a function from a
starting document and some commits to the document reached.

```ts
type Applier = (initial: DocumentJson, commits: readonly Commit[]) => DocumentJson;
```

A fixture states its commits as `CommitJson`, which is bytes plus JSON. Your applier is never
handed those: `checkFixture` decodes each one and calls you with `Commit`, the codec type, with
real byte-string ids and reference objects. Read the format from
[`spec/format.md`](https://github.com/torrinworx/aweft/blob/main/spec/format.md) and the codec
types, not from the fixture JSON shape.

`modelApplier` is the default, and it is the harness's own reading: plain data, no
reactivity, written from the specification rather than from any package. Passing a second
applier is how a real implementation gets held to the same suite:

```ts
checkFixture(fixture, myApplier);
```

Two independent readings reaching the same document from the same bytes is the evidence.
One implementation agreeing with itself is not.

When your applier throws on a fixture that is valid, the failure names the fixture, the delta
order it was running, and the reason you threw. When it returns the wrong document, the
failure prints both documents. Those are the two ways a second reading goes wrong, and the
suite is built to tell them apart.

## The document model

`DocumentJson` is flat: observables keyed by id in text form, with the root named separately.
Flat rather than nested because an observable can be named from more than one place, and a
nested spelling would have to pick one and quietly lose the others.

```ts
import { applyCommit, canonicalJson } from '@aweftjs/testing';

const after = applyCommit(before, commit);        // a new document, the input untouched
canonicalJson(after) === canonicalJson(expected)  // how two documents are compared
```

`applyCommit` checks every delta before applying any, which is what makes a commit atomic: a
commit that breaks a rule leaves the document exactly as it was. Compare documents through
`canonicalJson` rather than directly, or the order keys happened to be inserted in becomes
part of the answer.

## The recording host

`recordingDocument()` is a light document from `@aweftjs/dom` that writes down every node
operation, so a test asserts what a mount did to the tree and not only what the tree looks
like after.

```ts
import { recordingDocument } from '@aweftjs/testing';

const { document, ops } = recordingDocument();
mount(document.body, h('p', {}, 'hi'));
ops;            // ['insert <p> into <body> before end']
ops.length = 0; // clear between the steps of a test
```

One line per insert, remove, replace, text write, attribute write and clear, in order. A node
made elsewhere joins the recording when it is inserted.

## The tier rule

Packages are numbered, and a package may import downward only. `boundaries.json` is the table,
this package holds the check, and
[`packages/testing/scripts/check-boundaries.ts`](https://github.com/torrinworx/aweft/blob/main/packages/testing/scripts/check-boundaries.ts)
runs it over the imports that actually exist.

```ts
import { checkGraph } from '@aweftjs/testing';
checkGraph([['core', 'codec']], table);   // [] means the graph is legal
```

Runtime code is what the rule governs. Tests, scripts and examples are outside it, because a
suite importing this harness creates no dependency in anything a user installs, and the
definition of done requires exactly that import. They are still printed on every run, so an
exclusion that starts hiding something is visible rather than silent.

## Testing a module in isolation

`loadModule` instantiates one module the way `@aweftjs/modules` would, with its dependencies
replaced by whatever the test hands over, so a module's own tests do not need a directory, a
document or the modules it depends on.

```ts
import { loadModule } from '@aweftjs/testing';
import * as Create from './modules/posts/Create.ts';

const { instance, stop } = await loadModule({
	exports: Create,
	imports: { 'auth/Session': { userOf: () => 'u_1' }, 'lib/Log': { log: () => {} } },
	config: { maxLength: 10 },     // merged over the module's defaults, as an extension would be
	props: { site: 'test' },       // what the application would pass the loader
});

assert.equal((instance as Post).make('a long title'), 'post:a long ti');
await stop();                    // unloads it, calling the instance's stop if it has one
```

Every name in the module's `deps` needs an entry in `imports`, keyed by the full dependency
name; a missing one is refused by name before anything is instantiated. The module is loaded
through the real loader, so `imports` reaches the factory keyed by the last segment of each
name, exactly as it would in an application.

## Testing a whole backend

`loadModule` above is one module with its dependencies stubbed. `loadServer` is the level above:
a real server, real modules, and the gate the application actually uses, on a listener that opens
nothing. It takes `createServer`'s options without the listener, which is the one part a test
cannot supply.

```ts
import { loadServer } from '@aweftjs/testing';

const server = await loadServer({
	sources: [fromDirectory(modules), auth],
	store: createStore({ driver: memoryDriver(), declare: { ...paths } }),
	gate: 'auth/Gate',
});

const answer = await server.fetch('/api/session', { method: 'POST', body });
const page = await server.open({ headers: { cookie } });
await page.asks.ask('board/Mine');
await server.stop();
```

A throwaway or a server the suite never stops keeps its own resources alive: a cluster is a child
process and a running one holds the test process open. Stop them in an `after`.

`fetch` and `open` are the two seams a listener feeds, so everything a deployment does goes
through the same code a deployment does it with. `open` answers a socket, a link and the call
channel; it **throws** when the gate refuses the handshake, carrying the status the gate answered
with, because a browser handed a refusal gets a failed connection and not a response to read.

**Signing in is yours.** The sequence is a POST to your battery's session route, the `Set-Cookie`
off the answer, and `open` with that cookie. It is five lines and it is not here, because putting
it here would tie this package to one battery's routes and one idea of what a session is.
[`recipes/full-stack/tests/board.test.ts`](https://github.com/torrinworx/aweft/blob/main/recipes/full-stack/tests/board.test.ts)
is those five lines.

## The security suite

`securityChecks({ gate })` is the suite a server passes rather than claims, the way a runner
passes `roomChecks()`. Each case is one named obligation citing the ASVS 5.0 requirements it
proves (`docs/security.md` has the table), run against a server you start, so an application
that boots its own modules behind the same server proves the same things about itself.

```ts
import { loadServer, securityChecks } from '@aweftjs/testing';

for (const c of securityChecks({ gate: 'auth/Gate' })) {
	test(`${c.requirements.join(' ')}: ${c.name}`, () => c.run((given) => loadServer({
		...given,
		sources: [fromDirectory(modules), auth, ...given.sources],
		store: createStore({ driver: memoryDriver(), declare: { ...paths } }),
	})));
}
```

`start` is yours: it loads the probe modules the suite hands it beside your own, starts under
the gate the suite names (yours, with one rule of its own composed on top), passes the handlers
the suite gives it, and answers `{ fetch, open, server, stop }`, which is what `loadServer`
answers. The suite speaks the session routes by their documented shape, `POST` and `DELETE
/api/session` as `@aweftjs/auth` answers them, and imports no battery; a target with no
session battery fails the session cases at the first sign-up, naming that. Nothing is skipped.

The suite is append-only: a case is added for every hole ever found and none is removed. It
runs over the harness, where `fetch` may be handed a full URL, which is how the suite says a
request arrived over TLS. A target over a real port would adapt `fetch` and `open` to it, and
none ships: the transport's own bounds are pinned by the listener's tests.

`npm run security` ties the suite to the table: every requirement the table gives to the stack
names a case here or a test elsewhere that exists, and every case cites a requirement the table
gives to the stack.

## Two ends of one socket

`socketPair()` is what `loadServer` opens over, and it is exported because a suite that is about
the transport itself wants one without a server.

```ts
const [near, far] = socketPair();       // near is the page's end, far the server's
const link = connect(fromWebSocket(near));
```

What one sends the other hears on a microtask, never synchronously. A send before the socket is
open or after it closed reaches nobody, as a real one refuses and drops. Closing either closes both
and fires `close` at both; a second close does nothing. A listener that throws is recorded on
`thrown` and the listeners after it still run, because one socket here carries both the link and
the call channel and a throwing link would otherwise mean an ask that never settles.

An end also carries `peer` and `fire`. `fire('open', {})` is how a suite driving a client's retry
hands the page the event a browser would have fired. A listener added while an event is dispatching
does not hear that event, which is what a real `EventTarget` does. Pass `0` for a near end that
starts connecting, which is the order a page sees: the server is handed an accepted socket before
the page is told about its own.

This is not `sync`'s `inProcess`. That answers two channels, and a channel is one plane; a socket
carries the link and the call channel together and has the `readyState` and the close event a retry
reads.

## A database that goes away

`throwaway()` on the `/postgres` subpath starts an empty cluster in a temporary directory on a free
port, and stops it when you are done.

```ts
import { throwaway } from '@aweftjs/testing/postgres';

const db = await throwaway();
const store = createStore({ driver: postgresDriver(await db.pool()) });
// ...
await db.stop();
```

Every `pool()` is in a schema of its own, so two checks in one file never see each other's tables,
which is also how two applications share one database. **The throwaway owns every pool it handed
out** and ends them all in `stop`, so do not end one yourself: `pg` throws "Called end on pool more
than once" for the second call, and that throw is its, not this package's.

`embedded-postgres` and `pg` are optional peers: a project that never opens a store installs
neither, and one that asks for a throwaway without them gets `peer-not-installed` naming what to
install. `throwaway` takes how the peers are reached, so that refusal can be reached without
uninstalling anything.

## Reading the page a test drives

`audit` and `walk` on the `/browser` subpath take the page object a browser driver already handed
the test and answer what a screen reader and a keyboard would find there (design 267). Neither
throws on a finding; the test says what a finding means for it.

```ts
import { audit, walk } from '@aweftjs/testing/browser';

const { violations } = await audit(view);
assert.deepEqual(violations, [], violations.map((v) => `${v.rule}: ${v.help}`).join('\n'));

const { stops, problems } = await walk(view);
assert.deepEqual(problems, [], problems.map((p) => `${p.reason} at ${p.target}: ${p.fix}`).join('\n'));
```

**`audit`** puts axe-core into the page and runs it over the document, or over `options.root`,
with the WCAG 2.x A and AA tags (`options.tags` replaces the list). A violation carries axe's rule
id, its `wcag*` tags as axe writes them (`wcag2aa`, `wcag143`), its help sentence and link, and the
nodes as a selector and the markup. Run it once per colour scheme: the page's colours are what it
measures, and a second run on the same page reuses the script.

**`walk`** presses Tab from the top of the page until the focus comes back round, or `options.limit`
(300) presses have gone by, and answers every stop (tag, id, role, name, and whether it draws a ring
while it matches `:focus-visible`) and the problems: `focus-not-visible` for a stop with no
`outline` and no `box-shadow`, `focus-stuck` when a press left the focus where it was, `focus-loops`
when a press sent the focus back round the page without letting it leave, `unreachable` for a
focusable element the walk never landed on, `never-cycles` when the limit ran out. Whatever the
page had focused loses it first. A ring is the element's own `outline` or `box-shadow`, or one an
ancestor draws for the control inside it through a rule about focus, and nothing else, so a page
that shows its focus by changing a border colour is reported as ringless. A radio group is one
stop, an element with no box (inside a closed `details`, a closed dialog, a hidden parent) is not
expected, and a frame, a shadow host or a media element's own controls is one stop the focus
moves inside without the walk reading where. Run it with no modal dialog open: the page behind
one is inert and the walk reports it unreachable.

The page is structural: `evaluate(source)`, `addScriptTag({ content })` and `keyboard.press(key)`,
which Playwright's `Page` satisfies (the suite passes one), and this package imports no browser
driver.
`axe-core` is an optional peer: a project that never audits installs nothing, and one that asks
without it gets `axe-not-installed`. `options.locate` says where the script is when the installed
one is not the one to use, and is how that refusal is reached without uninstalling anything.

What neither reads is the criteria that need a person: meaning carried by colour alone, the order
of the reading, a heading that describes its section, a time limit, an error message that says
what to do. The build refuses what the source settles (`@aweftjs/build`, The access rules) and the
mount throws on a nameless `Button` and a page with no `lang` or title (`@aweftjs/ui`); these two
read the rendered page for the rest.

## Letting scheduled work run

`settle()` yields to the timer queue ten times, so work that schedules more work gets to run. A
single `await` drains microtasks and nothing else, which is why a suite that awaits once and
asserts sees a tree that is half settled. Pass a whole number of one or more for a different count;
anything else is refused rather than settling for nothing and failing an assertion further on.

## Seeded randomness

A property test is worth having only if a failure can be run again, so a failing assertion
prints its seed and that seed reproduces the run exactly.

```ts
import { randomBelow, randomFrom } from '@aweftjs/testing';

const random = randomFrom(20260901);
const victim = items[randomBelow(random, items.length)];
```

There is one generator here rather than one per suite. Copies of the same shift register
drifted apart in small ways, and a seed that reproduces a failure under one copy reproduces
nothing under another.

## The words check

`npm run words` reads every tracked file for the vocabulary of how the stack was built (who
decided a thing, when, through which review) and prints each line that carries a word from the
list, with what to write instead. The list is in
[`packages/testing/src/words.ts`](https://github.com/torrinworx/aweft/blob/main/packages/testing/src/words.ts),
one entry per word with its fix. It reads text, not syntax, so it matches the spellings the
process used and leaves the words the code needs alone.

```ts
import { checkWords } from '@aweftjs/testing';
checkWords([{ path: 'note.md', text }]);   // [] means the text is clean
```

With paths, `node packages/testing/scripts/check-words.ts docs/design` reads those files
instead of the whole tree.

## What a suite has to name

`npm run exercised` reads each package's `surface.txt` and `errors.txt` beside its tests and
fails a covered package whose own suite never names one of its value exports, or never quotes
one of its refusal reasons (design 285). Both files are generated: `surface.txt` by `npm run
surface`, one export per line as `value name: type` with a subpath's lines prefixed by the
subpath, and `errors.txt` by `npm run errors`, one `reason: fix` per line. A test counts when it is not the surface list and not a
white-box `internal.*` file; a name in a comment does not count, and a reason as the whole of a
regular expression does, since a refusal's message opens with its reason. The covered packages
are listed in the script and the list only grows; the rest have their counts printed. `testing`
is exempt, because its surface is the suites of the other packages.

```ts
import { checkExercised } from '@aweftjs/testing';
checkExercised('store', surface, errors, tests);   // [] means the suite names everything
```

## The operator sweep

`npm run sweep -- <package>` copies the repo into a scratch directory, flips one operator at a
time in that package's sources (a comparison, a logical operator, a boolean a function returns),
runs the package's own suite against each flip, and prints every flip the suite let through with
its file, line and operator (design 287). It runs on request and never in the gate: one flip is
one run of the suite, two test files at a time so the machine stays usable, and
`--only=<file>[,<file>]` narrows it to the files you are working on. A survivor is either killed
by a test or written down as equivalent with the reason, wherever the change that ran the sweep
is written up.

```ts
import { flipSite, sweepSites } from '@aweftjs/testing';
const [first] = sweepSites(source);        // where the file can be flipped, in order
const flipped = flipSite(source, first!);  // the same text with that one operator changed
```

## Running the gate

`npm test` at the root is the whole gate: typecheck, the dependency rules, the tier rule over real
imports, every package's suite with its coverage threshold, and every proof program.
[`packages/testing/scripts/run-tests.ts`](https://github.com/torrinworx/aweft/blob/main/packages/testing/scripts/run-tests.ts)
is the part that runs the suites, and `generate-fixtures.ts` rewrites
[`spec/fixtures/`](https://github.com/torrinworx/aweft/tree/main/spec/fixtures) from the generator
entries.