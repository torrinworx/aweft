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

### The integer range, corrected 2026-09-01

The prose in 6.2 was already right and the implementation was not, so nothing normative
changed here. Recording it because two fixtures did.

- The range in 6.2 is stated as plus or minus 2^53, and its reason is exact representability.
  A double holds every integer of magnitude 2^53 or less exactly, so both endpoints are in
  the range and the range is symmetric.
- The encoder had reached for the safe integer range instead, which stops one short on the
  positive side. It wrote 2^53 as a float and refused the integer spelling of it, so a
  commit written by a second implementation reading this prose came back refused.
- Fixture `015-number-edges` had named the safe boundary `largestExact` and skipped 2^53
  entirely. It now carries 2^53 and its negative, and keeps the safe boundary as its own
  case.
- Rejection fixture `012-integer-out-of-range` had used the integer spelling of 2^53, which
  is legal. It now uses one past it.
- A decoder **MUST** judge an eight byte argument before combining its halves. Adding them
  first rounds an argument past 2^53 back down into the range, after which the check passes
  and the decoder answers with a number the bytes did not state. This was live and silent.

15 conformance fixtures and 35 rejection fixtures, replacing the counts recorded above.

### Two rules that existed only in the corpus, written down 2026-09-01

An implementer building a second reading of the format from the prose alone found both of
these by decoding fixture bytes and working backwards. Nothing normative changed; both rules
were already enforced and already had fixtures. They were not stated.

- **1.2, an observable's kind is fixed.** Nothing changes an observable's kind, and every
  mention of an id has to agree about it: the `kind` on a reference, the kind a `ref` implies,
  and the kind the document already has. A commit whose mentions disagree is refused. Fixture
  `invalid/028-kind-conflict` was the only place this rule appeared.
- **The apply-stage refusal vocabulary, in section 7.** `kind-conflict`, `multiple-attach`,
  `slot-exists`, `slot-missing` and `unreachable`, each pointing at the rule it enforces.
  Section 7 already made the reason part of conformance without saying what any reason was.
  A test now holds the table and the corpus to each other, so neither can move alone.

Open: the integrity tag algorithm, and the fate of a detached subtree.

## 2026-09-01

- Section 6.1 states the nesting bound the decoder always enforced: the format needs four
  levels, a decoder refuses past eight. The reference decoder was admitting nine; it now
  admits exactly eight.
- Section 7 lists the decode-stage refusal vocabulary in full, the same way the apply stage
  was already listed. Three reasons were reachable from wire bytes with no fixture naming
  them; `invalid/036-malformed-head`, `invalid/037-delta-not-an-array` and
  `invalid/038-ref-not-an-array` close that.
- New fixture `016-astral-keys`: two object keys above the basic plane on one id, the case
  where byte order and code-unit order disagree.
- Fixture provenance: a fixture's `deltas` are now stated from the authored commit, ordered
  by a comparison independent of the encoder's sort, so the bytes are checked against a
  statement the encoder did not produce. The regenerated corpus is byte-identical, which is
  the point: the change is to what a regeneration would do with a broken encoder.
