# 034: The authority index is resident, holds attach edges only, and is fed accepted commits

Superseded by design 057. The parent-pointer measurement stands for anything that indexes
attach edges.

## Decision

`schema` keeps a document index: for every observable it has seen, the parent that attaches it
and the slot it sits in. `pathOf` walks up that chain. The index is maintained from the stream
of commits that were accepted and applied, one fold per commit, and is never rebuilt.

It holds attach edges and nothing else. Not slot values, not kinds, not aliases.

`record(index, commit)` is the fold, and it is called after the commit was applied, never
before. Feeding it a commit that would give an observable a second attach edge throws
`multiple-attach` rather than recording a document that cannot exist.

`schema` depends on `@aweftjs/codec` and on nothing else. It does not import `core`, and a
validator never touches a live document.

## Why

**Resident, because rebuilding is four orders of magnitude more expensive.** Measured against
a document of 31,002 observables: rebuilding the index costs 57,486 us per
commit and extending it with the commit's own attachments costs 3.1 us. At the rate a
collaborative editor commits, the rebuild is not a slower option, it is a different product.

**Parent pointers, not cached paths.** Measured on a document of 30,941 observables:
detaching and re-attaching a 2,380-entry branch costs 0.07 us with parent
pointers and 1,098 us with a full-path cache, because the cache has to invalidate every
descendant while the pointer index flips one entry. The cache buys 0.15 us per authority check
and breaks even only past roughly 7,000 checks per subtree move, which no editing pattern
reaches. The walk up is O(depth): 0.19 us at depth 4.

**Attach edges only, because that is all authority reads.** Design 010 makes where an
observable lives a walk up one chain, so the index needs one parent and one slot per
observable and nothing else. Holding values too would make `schema` a second applier with a
second copy of the document, which is the memory cost and the drift risk that buys nothing:
authority is decided by shape.

**Fed accepted commits, and the contract is one-directional.** The index has to agree with the
document, so it is folded from exactly the commits the document took, after each one is
applied. Recording first and applying second would leave the index ahead of the document
whenever the applier refuses. This is a contract a caller can break, so the fold refuses the
one breakage it can see, and the suite checks the rest: every fixture commit is validated
against the resident index and against a from-scratch rebuild of the same history, and the two
verdicts must agree.

**No dependency on `core`.** A validator is a function of an actor, a policy, an index and a
commit. Design 009 established it needs nothing from the runtime, and keeping that true
means the server side can judge a commit before deciding whether to build anything from it,
and a document restored from persistence can be judged by whatever holds its history.

## What this costs

One index entry per observable the document has ever held, including detached ones, which is
the same growth core accepts for the same reason: an observable that comes back is one delta
rather than a re-send. The two grow together, so a policy for
collecting one is a policy for collecting both.

A caller that applies a commit and forgets to record it gets an index that silently disagrees
with its document, and the disagreement shows up as an authority answer about a stale path.
The fold catching double attachment catches the common shape of that mistake and not all of
it. `sync` owns the pairing when it lands, so this is a documented contract now and a
structural one then.

## What would reverse this

A document whose attach index does not fit in memory beside the document itself, which would
make the index a store concern rather than a resident one. Or `sync` finding it cannot seed an
index for a document restored from a snapshot rather than from its commits, which would call
for a seeding entry point rather than for a different index.
