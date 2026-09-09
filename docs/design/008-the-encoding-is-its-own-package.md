# 008: The encoding lives below core, in its own package

## Decision

`@aweftjs/codec` holds the encoder, the decoder and the id scheme. It is tier 1, below
`core`, which moves every other package up one tier in `boundaries.json`.

## Why

The encoding is the normative artifact and has no reactivity in it. Keeping it separate
means three things:

- The conformance suite can exercise the format without constructing an observable, so the
  fixtures gate the format rather than the runtime that happens to use it.
- A port to another language has one package to match, with a stated surface.
- `core`, `sync` and `store` all need it. Putting it in `core` would make `store` depend on
  reactivity to write bytes to a disk.

Same-tier peers may import each other, so leaving `codec` and `core` both at tier 1 would
have permitted `codec` to import `core`. Renumbering keeps the tier a real ordering.

## What would reverse this

The codec turning out to be inseparable from the runtime in practice, which would show up as
`core` needing internals the codec does not export. That is an escalation, not a merge.
