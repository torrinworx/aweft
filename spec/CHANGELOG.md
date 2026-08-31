# Format changelog

Append-only. Every change to a normative statement or a fixture gets an entry.

## v0, unreleased

Not frozen. No deployed implementation depends on it yet.

### The model

- Delta types are add, replace, remove.
- Deltas address `id` plus `ref`, never a path.
- `ref` is polymorphic across the three observable kinds and is discriminated by the
  encoding.
- Prior values are not carried on the wire.
- The commit is the unit that crosses every boundary, and is order-independent internally.
- Commit scope is one document.
- Coalescing rules, keyed by slot rather than by time.
- An optional per-commit integrity tag.

### The encoding, added 2026-08-31

- A byte encoding with one spelling per value: null, booleans, integers, float64, byte
  strings, text strings, arrays. No maps, no tags, no indefinite lengths. Decision 004.
- Whole numbers within plus or minus 2^53 are integers; everything else finite is a float64.
  NaN and the infinities have no encoding, and negative zero is written as zero.
- Text is UTF-8, and an unpaired surrogate has no encoding.
- A value is a primitive or a reference. References carry the kind of the observable they
  name, and nothing is inlined. Decision 007.
- Array slots are named by ordered byte strings that are non-empty and do not end in a zero
  byte. Generation is deliberately unspecified. Decision 006.
- Map slots are named by an id.
- Deltas within a commit are written in ascending order of encoded `id` then encoded `ref`,
  and any other order is refused rather than sorted.
- A commit carries at least one delta. A tag is 4 to 32 bytes.
- Ids are 12 bytes, written as sixteen base64url characters, with no timestamp component.
  Decision 005.
- 14 conformance fixtures and 30 rejection fixtures, each rejection naming the reason it must
  be refused for.

### Attach edges, added 2026-08-31

- A reference states which kind of edge it is: **attach** or **alias**. Encoded as a third
  element, `[edge, kind, id]`, costing one byte per reference. Decision 010.
- Every observable reachable from the root has exactly one attach edge. A commit that would
  give one a second attach edge is refused, and so is a delta whose target has no attach path
  from the root.
- Reachability counts the attach edges a commit adds and ignores the ones it removes, so a
  commit may write into a subtree while detaching it.
- This closes the previously open question of what an unreachable observable means: a delta
  into one is refused. What becomes of a subtree after it is detached is still open.

Open: the integrity tag algorithm, large and exact numbers, and the fate of a detached
subtree.
