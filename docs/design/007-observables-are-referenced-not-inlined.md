# 007: An observable is referenced, never inlined

## Decision

A slot holds a primitive or a reference to an observable, and nothing else. A reference
carries the kind of observable and its id. A subtree arriving in one commit is one delta
naming the child and further deltas filling the child in.

## Why

Anything inlined into a slot would be state that changes without a delta addressing it, and
the whole model is that every change to state is a delta. An inlined structure would have
interior the format cannot see, so it could only ever be replaced wholesale, which is the
write amplification the delta model exists to avoid.

## Why the reference carries the kind

Two reasons, and the second is the one that forces it:

1. An observable with no slots has no deltas about it, so nothing else would say what kind
   it is. A reference that carries the kind describes it completely.
2. Section 2.3 requires a receiver to read a delta about an observable it has not
   materialized yet. Inferring the kind from other deltas would make that depend on which
   delta arrived first, and deltas in a commit are unordered.

The kind then appears in two places for a populated observable: on the reference and on
every ref addressing it. That redundancy is checked rather than trusted. Applying a commit
whose mentions disagree fails as `kind-conflict`, before anything is applied.

## The cost

An application storing an opaque blob carries it as a byte string and replaces it whole. The
format makes that explicit rather than letting it happen by accident inside a value.

## What would reverse this

A measured workload where small fixed structures dominate and per-observable overhead is the
cost, which would argue for an opaque inline container with stated replace-only semantics,
not for inlining observables.
