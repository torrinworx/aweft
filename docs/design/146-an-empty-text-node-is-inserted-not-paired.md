# 146: An empty text node is inserted during hydration, not paired

## Decision

In `Hydration.claim`, a fresh text node whose data is `''` answers null, so the mounter inserts it
where the cursor is instead of pairing it with a server node. The branch sits before the check
that fails with `the server markup ran out`, and it is the only place an empty text node is
treated differently from any other.

## Why

`''` serializes to no characters. The server markup therefore holds no node for it, and the pairing
walk read that as markup that ran out: it asserted in development and, in a release build, threw
away every server node from that point to the end of the run. The ordinary case is a form's error
line, a label bound to a cell that is empty until something goes wrong.

Measured on a patched copy and again on this tree: `h('p', {}, mutable(''))`,
`h('p', {}, '')`, `h('p', {}, '', 'after')` and `h('p', {}, 'a', mutable(''), 'b')` all hydrate, and
writing `'now'` into the cell afterwards updates the page, because the inserted node is really in
the document rather than a stand-in for one.

Inserting rather than pairing is what the mode already does for a node the application made itself
(design 078): a client node with nothing to stand for it goes in as it is. An empty text node is
that same case, arrived at from the other direction.

## What this costs

A server node that really is an empty text node, if one could exist, would now be surplus rather
than the pair for the client's. Nothing can write one: `toHtml` renders it as no characters, so it
never survives a round trip through markup.

## What would reverse this

A serializer that writes something for an empty text node, a comment marker say, which would give
the pairing walk a node to claim and make the insert a second node on the page.
