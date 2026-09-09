# 060: A page cursor is minted by the driver and names a position

## Decision

Every hit `find` and `scan` return carries a `cursor`: a string the driver mints, holding the
sort value the hit had and the document's name. `after` on `Query`, `Lookup` and `scan` takes a
cursor and nothing else.

A driver seeks past the position the cursor names, using the value inside it, never by looking
the document up again. A cursor is meaningful only to the driver that minted it and only under
the sort it was minted for; a driver refuses one from another sort, or one it did not mint, with
`reason: 'cursor'`.

## Why

`after` used to take the `doc` of the last hit, and the driver looked that document's rank up
in the live index to seek past it. Two ordinary edits between two pages gave a silent wrong
answer:

| between the pages | page 2 after d2 |
|---|---|
| nothing changes | d3, d4, d5 |
| the cursor's document stops matching, rank kept | d3, d4, d5 |
| the cursor's document is removed | d0, d1, d3 (restarted) |
| the cursor's document's rank changed | nothing (skipped) |

The first two rows were already right because the memory driver seeks by position. The last two
cannot be right while the position has to be looked up, because a removed document has no rank
and a moved one has the wrong rank. Carrying the value in the cursor is the only way the seek
does not depend on the document still being where it was. The driver conformance suite has
both rows as checks, and the memory driver and the example file driver pass them.

A minted cursor beats keeping `after` as a name and documenting the two shapes.

## What it costs

One more field on `Found`, and `after` changes meaning from a name to a cursor: a caller that
was passing a document's name gets a refusal rather than a wrong page. No shared minting helper
ships; the example file driver mints its own in a few lines, and a cursor's shape is the
driver's business. If a third driver wants a helper, that is a question about the surface, not a
reason to widen the driver contract.

## What would reverse this

A driver that cannot seek by a carried value, only by a live rank. None of the intended
targets (memory, IndexedDB, SQL) is one: each answers "the first row whose sort value and name
order after these" from its index.
