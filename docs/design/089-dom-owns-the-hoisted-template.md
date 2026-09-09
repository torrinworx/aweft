# 089: `dom` owns the hoisted template

## Decision

`dom` exports `template(spec, edits)`. It takes the static shape of a subtree and a list of the
places something varies, and returns a function that makes one instance per call. The static
hoisting pass in `build` emits a call to it and never emits a `cloneNode` of its own.

`template` holds one prototype per document, in a weak map keyed by the document `h` would have
made nodes in. It then decides per mode:

- a browser document: build the prototype once, `cloneNode(true)` per instance
- the light tree, which has no `cloneNode`: build each instance from the spec
- hydration, whatever the document: build each instance from the spec, marked as the binding's
  own, so `claim` pairs it with the server's node and adopts in place

An instance is exactly what `h` would have returned for the same subtree: the element itself
when nothing in it turned out to be reactive, and otherwise one value carrying the element and
every signal below it (design 093).

## Why

A prototype held at module scope is the singleton bug `docs/architecture.md` already bans for
the head system: a server rendering two pages at once shares one, and one of the two pages gets
nodes belonging to the other's document. Keying the prototype on the active document is the same
fix the head system gets, applied where the node actually comes from.

The transform cannot make this choice instead, because it would have to emit different code for
a server build than for a client build, and then one source has two outputs and a page can be
validated under one and run under the other.

Cloning is worth the export. Measured in Chromium, best of seven, 10,000 rows of the benchmark
row shape: eight `h` calls per row cost 94.4 ms, one clone with `h` called only where something
varies costs 20.1 ms. Raw DOM primitives are 17 ms of the 74 ms saved; the rest is `h`'s own
per-element work, which the clone also removes.

Hydration builds rather than clones because `claim` only adopts a node the binding made, and
marking a clone means walking it, which costs what the clone saved. A built instance is the
same tree by construction, and hydration happens once per page while cloning happens once per
row.

## What this costs

One more name on `dom`'s surface, and a spec format shared between two packages: a change to it
is a change to both. The spec is a plain array of arrays, so it is data rather than code, but it
is still a contract.

An application that writes `h` by hand and never runs the transform pays nothing and sees
nothing: `template` is what the transform emits, not what a page writes.

## What would reverse this

A document that is a browser document in every way that matters but does not clone faster than
it builds, which would make the browser branch pointless. Or a hydration path that could adopt a
node it did not make, which would let hydration clone too.

## Amended

**Every instance is marked as the binding's own, whichever way it was made, including a clone.**
This note said hydration builds rather than clones because "marking a clone means walking it,
which costs what the clone saved". The cost is real and it is not that large, and leaving a clone
unmarked was a defect: a page builds its top-level item before it hands it to `hydrate`, so
`hydrating()` is false while that item is made, the clone path runs, and `claim` then detached
the server's markup and rebuilt it instead of adopting it. Nothing said so. `h` marks
unconditionally and a hoisted template did not, so replacing `h` calls with a template silently
turned hydration into a re-render.

Measured in Chromium, best of seven, 10,000 rows of the benchmark row shape, with
a script that was not committed (the committed numbers are in the amendment below): eight `h` calls 51.0 ms, one template instance 34.4 ms,
`cloneNode(true)` alone 8.2 ms, `cloneNode(true)` with the marking walk 17.0 ms. So the walk is
8.8 ms per 10,000 rows, about a third of what the hoisting saves and not the whole of it.

The three modes are unchanged. Hydration still builds rather than clones, now for the plainer
reason that it happens once per page while cloning happens once per row, so the mode that is not
in the hot path does not need a prototype it would use once.

## Amended again

**A clone is marked only where a mark will be read, and the numbers move to a committed script.**
The amendment above says an instance is marked "whichever way it was made, including a clone",
and gives the walk as 8.8 ms per 10,000 rows, citing a script in `.scratch/` that no reader has.
Both need correcting.

Design 098 gates the hydration bookkeeping on the root: inside a mount that is not hydrating
nothing ever reads which nodes the binding made, so `markMade` files nothing and walking a clone
to call it is the whole cost of the walk for none of its value. `template` asks `isRecording()`
before it walks. What is left marked is what has to be: an instance made outside any mount, which
is where a page builds the item it then hands to `mount` or `hydrate`, and an instance built
during a hydration. A list's rows are built inside a mount and pay nothing.

Measured by `bench/hoist.ts`, committed, 10,000 rows of the benchmark row shape in Chromium, best
of five invocations of best of seven: inside a mount, eight `h` calls 28.5 ms against one template
instance 13.4 ms. Outside any mount, where both mark, 43.1 ms and 29.8 ms. The walk on a clone is
the gap between the two template lines, about 16 ms per 10,000 instances.

The three modes are unchanged.
