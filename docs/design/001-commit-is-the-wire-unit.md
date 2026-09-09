# 001: The commit is the unit that crosses every boundary

## Decision

Commits are transmitted, persisted, and validated whole. Deltas are not individually
addressable across a boundary.

## Why

A consumer that rebuilds state by applying deltas one at a time observes intermediate
states where an invariant spanning two slots is false. Applying the same deltas as one
commit does not, because every delta is validated, then applied, then observers are
notified once.

Measured: splitting a two-delta commit into two applications exposed a broken cross-field
invariant to the receiver. Applying the same commit whole did not.

## What would reverse this

Evidence that commit-granularity costs materially on the render path, where per-delta
application is what makes updates fine-grained. This has not been measured yet, and it is
the one place this design could be wrong. If it is, the resolution is that the boundary
unit stays the commit while a renderer may subscribe per delta *within* one, which keeps
both properties.
