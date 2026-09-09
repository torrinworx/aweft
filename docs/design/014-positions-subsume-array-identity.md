# 014: Ordered positions subsume the array identity option

Supersedes the "one observable array, identity opt-in" line in `docs/architecture.md`.

## Decision

There is one array and it has no identity option. Every element is addressed by its position
key, an ordered byte string (design 006).

## Why

The identity option existed so that an element could be tracked across inserts and removals
ahead of it, and so that two replicas inserting at the same index would not fight over an
index that means different things to each of them. A position key already does both:

- A position key does not shift. Inserting before an element changes no key, so an element's
  slot survives edits elsewhere in the array.
- Two replicas inserting at the same index generate different keys, and both survive in the
  order their keys compare, which is the same on both sides.
- An element that is an observable carries its own id regardless, so moving it between
  arrays keeps its identity without the array tracking anything.

So the option would add a second internal path to the lowest reactive tier, and buy nothing
that the format's own addressing does not already provide.

## The cost

An array of primitives cannot answer "is this the same element that was here before", since
two equal primitives in one slot are indistinguishable. That was true of the identity option
as well, which tracked slots rather than values.

## What would reverse this

A concrete case where two replicas converge to an order that a position key cannot express,
found while building `sync`. The answer to that would be a different position generator, and
only if that failed would per-element identity return.
