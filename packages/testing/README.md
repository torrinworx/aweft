# @aweftjs/testing

The checks the rest of the stack is held to: the conformance suite, a model reading of the
format to check real implementations against, the tier rule, and seeded randomness.

This package is an integrator. It sits outside the tier ordering because everything is
allowed to depend on it, and nothing it exports ships to a user of the library. It is where
a claim about the stack becomes a check that fails when the claim stops being true.

## Conformance

A fixture is one case stated as plain JSON: the bytes, what they mean, the document before
and the document after. Nothing about this repo's types is needed to read one, which is the
point. An implementation in another language reads `spec/fixtures/` and is conformant when it
agrees with every file there.

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

`checkInvalidFixture` is the other half. Each case in `spec/fixtures/invalid/` names a
`reason` and a `stage`, and an implementation that refuses the input for a different reason
has not agreed on the format, it has agreed on rejecting one string.

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
handed those: `checkFixture` decodes each one and calls you with `Commit`, the codec type,
with real byte-string ids and reference objects. Read the format from `spec/format.md` and the
codec types, not from the fixture JSON shape.

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

## The tier rule

Packages are numbered, and a package may import downward only. `boundaries.json` is the
table, this package holds the check, and `packages/testing/scripts/check-boundaries.ts` runs
it over the imports that actually exist.

```ts
import { checkGraph } from '@aweftjs/testing';
checkGraph([['core', 'codec']], table);   // [] means the graph is legal
```

Runtime code is what the rule governs. Tests, scripts and examples are outside it, because a
suite importing this harness creates no dependency in anything a user installs, and the
definition of done requires exactly that import. They are still printed on every run, so an
exclusion that starts hiding something is visible rather than silent.

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

## Running the gate

`npm test` at the root is the whole gate: typecheck, the dependency rules, the tier rule over
real imports, every package's suite with its coverage threshold, and every proof program.
`packages/testing/scripts/run-tests.ts` is the part that runs the suites, and
`generate-fixtures.ts` rewrites `spec/fixtures/` from the generator entries.
