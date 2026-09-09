# 087: `atomic` holds a list cell's deliveries

## Decision

A mutable array edited inside `atomic` delivers once, when the block closes, with the changes of
every call in it, in the order the calls were made. Outside a block nothing changes: one call is
one delivery.

So a swap written as two index assignments

```js
atomic(() => { const t = rows[1]; rows[1] = rows[998]; rows[998] = t; });
```

reaches `watch` as one list of two `replace` changes, and a binding that consumes it moves two
rows instead of rebuilding one of them.

A watcher hears exactly the changes made after it subscribed and before it unsubscribed, so one
that subscribes part way through a block is told the rest of that block and one that
unsubscribes inside a block is told nothing.

The list itself is not rolled back when the block throws, so its deliveries are not dropped
either: the changes queued inside a block that threw are delivered after the rollback, and the
error the block threw is the one that reaches the caller. Rolling back the document while
telling nobody what the list did would leave every watcher permanently describing a list that
does not exist.

**A plain cell's marks are not held.** `mutable(x).set(v)` has no delivery beside its mark, and
a derived value that is being watched reads its cache until the mark arrives. Holding the mark
would make a live derived value read the old value inside the block that just wrote it, which
is exactly what design 015 promises does not happen: the code doing the mutating reads its own
writes. A mutable array has both, so its marks keep firing at once and only its change lists
wait.

## Why

`atomic` means one commit and one notification. A list cell is the one thing inside a block
that would otherwise notify per call, so a batch of edits made under one block would arrive as
a batch of deliveries, and a consumer would have no way to see them together. A list binding
is exactly such a consumer: it reuses a record when one change list both takes a value out and
puts it back, and two separate lists give it no chance to.

Delivery already goes through the same deferred queue as everything else in core, so holding it
is a matter of when the job is queued, not of a second mechanism.

## What this costs

A watcher on a list edited inside a block hears about the edits after the block, not during it.
Code that reads the list from inside such a watcher sees it as the block left it rather than
mid-block, which is the same thing a document watcher already sees.

The asymmetry with a plain cell is real and is documented in the README beside `atomic`: a cell
notifies inside the block, a list waits for it. The reason is the read-your-own-writes rule
above, and the day a cell grows a delivery separate from its mark, that delivery waits too.

## What would reverse this

A consumer that needs to act on each list call separately even inside a block. It has the
information either way, since one delivery carries the calls in order, but if the boundaries
between calls turn out to matter, the change list would need to say where one call ends.
