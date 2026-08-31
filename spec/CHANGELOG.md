# Format changelog

Append-only. Every change to a normative statement or a fixture gets an entry.

## v0, unreleased

Initial draft. Not frozen; no implementation depends on it yet.

- Delta types are add, replace, remove.
- Deltas address `id` plus `ref`, never a path.
- `ref` is polymorphic across the three observable kinds and must be discriminated by the
  encoding.
- Prior values are not carried on the wire.
- The commit is the unit that crosses every boundary, and is order-independent internally.
- Commit scope is one document.
- Coalescing rules, keyed by slot rather than by time.
- An optional per-commit integrity tag.

Open: the byte encoding, the id encoding, and whether the tag algorithm is fixed or
negotiated.
