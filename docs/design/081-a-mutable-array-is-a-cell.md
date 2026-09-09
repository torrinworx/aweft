# 081: A mutable array is a cell

## Decision

`mutableArray(items)` makes a local list: an array whose slots hold anything, whose mutators
(`push`, `pop`, `shift`, `unshift`, `splice`, index and length assignment) deliver the changes
of one call to `watch(fn)` as a list of `{ type: 'add' | 'replace' | 'remove', at, value? }`
applied in order. `isMutableArray(value)` answers whether a value is one. It is a cell
(design 024): no delta, no commit, no place in a document, refused by `toCell` with
`cell-in-document`. `sort`, `reverse`, `fill` and `copyWithin` are refused as on a document
array.

## Why

A document slot holds a primitive or an observable (designs 007, 013), so a list of
components, DOM nodes or closures cannot be a document array. Interfaces have such lists:
popup layers, ripples, head tags, dropped files. Constant-time list rendering over them
depends on hearing each edit as an edit, which is what a second, local array gives.
`mutable([...])` diffed by reference is the alternative and costs the whole array per
edit: 59 us at 1,000 rows, 1.4 ms at 10,000.

It is a cell because cells are the stack's word for state outside the document, and it lives
in `core` because `jobs` and `ui` can want a local list with no DOM in sight.

## What this costs

Two arrays, and the author chooses. The choice is real (does this list replicate), so the
API making it explicit is the point rather than the price. Changes carry indices, not
positions, because a local list has no replica to agree with.

## What would reverse this

A local list needing to replicate after all. The migration is mechanical: `createArray` of
`createObject`.
