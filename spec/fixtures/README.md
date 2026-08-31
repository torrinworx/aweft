# Conformance fixtures

The normative artifact. `spec/format.md` describes intent; these define behavior. Where the
two disagree, a fixture is correct and the prose is a defect.

Each fixture is a JSON file describing an initial state, a sequence of commits, and the
expected final state. A conforming implementation decodes it, applies the commits in
generated, shuffled, and reversed order, and reaches the stated final state every time.

`invalid/` holds inputs that must be rejected, each with the reason it is rejected.

Empty for now: the byte encoding is not specified yet, so there is nothing to be
byte-equal to. Fixtures land with the encoding, in the same change.
