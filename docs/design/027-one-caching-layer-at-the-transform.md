# 027: One caching layer, at the transform

## Decision

There is no separate caching combinator. `map` memoizes while observed (design 023), and
that is the only cache in a chain. `bool(truthy, falsy)`, `def(fallback)` and `defined()` are
sugar over `map` and add no machinery of their own: `def` yields the fallback when the value
is `null` or `undefined`, `defined()` yields whether it is not, `bool` picks one of two
values by truthiness.

## Why

A chain with two caching layers has to answer which one deduplicates, which one an event
passes through unchanged, and what order they may appear in. Those questions have real wrong
answers (a cache that swallows a forwarded change, a second cache going stale against the
first), and every one of them disappears when exactly one layer caches. The transform is the
right layer because it is where a same-value result is cheapest to detect: the recompute just
produced it.

An explicitly cached combinator was considered for the unobserved case and rejected: the read
epoch in design 023 already makes one unobserved read cost the subgraph's size, and a cache
trusted while nothing maintains it is a stale read waiting to happen.

## What this costs

Nothing today. If a transform is expensive and read while unobserved in a hot loop, the
caller watches it, which is the supported way to say "keep this warm".

## What would reverse this

A measured workload where watching-to-warm is not workable (for instance, a server rendering
many documents once each, where nothing is ever observed and a shared expensive transform
dominates). That would reopen the unobserved caching question with numbers.
