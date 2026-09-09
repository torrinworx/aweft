# 015: A commit closes with the mutation, or with the atomic block

## Decision

One mutation is one commit. Mutations made inside `atomic(fn)` are one commit, whatever the
call graph inside `fn` did. Nested `atomic` joins the block already open and closes with it.

A mutation takes effect in the tree as it is written, so the code doing the mutating reads
its own writes. Listeners are notified once, after the block closes, with the coalesced
commit.

If `fn` throws, every mutation it made is rolled back, no commit is emitted, and the error
propagates. Nodes the block created and attached leave the document with it.

## Why one mutation is one commit

The alternative is closing a commit at the end of the synchronous block, which would batch
two unrelated assignments that happen to be adjacent. That makes atomicity depend on where a
line sits rather than on what the author asked for, and it means a listener's view of what is
atomic changes when someone reorders code. Making the author say `atomic` costs a wrapper and
buys a stated boundary.

The consequence is stated in `docs/architecture.md` and holds: two assignments outside a
block are two commits, and a listener sees the state between them. The primitive that avoids
that has to be short enough that people reach for it, which is why it is one word.

## Why a throwing block rolls back

`spec/format.md` 3.1 forbids applying a commit partly. A block that threw halfway and left
its changes standing would either emit a commit the author never completed, or leave the tree
holding changes no commit describes. Both break the rule that every change to state is a
delta some commit carries.

The rollback restores slots from the prior values the block already recorded for its inverse,
so it costs nothing that was not already being kept.

Rollback covers state. It cannot undo what user code did elsewhere, and it does not try.

## The cost

An application making many small writes in a loop, outside a block, emits many commits. That
is the honest reading of what it asked for, and `atomic` is how it asks for the other one.

## What would reverse this

Evidence from a real application that the per-mutation commit rate is the bottleneck and that
authors reliably forget `atomic`. The answer then is a coalescing emitter in `sync`, not a
change to what a commit means here.
