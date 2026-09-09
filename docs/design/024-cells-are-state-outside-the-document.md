# 024: Cells are state outside the document

## Decision

`mutable(value)` makes a cell: a single standalone reactive value with `get`, `set` and the
value combinators from design 023. `immutable(value)` wraps a constant, or a cell, scope or
derived value, as a read-only view. `timer(ms)` and `fromEvent(target, type)` are cells the
library drives: a tick count while observed, and the last event delivered.

A cell is not an observable. It cannot be attached into a document: writing one into a slot
is refused by `toCell` with its own error, the same way a plain object is. A cell produces no
deltas, participates in no commit, and never crosses a wire.

## Why

Interface state (which tab is open, a half-typed filter, a hover flag) has a different
lifetime and a different audience than document state. Making it document state would give
every keystroke an id, a delta and a place in the undo history. Making documents carry
non-delta events would mean commits that did not happen to the document, which design 023
rejects.

The split keeps both types honest: everything in a document replicates and inverts;
everything in a cell is local by construction. The refusal in `toCell` is loud so the
distinction is met at the write, not discovered downstream when a replica is missing a field.

`timer` and `fromEvent` subscribe to their driver only while observed, so an abandoned chain
holds no interval and no event listener.

## What this costs

Two ways to hold a value, and the author chooses. The choice is real (does this state
replicate or not), so the API making it explicit is the point rather than the price.

`fromEvent` takes anything with `addEventListener` and `removeEventListener`, typed
structurally, so core still knows nothing about the DOM.

## What would reverse this

An application needing interface state to replicate after all. The migration is mechanical
(the value moves into a document slot), which is why this is safe to decide now.
