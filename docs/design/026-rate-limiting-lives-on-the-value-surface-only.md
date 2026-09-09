# 026: Rate limiting lives on the value surface only

## Decision

`throttle(ms)` (at most one delivery per window, trailing edge kept) and `wait(ms)` (deliver
`ms` after the last change) exist on derived values and cells only. A scope's `watch`, the
one that delivers commits, cannot be rate limited: there is no combinator that does it, so a
replication path that drops commits is not expressible through this API.

Reads are never delayed: `get()` on a throttled chain reads the current value. Only delivery
is shifted.

## Why

A rate limiter coalesces a burst into fewer deliveries. On a value that is what the caller
asked for. On a commit stream it is divergence: a receiver that misses one commit of a burst
holds a different document forever after, and nothing later says so. A rule saying "do not
throttle a sync path" would be documentation guarding a foot-gun; the type split removes the
foot-gun instead. Anyone who wants throttled interface updates derives a value first, which
is what they were doing with the commits anyway.

## What this costs

Throttling "the raw commits" for a UI concern requires deriving a value from the scope first
(one `map`). That one step is the visible marker that the commit stream ends there.

## What would reverse this

A real consumer that needs time-sliced commit batches (a history compactor, for instance).
That belongs in the layer that owns replication, stated as batching with nothing dropped,
not as a lossy limiter in core.

## Amended: the combinators sit on the scope too, and the marker is the type

`throttle` and `wait` are callable directly on a scope, without an explicit `map` first.
That does not reopen the hole this design closes: what they return is the value
surface, whose `watch` delivers values, so no commit can be dropped whichever way the chain
was spelled. The original text made the extra `map` step carry the "commit stream ends
here" marker; the marker is really the return type, and one ceremony step bought nothing
the types were not already saying. The invariant stands exactly as the title states it: no
combinator exists that rate limits commit delivery.
