# 030: The delivery plumbing is not public

## Decision

The listener registry, the attach and reroot walkers, the dispatch queue and the touch
records stay internal to core. The public ways to hear about change are the two surfaces of
design 023, and the public way to feed change in is `apply`. No low-level listener
attachment, link table or dispatch hook is exported.

## Why

Every consumer found for such plumbing is better served by an existing public seam: mirroring
a document is `watch` plus `apply`, tooling that wants the whole stream watches the root, and
narrowing is the scope grammar. Exporting the plumbing would freeze its shape, and its shape
is exactly what the open delivery-cost question may still change: whether a scope registered
at the root can be made as cheap as one registered at the observable it is about.

A public surface is a promise; this one would promise the most volatile layer in the package
to callers who each have a supported alternative.

## What this costs

A future consumer with a genuinely new need has to come through an escalation and get a
designed seam, which is slower than reaching for an internal. That is the intended speed.

## What would reverse this

A consumer inside the stack (the replication or persistence layer) demonstrating a need the
public seams cannot meet without measurable waste. The design for that seam would supersede
this one for the specific surface it opens.
