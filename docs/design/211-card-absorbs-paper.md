# 211: `Card` absorbs `Paper`

Amends design 200: `Paper` is withdrawn.

## Decision

**A `Card` with no `title`, no `description` and no `foot` renders the bare block.** No head, no
foot, and no `stack` segment: the children are the card's own children, with nothing between them
and the element. That is exactly what `Paper` rendered.

**`Paper` goes**, with `packages/ui/src/paper.tsx`.

**A `Card` given any of the three keeps the `stack` segment and the parts**, which is what design
200 built: `card_head` with `card_title` and `card_description`, `card_body` around the children,
`card_foot` along the bottom, and `$space4` between them.

The entries do not move. `card`, `card_tight`, `card_stack` and the four parts are what they were,
and an application that wrote `theme="card"` on a `<div>` of its own is unaffected.

## Why

Design 200 shipped two components on one entry, and said so: "`Paper` is the same block with
nothing in it." Two exports for one entry is a caller having to know which name means the shorter
markup.

Making it the same component costs one condition, which the component already had in another form:
`Card` already renders each part only where it was given something, so the new rule is that the
column and its `<div theme="card_body">` are parts too. A card with a body and nothing else was
already a stack of one thing, and a stack of one thing lays out the same as no stack, which is why
this is a deletion rather than a change of look.

Five people building the same page from the docs alone all used `Card`; none used `Paper`.

## Evidence

`packages/ui/tests/composites.test.ts`: a `Card` with children only renders one element on the
`card` chain with the children directly inside it, with no `card_body`, no `card_head`, no
`card_foot` and no `stack` segment; a `Card` with a title renders the head and the body and takes
the `stack` segment; `tight` still takes the padding off in both shapes.

`packages/ui/tests/look.test.ts`: the seven `card` entries compile from names only, unchanged.

`recipes/ui/main.ts` keeps the `Paper` example's measurements against the bare `Card` cases now in
the `Card` example.

The suite pins both: the `stack` segment and the `card_body` wrapper are each rendered only where
the card was given a title, a description or a foot.

## What this costs

A page that imported `Paper` no longer compiles. There are none in this repo outside the catalogue
and the tests.

A caller who wants the column spacing around a body with no title now writes `<Card
theme="stack">` for it, because the segment is what the spacing is and the component only adds it
where it built a head or a foot.

## What would reverse this

Nothing about a card's parts. If the bare block grew props of its own that a card must not have,
it would be a separate component again for that reason and not for its markup.
