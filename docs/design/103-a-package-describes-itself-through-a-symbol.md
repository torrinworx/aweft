# 103: A package describes itself through an exported Symbol

Withdrawn, unbuilt: nothing implements it.

## What this proposed

Each package `debug` covers would export one Symbol with a describe function behind it. `debug`
would probe for the Symbol and format what came back, so it could reach what packages do not
export without deep-importing them.

## Why it was withdrawn

Building it showed the seam was not needed. Everything `debug` reads, it reads through public
API that already exists:

- A whole document comes from `snapshot`, which is public in `core`.
- A commit comes from `observer(...).watch`, which is public in `core`.
- Ids resolve to paths from the snapshot itself.
- A refusal carries its own `reason` and `fix` (design 101), and a `RefusedError` carries its
  `refusals` list.

So no package grew an export, no Symbol exists, and `debug` imports `core` and `codec` like any
other consumer. An experiment that shows a proposed change is unnecessary is a good
result, and this is one: three packages avoid a permanent public surface they did not need.

## What this leaves undone, deliberately

`debug` covers `core`. It does not read a live scope or a mounted node, which is what the seam
would have been for, and its README says so where a reader meets it. The coverage is narrowed to
`core` alone rather than built out to reach them.

## What would bring it back

A reader that genuinely cannot be written from public API. A scope's matched path is the likely
first one: it is internal to `core`, and no public export hands it out. If that reader is worth
having, this is where its seam is designed, and it starts from one package rather than three.
