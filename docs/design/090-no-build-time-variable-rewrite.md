# 090: No build-time variable rewrite

## Decision

`build` does not rewrite the meaning of expressions to save bytes. In particular it does not
turn `===` into `==`, and it does not merge separate declarations into one. It compiles markup
to `h` calls, hoists static subtrees, and removes asserts in a release build. That is the whole
list.

## Why

Every one of the dropped rewrites is a change to what a program means in some case. `===` and
`==` differ whenever the two sides are of different types, which is exactly where a subtle bug
lives, and the transform cannot tell those cases apart without types it does not have. Merging
declarations changes evaluation order when an initializer has a side effect.

The payoff was a few kilobytes on a bundle that is 40.2 KB, against a reference page at 17.2 KB,
so it would not have closed that gap either. Matching a bundle size is not promised, and this
would not have delivered it.

A transform that changes meaning is also the hardest thing to test: the equivalence suite proves
the transformed program does what the untransformed one does, and a rewrite whose whole purpose
is to differ in edge cases is a rewrite the suite cannot cover.

## What this costs

A few kilobytes on a release bundle, unclaimed. The assert strip takes 2.8 KB of the 40.2 KB and
is kept because removing a development-only check is not a change of meaning: `assert` is
specified to throw in development and to be absent in release.

## What would reverse this

A measurement showing one specific rewrite is worth a meaningful share of a real page's bundle,
together with a way to prove it safe for that page: type information the transform can trust, or
a rewrite whose two forms are provably identical for every value.
