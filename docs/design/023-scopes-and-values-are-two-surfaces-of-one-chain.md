# 023: Scopes and values are two surfaces of one chain

## Decision

The observer chain grows a second surface. A **scope** is about a place in a document: it
delivers commits to `watch`, and `get`, `set` and `path` read and write what the path names.
A **derived value** is about a value: `map(fn)` and `all([...])` produce one, its `watch`
delivers the value itself, and there is no commit because nothing happened to a document.

`map` on a scope is the bridge from the first surface to the second. Both surfaces carry the
same value combinators (`map`, `unwrap`, `bool`, `def`, `defined`, `selector`, `setter`,
`throttle`, `wait`, `isImmutable`), so narrowing and deriving compose in either order.

A derived value is **memoized while observed and recomputed on read while not**:

- While anything watches it, it holds a cache. A source change marks the chain dirty without
  running user code; one trailing delivery job settles the graph and notifies. A recompute
  that produces the same value (`Object.is`) does not propagate: versions stop a no-change
  from spreading (deduplication happens at the transform, once, and nowhere else).
- While nothing watches it, it holds no subscription and no trusted cache, and a read
  computes. Within one top-level read, nodes settle at most once (a read epoch), so a shared
  subgraph costs its size, not its path count.

Settling is two-phase on purpose. All of a commit's deliveries mark before any derived value
settles, so a value combining two branches of one document never computes against half a
commit.

## Why

Measured with `bench/derived.ts`: the memoizing push-pull design lands between 1.05x and 1.26x of
the fastest signal library measured on the shapes where caching can pay, and recompute-on-read
falls 37x behind as soon as two nodes share an input, failing to finish at twenty layers. So
caching while observed is not optional. Recompute-on-read wins the read-once shapes, which is
exactly the unobserved case, so that is what the unobserved case does.

Delivering values rather than synthetic commits keeps the commit type honest: everything a
`watch(change)` sees can be encoded and sent. A fabricated delta describing no document
change would need machinery on every consumer of the wire to say "except these".

The derived surface registers where it reads, per the delivery-cost measurement in
`packages/core/README.md` (flat at the node, linear at the root).

## What this costs

`watch` means two things depending on the surface: commits on a scope, values on a derived
chain. The types make the difference visible, and each surface's `watch` delivers the safe
default for what that surface is about.

A transform must be pure per source value. What it reads beside its argument is not tracked
and will not recompute it. This is documented rather than enforced.

## What would reverse this

A measured workload where the unobserved recompute path dominates real usage, which would
argue for version bookkeeping on unobserved chains. Or the DOM binding needing commit
granularity from derived values, which would reopen value delivery.

## Revised: the idle cache is validated by a write clock

Measuring the shipped surface in `bench/derived.ts` triggered this design's own reversal
condition: with a per-read epoch, sibling unobserved reads of a
shared layered graph each recomputed the whole cone, 27.79x the fastest library at twenty
layers. The unobserved recompute path dominated a workload after all.

So the idle cache is kept and validated against a global write clock: any commit or cell
write moves the clock, and an idle read trusts its cache exactly when the clock has not
moved since it was stamped. Nothing is subscribed while unobserved, which is what the
original text was protecting; what changed is that "a read computes" became "a read after
a write computes". Re-measured: the layered shapes fall to 1.47x and 1.71x, and the deep
chain, wide fan out and live effects shapes are the fastest measured, at 1.00x, 1.08x and
1.00x.
