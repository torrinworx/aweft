# 047: `store` persists observable rows, with a bounded commit tail beside them

Amended by design 056: the tail records no actor. Amended by design 053: "one host decides
every commit" is no longer a property of `sync`. It is a requirement on the application, which
arranges one end that refuses what it does not accept, and the sequence under the row lock is
what makes that end's order the order.

## Decision

A document is persisted as **one row per observable**: its id, its kind, the parent that
attaches it, the slot it sits in, and its own slots. A commit writes only the rows its deltas
name. Nothing in `store` writes a whole document, ever.

Beside the rows is a **commit tail**: encoded commit bytes with a per-document sequence
number, kept back only as far as `sync`'s resume window needs (design 045). The tail is
derived. Losing it costs a resynchronization, never a document.

The rows are the source of truth. A document opens by reading its rows, not by replaying
history.

The sequence is assigned under the document's own row lock. One host already decides every
commit for a document, so serializing there costs nothing.

## Why

**The cost of a write has to track the change, not the document.** Measured on embedded
Postgres, one field of one record changed per edit:

| | 153 KB document | 620 KB document |
|---|---|---|
| whole document per commit | 9.08 ms, 118 KB of WAL | 34.98 ms, 571 KB of WAL |
| one row per record | 0.049 ms, 1.5 KB of WAL | 0.054 ms, 3.9 KB of WAL |

The first is linear in the document, the second is flat. At 620 KB that is 648 times the
latency for the same edit.

**Patching one path does not escape it.** Writing only the changed path with `jsonb_set`
produced the same WAL as rewriting the whole column, 465 KB either way, because Postgres has
no in-place update and rewrites the row regardless. Granularity is the lever; patch syntax is
not.

**A document-sized write loses writes that do not conflict.** Four writers on one document,
each writing a slot no other writer touched, against the whole-document design: 29 of 49
updates refused as revision conflicts, and two writers lost every edit, in storage and in
their own memory, with nothing thrown. Per-slot writes lost nothing on the same test. A
whole-document write makes every concurrent edit a conflict whatever it touched.

**History must not be the truth.** Automerge is the one verified system that persists the
operation history as its document, and its format has no truncation: causal completeness is a
parse requirement, and a delete is encoded onto the operation that created the data, so the
creating operation survives forever.
Making history the truth means never dropping any of it.

**A tail is what `sync` already asks for.** Design 045 resumes a session by replaying
commits after a sequence the host echoes. That is a range read. Current state alone cannot
answer it; the whole history answers it at a cost nobody needs.

**Opening is not storage's problem.** Measured on the real core, 85% of the time to open a
document is `fromSnapshot` building live observables. No storage format changes that, so open
latency is core's number and not a reason to pick a persistence shape.

## What this costs

**Two writes per commit.** The tail append and the row updates go in one transaction. Against
a checkpoint-blob design on the same stream, rows cost 0.141 ms per write against 0.070 ms.
That buys never paying the whole-document write the blob owes on every checkpoint, which was
18 ms at 569 KB and grows with the document.

**A document is many rows.** Reading one is a range read over a prefix. A driver that cannot
range-read is not a driver.

**The sequence must be serialized.** `MAX(seq)+1` races under READ COMMITTED and two
concurrent appends collide on the primary key. The prototype hit exactly this. The row lock
is the fix, and it is correct only while one host decides a document's commits.

## What this replaces

Autosave on a throttle, an explicit flush, a reload, an optimistic revision with a retry, and
a structural re-merge of a re-read record all exist to manage a whole-document write. There is
no whole-document write, so none of them has a job. A commit is persisted when it is made, so
no window exists in which an accepted change is not yet written.

## What would reverse this

Documents only ever opened whole and never queried across, where one blob is simpler and
marginally cheaper per write. Or a driver target with no transaction spanning two tables,
which would leave the tail and the rows able to disagree after a crash, and would call for the
tail to be rebuilt from the rows rather than kept beside them.

## Amended

The tail's stated purpose above was replay to a resuming session, from design 045.
Design 053 superseded that: nothing resumes, and nothing in `sync` reads the tail. It is
the document's history, read by the application through `since` and bounded by `truncate`,
and any wording above that calls it a resume window is superseded by this line.
