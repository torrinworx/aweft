# 019: Terse helper aliases are dropped

## Decision

No terse aliases for common operations. Write `x.length`, `a.push(b)`, `a instanceof B` at
the call site.

## Why

The convention exists to save bytes, and measured against the real build it does not. The
alias form makes the shipped bundle **0.98% larger after gzip**.

Two things cause that. Terser shortens a helper to a one-character arrow rather than
inlining it, so every call site keeps a call and gains an import. And repeated `.length` is
nearly free to compress, because the compressor already collapses a token it has seen, which
is the same saving the alias was reaching for.

So the convention costs readability and buys a negative number. It has no defence left.

## What would reverse this

A measurement on a real bundle showing the alias form smaller after gzip, taken with the
release pipeline rather than on a fragment. The result is a property of the minifier and
the compressor, so a change to either is the thing that would move it, and the measurement
is cheap to repeat.
