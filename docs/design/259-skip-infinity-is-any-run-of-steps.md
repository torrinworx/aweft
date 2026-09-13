# 259: `skip(Infinity)` is any run of steps

Amends design 025.

## Decision

`skip(count)` with `count` of `Infinity` adds one step to the scope, a run: any number of
consecutive steps, none included, each one open. A step is open when it is not an object slot
whose key starts with an underscore and not a slot the scope's `ignore` names. Every other
count keeps design 025's meaning, exactly that many steps.

When the run ends the pattern, it consumes every step down to the slot the delta names, and
the delta is delivered on its own, at its own depth. So `observer(doc).skip(Infinity).watch(fn)`
hears every public delta anywhere in the document, and never one whose path passes through a
leading-underscore slot of an object: not the slot itself, and not anything an object under it
holds. `shallow` adds nothing to such a scope, because the run already ends at the slot itself,
and it is accepted rather than refused.

When keys follow the run, it consumes as many steps as the rest of the pattern needs, so
`skip(Infinity).path('done')` hears `done` at any depth, as `tree('done')` does. `tree` stays
the shorter spelling for that job and is unchanged.

As with any wildcard, the scope names many places: `get()` is undefined, `set()` throws,
`isImmutable()` is true.

## Why

The leading-underscore rule has always said a slot so named is runtime-private from wildcard
observers, and design 025 made it true at each wildcard step. But every wildcard ended at a
depth, and a scope that ends above a delta delivers the whole subtree beneath the place it
matched: `skip()` hides `_secret` at the root and then hears `nested._token`, because it matched
`nested` and a matched place is a subtree. There was no scope that reached every public slot
and only those, which is the scope a recorder, a mirror, or an audit wants: everything the
document holds that its author did not mark private. The rule belongs in one place, and this is
what lets a consumer hold none of it.

The spelling was already on the surface. `skip(Infinity)` typechecked, read as "skip any
number", and built one step per count in a loop until the process ran out of memory. A
footgun that reads like the right answer is the worst kind, so the count that meant nothing
now means the thing it reads as.

## What this costs

The matcher backtracks over the run: a delta at depth `d` under a scope whose run is followed
by more keys is tried at up to `d` places. A trailing run is one pass down the path. The cost
lands only on scopes with a run in them, as with every wildcard.

A trailing run reads `ignore` at every step it consumes rather than at the step past the match,
which is the same rule read at every depth the scope reaches. It cannot be used to hear a
subtree while ignoring one slot at its top; `path` to the subtree first.

## Evidence

`packages/core/tests/wildcard.test.ts`: a trailing run hears a delta at depth one, three and
five, and none under `_x` at any of them, on an object, through an array and through a map, in
an atomic commit that mixes a public and a private slot, and for a subtree added in one write;
a run followed by a key hears the key at any depth and never below an underscore; `ignore` drops
a run's step and everything under it; `shallow` after a run changes nothing; `get` is undefined
and `set` throws; `skip(Infinity)` builds in constant memory. Proven to fail: removing the
open check on the run turns the private cases red.

## What would reverse this

A scope grammar that indexes listeners by their first key, which a run defeats as any wildcard
does. Or a need for `ignore` after a trailing run to mean the step past the match, which has no
step to read.
