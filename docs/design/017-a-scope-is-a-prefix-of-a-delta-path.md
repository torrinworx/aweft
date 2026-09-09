# 017: A scope is a prefix of the path a delta names

## Decision

A listener narrows what it sees with an observer chain:

```js
observer(doc).path('settings').ignore('draft').watch(fn);
observer(doc).path('user', 'name').effect(fn);
observer(doc).shallow().watch(fn);
```

Each delta gets a path relative to the observer's base: the slot keys walked from the base
down to the delta's target, plus the key the delta itself names. A delta is in scope when
that path starts with the scope's keys.

- `path(...keys)` narrows to a subtree, or to one slot when the keys reach a leaf.
- `ignore(...keys)` drops a delta whose next key past the scope is one of them.
- `shallow()` keeps only deltas addressing the scoped observable's own slots.

A watcher is called once per commit with the deltas that survived its scope, in the format's
canonical order, and is not called at all when none did.

## Why a path and not a subscription on the target

A scope has to be expressible before the thing it names exists. `path('user', 'name')` is
useful on an empty document, and the slot it names may be created, removed and created again
underneath it. A subscription bound to whatever object sits there today would go quiet the
first time that happens, silently, which is the failure mode a reactive system can least
afford.

Resolving the path per delta also means one registration on the base observable rather than
one per node along the way, so a scope costs nothing to keep open over a subtree that is
being rebuilt.

## Why a scoped watcher sees a projection

A commit is atomic across the whole document, and a scoped listener asked for part of it. It
gets the deltas in its scope and no others. That projection is not itself a commit anyone
should transmit: what crosses a boundary is the whole commit, which is what `sync` gets by
watching the root.

## What a path does at an alias edge

A path walks attach edges and stops at an alias. `observer(doc).path('author', 'name')` reads
nothing when `author` holds an alias, and writing through it is refused. To follow an alias,
read the slot and start a scope at what it names: `observer(doc.author).path('name')`.

An earlier shape did the other thing: `get` followed any reference while delivery walked
attach edges only. So a path through an alias read the live value and followed it as it
changed, while a watcher on the same path was never called once. Correct on first read, then
silently stale, which is the failure this design exists to prevent, in the one place nobody
would look for it.

Stopping is the cheaper half of the fix. The other direction, letting delivery follow alias
edges upward, would mean a delta's target can be reached by many paths, so matching a scope
stops being one walk up and becomes a search of the reference graph. Design 010 measured
what that costs: 36,507 paths through a document of 142 observables, and a 4 GB heap exhausted
at around 2,000.

## Delivery order, and what it costs

A watcher is called with its deltas in the format's canonical order. That is worth stating
because the alternative leaks: a receiver applies a commit in wire order, so its watchers would
see one order while the sender's saw another, and a watcher that depends on order would pass
every local test and diverge only under replication.

Measured, it was also nearly all the cost of a write: building an encoded sort key per delta
put a one-slot write with one watcher at 2.66 microseconds against 0.35 with the ordering
removed. Neither number is the price of the guarantee. One mutation is one commit, so most
commits carry one delta and there is nothing to sort, and the comparison itself needs no
allocation: `compareDeltas` in the encoding package reads the same order off the values, and
is checked against the encoded form over every pair of a set of keys chosen to break it.

## What this does not do

It does not compute values. `map` and derived values are a separate surface, and what
propagation costs gates their internals. A scope narrows delivery; it never recomputes
anything.

## What would reverse this

A case where prefix matching cannot express a real narrowing, most likely a pattern with a
wildcard in the middle. That would extend the matcher, not replace the model.
