# 025: A scope step can be a wildcard

## Decision

Two chain builders extend the scope grammar of design 017:

- `skip(count = 1)` matches any `count` consecutive steps.
- `tree(key)` matches any number of steps (including none) followed by `key`.

Both compose with `path`, `ignore` and `shallow` exactly as literal keys do, because they are
keys in the same list: `observer(board).skip().path('done')` scopes every column's `done`
slot; `observer(doc).tree('draft')` scopes a `draft` slot at any depth.

A scope containing a wildcard names many places at once, so it has no single value: `get()`
returns `undefined`, `set()` throws, and `isImmutable()` is true. `watch` and `effect` work
unchanged, and `map` over such a scope derives from `undefined`, which is defined rather than
an error.

## Why

Watching a shape rather than a place is a real job: every `done` flag on a board, any `draft`
anywhere in a document. Without wildcards each caller enumerates slots and re-enumerates on
every structural change, which is a subscription manager every application writes badly once.

Making them steps in the existing grammar means delivery, `ignore` and `shallow` need no
second code path for meaning, only the matcher learns two step kinds. Matching a pattern with
`tree` in it backtracks, and the fast path (no wildcard in the scope) stays the plain
comparison it is today.

The read rule follows from the grammar: a multi-target scope is a set of places, and a set
has no one value to return or write. Returning `undefined` rather than throwing means a
derived chain over a wildcard scope degrades to its `def` fallback instead of crashing.

## What this costs

A wildcard listener is checked against every delta that passes its base on the way up, and
the check is the backtracking matcher rather than the flat comparison. The cost lands only on
scopes that use wildcards.

## What would reverse this

The open question of whether a scope registered at the root can be as cheap as one
registered at the observable it is about, if it is ever answered by indexing listeners on
their first key: a wildcard first step defeats that index, which would argue for registering
wildcard scopes differently or constraining where a wildcard may appear.

## Amended: wildcards respect leading-underscore privacy

The rulebook has always said a leading underscore makes a slot runtime-private from
wildcard observers, and before wildcards existed no observer implemented it, so the sentence
was a guarantee with no code. Now a wildcard step never consumes an object slot whose key
starts with an underscore, neither `skip`'s single step nor the run a `tree` swallows on its
way down. An explicit key still names one, `tree('_x')` included,
because privacy here is from wildcards, not from everyone. Proven to fail: removing the
filter turns two tests red.
