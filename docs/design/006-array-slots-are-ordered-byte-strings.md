# 006: An array slot is named by an ordered byte string, not an index

## Decision

An array slot is addressed by a position: a non-empty byte string that must not end in a
zero byte, ordered as an unsigned byte string with a prefix sorting first. How a position
between two others is chosen is not specified.

## Why

Indices shift. An insert renumbers everything after it, so two deltas in one commit would
mean different slots depending on which was applied first, and section 3.2 requires that the
order deltas are applied in cannot change the result. This is the same reasoning that keeps
paths off a delta (section 2.2), one level down.

Comparable positions also let a receiver order an array by looking only at the positions,
with no walk of a chain and no second structure to keep consistent.

## Why the two rules

Non-empty, and no trailing zero. Together they guarantee a position exists between any two
others. Allow a trailing zero and nothing fits between a key and that key followed by a
zero, so the array acquires a place it can never grow into. Allow an empty position and
nothing sorts before it.

## Why generation is not specified

The wire only needs positions to be comparable. Two producers choosing different positions
still interoperate, because a receiver orders by comparing and never by regenerating.
Specifying generation would freeze a density and rebalancing strategy that no measurement
has been taken on yet.

## What would reverse this

Measured position growth that makes long-lived arrays expensive, which would call for a
specified generation strategy rather than a different addressing scheme.
