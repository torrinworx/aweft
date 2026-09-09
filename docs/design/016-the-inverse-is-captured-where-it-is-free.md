# 016: The inverse is captured where the prior value is free

Closes the "inverse recording" gap in `docs/architecture.md`.

## Decision

Every change core delivers carries its own inverse, built on demand:

```js
observer(doc).watch((change) => {
	history.push(change.inverse());
});
```

`change.inverse()` returns a commit that undoes the change, computed from prior values
captured while the change was applied. Applying it is undo; the change that undo produces
carries its own inverse, which is redo.

Nothing about the wire moves. `spec/format.md` 2.4 stands: prior values are not transmitted,
and `change.deltas` is exactly what goes on the wire.

## Why here

Forward deltas are not invertible on their own. The prior value has to be captured by
whoever holds the state at the moment of the change, and that is core, in both directions:
a local mutation reads the slot it is about to overwrite, and applying a remote commit reads
the same slot to write over it. In both cases the prior value is already in hand. Anywhere
else in the stack it would have to be reconstructed, and a layer above core cannot
reconstruct it at all.

## Why on demand rather than eagerly

The capture is a map from slot to prior value, and coalescing needs that map anyway, so a
change holds it either way. Building the inverse commit allocates a delta per slot, and most
changes are never undone, so the allocation waits until something asks.

## What it does not promise

An inverse is a commit, not a time machine. Applying an inverse after other commits have
landed can fail, exactly as any commit built against an older state can fail. Ordering that
correctly belongs to whatever keeps the history.

## What would reverse this

A measurement showing the capture costs enough to matter for consumers that never undo. The
answer then is a per-document opt-out, not moving the capture somewhere it cannot see the
prior value.
