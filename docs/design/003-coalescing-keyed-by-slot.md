# 003: Coalescing is keyed by slot, never by time

## Decision

An implementation that merges changes before emitting a commit keys its merge structure by
slot. Merging first-and-last of a time window is prohibited.

## Why

A time-keyed strategy that keeps the first and last change of a burst discards everything
between, including changes to slots nothing else in the burst touched. Measured: a burst
writing three different slots emitted two of them and silently dropped the middle one.

A slot-keyed strategy merges only within a slot, so the three coalescing rules in the format
specification hold by construction rather than by care. Measured lossless across 2,700
commits and 16,515 deltas, covering objects, arrays, maps, nested observables, shared
references, delete-then-reinsert, and in-place mutation, in generated, shuffled and reversed
application order.

## Consequence for the format

The wire format specifies no merge rules for a receiver, because a conforming sender has
already produced a minimal, complete, order-independent commit. Adding a second coalescing
pass downstream would risk breaking a property that currently holds.

## What would reverse this

Nothing found. A time-keyed flush *trigger* is fine and useful; it decides when to emit,
while the slot-keyed structure decides what.
