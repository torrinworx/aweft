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

### The replication protocol, added 2026-09-02

`spec/replication.md` v0 and the fixture corpus in `spec/frames/`. It builds on the commit
format and changes nothing about it.

- A link carries frames in order, and delivery is never synchronous with the send: a commit
  applied from inside another document's delivery breaks the ordering the client rests on.
- A link carries many documents. Each is a topic, named by a string on the join frame and
  numbered by an integer on every frame after it. A string topic on every frame measured
  +29.5% over the commit bytes it carries, which is why it is a number. Decision 042.
- Two sequence counters per topic: the client numbers what it sends, the host numbers what it
  publishes. An accept states both, because a commit is never sent back to whoever made it and
  the sender would otherwise have a hole in its count of the topic.
- A frame carries one or more commits. That is batching and never rate limiting: every commit
  goes, in order, in the tick it was made. Frames are not compressed one at a time, because
  gzip per frame measured larger than the frames themselves.
- Seven frame kinds, written as arrays with the kind first, encoded by section 6 of the state
  format. A frame that does not decode ends the link; a commit that is refused never does.
- A `joined` frame says whether it describes the whole document, as a field of its own rather
  than by carrying a reset. A host whose document is empty has no commit to send and still has
  to be able to say so, or a replica holding stale content keeps it forever.
- A reset is the whole document as one commit of adds, and a receiver of a whole frame applies
  the difference rather than replacing the document. Decision 044.
- A host sends the accept for a commit before anything else it sends that client afterwards,
  so a host that writes in answer to a commit does not put the sender out of step.
- A client that has lost its place leaves the topic and joins it again presenting no session,
  rather than joining with a count of zero while still a member.
- One document is served under one authority; a second join resolving it differently is
  refused with `policy-mismatch`, and one link syncing it twice is refused with
  `document-in-use`. Neither ends the link, and neither does any other reason a join is
  turned away.
- A client that has asked for the whole document several times in a row without taking a
  commit from the host stops asking and reports it. Only a commit from the host counts as
  getting somewhere: a client that is writing collects accepts whatever else is wrong.
- 9 frame fixtures and 10 rejections, each rejection naming the reason it must be refused for.
- Not specified, on purpose: application messages, forwarding between hosts (so no frame
  carries an originating actor), read filtering, and how long a host remembers.

### The replication protocol, rewritten as v1 2026-09-03

v0 had a host and a client. v1 has two equal ends and replaces v0 whole. Decision 053.

- Nothing in the protocol says which end is which. Both run the same rules.
- Each end numbers the topics it opens, and a frame names a topic by the sender's number, so
  a name still rides on no commit frame. `open` carries the name, the sender's root id and
  kind, and whether it wants the other end's state.
- A topic is live at an end once it has shared the name and received the other end's `open`.
  Different root ids under one name are refused with `root-mismatch`.
- Six frame kinds: `open`, `state`, `commits`, `refused`, `leave`, `fault`. `join`, `joined`,
  `accept` and `refuse` are gone: they were verdicts, and a verdict needs an authority.
- One sequence counter per topic per direction, used only so a `refused` can name a commit.
  Loss is not detected: a link delivers in order or ends.
- A commit an end cannot apply is reported to that end's application and answered with
  `refused`, so the sender's application hears it too. The protocol never chooses which end
  yields; an end asks for the other's state by sending `open` again with `want`. Decision 054.
- A commit that arrived over a link is never sent back over it, and is delivered to every
  other consumer of the document as a commit made at this end. Decision 055.
- Nothing resumes. Sessions, replay windows and `policy-mismatch` are gone with the host.
- An `open` may state no root, meaning the sender holds nothing and wants the other end's
  state; two ends with nothing fault each other with `no-document` rather than waiting.
  Topic and sequence numbers below 1 are `bad-frame`. Added 2026-09-03 from the check-in.
- The frame fixtures in `spec/frames/` are regenerated for v1.
