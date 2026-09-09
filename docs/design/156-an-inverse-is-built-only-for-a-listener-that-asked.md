# 156: An inverse is built only for a listener that asked

Narrows design 016 and the close of design 084.

## Decision

A watcher says up front whether it wants inverses: `watch(fn, { inverse: true })`. A change
delivered to a listener that asked carries `inverse()` exactly as design 016 describes,
built from the prior values captured while the commit was applied and, for a subtree the
commit took out of the document, from the slots copied as the commit closed.

A change delivered to a listener that did not ask has an `inverse()` that refuses, with a
reason and the remedy of passing the option. When no listener on a document asked, the
commit builds no inverse at all: no prior-value capture beyond what applying needs, and no
copy of a dropped subtree at close.

`sync`'s tracker asks, because it hands `undo` to its channel. The DOM list, `store`,
`schema` and the recipes that only read `deltas` do not. The core README's undo example
passes the option.

## Why

The copy at close ran on every commit that dropped anything, whether or not anyone would
ever ask, and the prior-value capture ran on every delta. The only code in the repo that
calls `inverse()` is `sync/src/track.ts`. `materialize` and `entryFor` were 4 MB of the
allocation during create 10,000.

Measured with the change: clearing 1,000 rows in Node costs 0.36 ms with no
listener, from 0.91, and stays at 0.88 ms under a shallow watcher that did not ask, because
that watcher's delivery is the rest of the cost. On the framework row table the clear line
moved from 30.0 to 28.0 ms, same run. The larger clear gap once put down to this copy is
elsewhere: the document idiom's row teardown, not the commit.

Design 016 chose to capture at close rather than on request because a later listener in
the same delivery may already have mutated the tree. That reasoning stands; this note
keeps the capture where it was and adds the question of whether to do it at all, answered
once when the listener registers.

## What would reverse it

A listener that needs an inverse it did not ask for and cannot register earlier. There is
none; a listener that reaches `inverse()` without the option is told what to pass.
