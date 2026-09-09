# 028: A derived value writes through a declared setter

## Decision

`set` on the value surface works only where a write path was declared, and `isImmutable()`
says whether one was:

- A cell writes itself. A scope writes the slot its path names, as it already does.
- `map` produces a read-only value: its `set` throws. `setter(fn)` returns the same chain
  with `fn` as the write path, so a two-way binding is `scope.map(parse).setter(write)`.
- `immutable(...)` never writes, whatever it wraps.
- `selector()` on a source returns `select(key)`, a per-key boolean: reading is "is this the
  selected key", and writing maps back: `set(true)` writes the key to the source,
  `set(false)` clears the source only if this key is the one selected.
- A wildcard scope (design 025) has no write path.

`isImmutable` follows the chain: a value derived from something read-only reports read-only.

## Why

An input component needs one question answered to render at all: can this be written. Making
`set` fail loudly on a chain with no write path, and `isImmutable` cheap to ask, is what lets
a form disable itself rather than throw on keypress.

The write path is declared, not inferred, because inverting an arbitrary transform is not a
thing the library can do honestly. `selector` gets a built-in write path because its inverse
is actually known: the mapping between "selected" and "the key" is the combinator's whole
meaning.

`selector` exists as its own combinator rather than `map(v => v === key)` per key because a
selection change must not cost one recompute per key: one subscription on the source flips
the two keys that changed, and ten thousand items hear nothing.

## What this costs

`setter` trusts its function to actually write the source; nothing checks that reading back
gives the value written. That is the contract of declaring a write path.

## What would reverse this

Nothing foreseeable reverses the declared-setter rule. The selector write-back convention
(true selects, false conditionally clears) is behavioral and would change with evidence from
the component library that a different convention composes better.
