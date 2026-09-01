# Conformance fixtures

The normative artifact. `spec/format.md` describes intent; these define behavior. Where the
two disagree, a fixture is correct and the prose is a defect.

Regenerate with `npm run fixtures`. The gate checks that what is committed here is what the
generator produces, so an edit by hand fails until it is generated.

## A fixture

Each file states a starting document, one or more commits, and the document those commits
reach. A commit states its `bytes` and, separately, what those bytes mean. Running a fixture
checks four things:

1. The bytes decode to the deltas the fixture states.
2. Re-encoding those deltas reproduces the bytes exactly.
3. Handing the deltas over in a different order still reproduces the bytes, because the
   canonical order is the encoder's job.
4. Applying the commits reaches the stated document, with the deltas in generated, shuffled
   and reversed order.

The starting and ending documents are written by hand in the generator, not derived by the
applier, and the stated deltas are ordered independently of the encoder's own sort.
Generation fails if applying the commits does not reach the stated document, or if the
encoder's canonical order disagrees with the independent one. The `bytes` are the reference
encoder's output, frozen by this directory: a change to them is a format change and gets a
`CHANGELOG` entry, which is what stops a regeneration from quietly re-baselining the format
around a defect.

## `invalid/`

Inputs that must be refused, each naming the `reason` it is refused for. Refusing for a
different reason is a failure: a format whose implementations disagree about why an input is
invalid has not been specified, only implemented.

`stage` says when the refusal happens. `decode` means the bytes are not a commit. `apply`
means they decode cleanly and conflict with the `initial` document the fixture states.

Rejection fixtures are minimal on purpose. Most are a real one-delta commit with a single
thing wrong in it, so what is being tested is visible in the hex.

## Reading the JSON

Ids appear in their textual form, sixteen base64url characters, which is the form they take
everywhere outside the wire. Every other byte string, meaning array positions, byte values,
and integrity tags, appears as lowercase hex.

Numbers are ordinary JSON numbers. Fixtures are read and never written by a conformance
runner, and every IEEE 754 parser reads a given spelling the same way, so the fact that
runtimes print doubles differently does not reach these files.

Ids count up from one rather than being random, so a fixture reads the same everywhere and a
diff means something changed.
