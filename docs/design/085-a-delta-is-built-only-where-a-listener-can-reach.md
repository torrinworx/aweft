# 085: A delta is built only where a listener can reach

## Decision

A closing commit builds a delta for a touched slot only when some listener on that document
could be given it.

The document root records one number, its reach: the deepest a delta can sit below a listener's
own observable and still fall in that listener's scope. A shallow scope with no wildcard names
its own depth. Anything else (a deep scope, or any wildcard) is unbounded. Registering a
listener raises the number and never lowers it.

Closing a commit then walks up the attach path from each touched observable, at most reach
steps, and looks for any observable that has a listener. Finding none means every listener on
the document would have discarded a delta about that slot, so no delta is built for it.

A rule on the document turns the whole thing off for that document. An interceptor is handed
the commit, not a scope, so it reads every delta and there is nothing to prune against.

**The invariant, which is what this design is really about: a listener's delivery never
depends on which other listeners exist.** Registering a second listener, or removing one, does
not change one byte of what the first is handed.

## Why

Two of every three deltas a create builds are for slots no shallow listener wants. A page
watches the list it renders and each row's own fields; the slots inside a newly attached row
are three steps below the array's scope and are discarded after being built, inverted, ordered
and grouped. Measured: making 10,000 row objects and pushing them into a watched document
array went from 61 ms to 31 ms, and the
delivered delta stream stayed byte for byte identical across eleven scope shapes.

The walk is bounded by the reach, so the check costs a step or two per touched observable in the
shape it pays for, and a document with any deep listener on it pays a walk it was doing anyway
in `collect`.

Reach only rises because a listener that leaves is not worth the bookkeeping to find out
whether it was the deepest. The consequence is that a document that once held a deep listener
prunes nothing afterwards, which is the safe direction: it builds deltas nobody wants rather
than skipping ones somebody does.

## What this costs

The root carries one more number, and `addListener` writes it. A document whose only listener
is a deep scope, or any wildcard, prunes nothing and pays one comparison per touched
observable.

Nothing an interceptor sees changes, and nothing a watcher sees changes. What changes is only
the work done for slots that were being discarded.

## What would reverse this

A listener shape where the depth below the base is not bounded by the scope's own length, so
the reach number stops being an upper bound. Every such shape today is a wildcard, and a
wildcard is unbounded already. A new scope combinator that matched below its own depth without
setting `wild` would break this, and the answer would be to make that combinator unbounded too.
