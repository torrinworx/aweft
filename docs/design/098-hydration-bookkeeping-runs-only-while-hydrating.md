# 098: Hydration bookkeeping runs only while hydrating

## Decision

`props.ts` records what it records only while a hydration is running.

Three things would otherwise be written on every element the binding made, on every path: the
node into a `WeakSet` of nodes the binding made, each `$name` property onto a list on the node,
and each attribute a scope or cell drives into a set on the node. Only `hydrate` ever reads
any of them (`hydration.ts:126,187,192`), and a page that mounts never hydrates.

One flag in `props.ts` says whether to record. `withRoot` in `mount.ts` sets it from
`root.hydration`, beside where it already sets the active document, and restores it on the way
out. That is the one place every mount and every delta delivery passes through, so a row built
from a delivery is covered the same as a row built inside the first `mount` call.

Outside every mount the flag is on. `h` can run before anything has said what will happen to
the node it makes: `hydrate(target, h('main', ...))` builds the element first and hydrates
second, so a fresh element made at the top level has to be marked in case a hydration takes it.

The hoisted template asks the flag rather than paying the no-op. `template.ts` clones a
prototype and then walks every node of the clone calling `markMade`, because `cloneNode`
carries none of the marking. Under this rule that walk would call a no-op on every node of
every instance whenever the mount is not hydrating, which on a compiled page is every mount. So
`template.ts:163` asks `isRecording()` and skips the walk instead of running it to do nothing.
The condition is the flag itself, not `hydrating()`, so an instance made outside a mount is
still marked and still claimable.

## Why

Per element and per property, on the hottest path the binding has. Measured with
`bench/perf-lab.ts`, five invocations, medians, on this machine: creating 10,000 rows in
Chromium went from 142.9 ms to 111.8 ms, creating 1,000 from 13.3 to 10.4, replacing 1,000
from 13.2 to 11.5, filling a 1,000-row list cell from 5.3 to 3.5. Nothing in the script
regressed.

Two narrower gates are wrong.

- Recording off by default and on inside `hydrate()` fails two of the package's own hydration
  tests, because `hydrate(target, h('main', ...))` evaluates `h` before `hydrate` runs.
- Recording off inside a top-level `mount()` passes every test and is worth nothing on the
  clock, because a list's rows mount from a delta delivery, not from inside the `mount` call.

Skipping the hoisted template's mark walk is a smaller, separate number, and it is only
visible on the compiled path, which is why it cannot be seen from either package alone.
Measured with `bench/perf-lab.ts`
on the `compiled:` lines, five invocations of each configuration run alternately, medians on
this machine: creating 1,000 rows 6.2 ms with the walk skipped against 6.7 ms with the walk
run, and replacing 1,000 rows 6.6 ms against 7.2 ms. The gated configuration was the faster
one in four of the five paired invocations on each of those two lines. On creating 10,000 rows
the two are indistinguishable here, 91.1 ms against 91.4 ms with an 11 ms spread across
invocations, so the saving is real at the grain the clock can resolve it and is not worth
claiming at the larger one. The benchmark row is eight nodes, so the walk is roughly eight
thousand no-op calls per thousand rows.

## What this costs

`hydrate` accepts less than it did. A node built under a mounted root, kept, and later handed
to `hydrate` is not marked as one the binding made, so hydration treats it as the
application's node and inserts it rather than claiming the server's node in its place. Nothing
in the suite does this and arranging it takes deliberate effort, but it is a real narrowing.

The reachable case is the one that still works: an element built outside any mount and handed
straight to `hydrate` is marked, because recording is on outside a mount. That holds for a
hoisted instance too, and `packages/dom/tests/internal.compiled-row.test.ts` fails if the mark
walk is dropped rather than gated.

## What would reverse this

A use for the bookkeeping outside hydration. Anything that needs to ask, on a mounted page,
whether the binding made a node or which properties it set would have to turn recording back
on, and then the flag becomes a per-root setting rather than a per-root fact.


---

**Amended by design 157.** Recording is off outside every mount. The one caller shape this
note kept the flag on for, `hydrate(target, h(...))` with an element built before the call, is
no longer claimed: `hydrate` takes a component call or a function that makes the item.
