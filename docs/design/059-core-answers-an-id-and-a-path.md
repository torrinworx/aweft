# 059: Core answers an id with its observable, and an observable with its path

Revised by design 084: a detached observable leaves the index when the commit that detached it
closes, so `byId` no longer finds it.

## Decision

Two readers join `idOf`, `kindOf`, `parentOf` and `isReachable` in core's identity surface:

- `byId(document, id)`: the observable in that document with that id, or undefined. The id is
  the twelve bytes a delta carries or its text form. A detached observable is not found: it
  left the document when the commit that detached it closed (design 084). `isReachable` says
  whether an observable a caller already holds is still reachable.
- `pathOf(observable)`: the attach path from the document root, as the slot names the format
  spells (an object key, a map id in text form, an array position in hex), empty for the
  root, and undefined for anything nothing attaches. A walk up parent pointers, O(depth).

## Why

A delta names the observable it changes by id. Anything that has to know where that change
lands, which is what `schema`'s `check` does on every commit under a guard, has to get from
the id to the observable and from the observable up to the root. Core holds both answers in
the index and the parent pointers it already keeps. With neither exported, `check` takes a
whole snapshot of the document per commit: 81 us at 100 items, 38 ms at 30,000
(`bench/guard.ts`). With these two readers the walk is the commit's size, not the document's,
measured at about half a microsecond per delta.

Exporting the readers beats `schema` keeping its own index: one line of core each, against a
few hundred lines of index upkeep and a contract the caller would have to keep.

## What it costs

Two more names on core's surface. Both are readers, neither can write, and neither reveals
anything a snapshot did not already reveal.

## What would reverse this

Nothing foreseeable. If a second consumer needs the same walk in a different spelling, the
spelling becomes a parameter rather than a second function.
