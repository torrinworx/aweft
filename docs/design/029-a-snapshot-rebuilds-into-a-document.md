# 029: A snapshot rebuilds into a document

## Decision

`fromSnapshot(snap)` is public core API. It takes what `snapshot` returns and builds a live
document: same ids, same kinds, same slots, same positions, aliases restored. Round trip
holds: `snapshot(fromSnapshot(snapshot(doc)))` deep-equals `snapshot(doc)`, and the rebuilt
document accepts commits addressed to the original's ids.

## Why

`snapshot` alone is half a capability. Reading a document out has three consumers that all
need the way back in: a deep clone (rebuild, then new ids via `apply` is not needed, cloning
is rebuild plus fresh root), a persistence layer restoring state without replaying a full
commit log, and a test fixture standing a document up from literal data. Before this, the
way back in was replaying a recorded commit stream, which requires having recorded one.

It lives in core because it is the inverse of `snapshot`, which lives in core, and because
building with original ids requires the constructors' id parameter plus attach bookkeeping
that only core may touch.

## What this costs

A snapshot with the same id at two attach points, or an alias to an id the snapshot does not
contain, is invalid input and is refused with the same error vocabulary `apply` uses. The
function validates rather than trusting, so malformed hand-written fixtures fail at build,
not at first use.

## What would reverse this

A storage shape that never materializes snapshots would remove one consumer, but clone and
fixtures keep it public regardless.
