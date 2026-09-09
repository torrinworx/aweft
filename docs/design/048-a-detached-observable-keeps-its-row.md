# 048: A detached observable keeps its row and loses only its edge

Amended by design 084, which changes what a re-attach carries; see the end of this note.

## Decision

When an observable loses its attach edge, `store` keeps its row and sets the parent and slot
to null. The slots stay.

Collecting is a sweep the application runs over rows nothing reaches from the root, on a
policy the application sets. Reachability, not the parent pointer: detaching a branch takes
the edge off its top and leaves everything under it pointing at a parent that is itself
unreachable. It is never a side effect of writing or of restarting.

A reopened document holds what is reachable, because that is all `fromSnapshot` will build.
So a commit that re-attaches an observable the reopened document does not hold is **refused**,
naming the row `store` still has. It is not applied against an empty observable.

## Why

**Because the alternative is already happening by accident, in the wrong direction.**
`snapshot` excludes an observable nothing attaches, correctly, because a snapshot holds what
the document holds. So any store that persists current state has already dropped it. Measured
on the real core: pop an item off one list, persist, restart, push it onto another list, and
the commit **applies cleanly and leaves an empty object where the data was.**

```
same process:      b[0] = {"title":"the item"}
across a restart:  b[0] = {}
```

Nothing refuses it. This is not a defect in `apply`: a value is a primitive or a reference and
never an inlined structure (design 007), so the commit that re-attaches only names the item
by id. The commits that filled it came earlier, and the snapshot dropped it. Popping an item
off one list and pushing it onto another in two commits is an ordinary thing to write, it
works in development where nothing restarts, and it loses data in production.

**Because it is the shape `schema` already uses.** The authority index keeps entries for a
detached subtree, and a lookup walks up until it hits the root or a null. A row
that keeps its slots and nulls its parent is the same shape, so the store table and the
authority index agree structurally instead of disagreeing.

**Because the peer-to-peer argument does not bind here.** The published reason not to collect
is that reachability is a global property: an offline peer may re-link something that looks
unreachable, so a local sweep destroys their work at merge time, and the policy that follows
is "once persistent, immortal". That reasoning is about peers. Replicache and Figma both
delete outright with no tombstone, and the two conditions that make it safe are an
authoritative host per document and reconnect as resynchronization. This stack has both.

## What this costs

A document that creates and discards observables grows until a sweep runs, and nothing sweeps
by default. That is deliberate: the growth is visible and bounded by a policy, where the
alternative is silent loss at a moment nothing announces.

**Re-attaching across a restart is refused rather than restored, for now.** `fromSnapshot`
refuses an observable with no attach path from the root, checked rather than assumed:
`unreachable: <id> has no attach path from the root`. So `store` can keep the row, and can
tell that a re-attach names it, but cannot put it back into the rebuilt document. Restoring it
needs a core entry point that seeds a document with observables nothing attaches, which does
not exist.

Refusing is the whole of the improvement available today, and it is most of the value: the
failure was silent and is now loud, at the moment it happens, naming the observable.

The dangling alias stops being `store`'s question. Nothing round-trips
through `snapshot` to persist, so what a snapshot containing an alias to something it does not
hold should mean is a question about `snapshot`, answered wherever that is decided.

## What would reverse this

Peer-to-peer replication without an authoritative host, where a sweep on one replica can
destroy a re-link made on another. That is a different replication model than design 042
describes, and it would want the immortality policy rather than this one.

## Amended: a re-attach now carries the contents

Design 084 drops a detached observable from core's document index when the commit that
detached it closes, and makes a later re-attach re-send its whole subtree as adds. Two
sentences of this note were written when a re-attach carried nothing but the edge, and no
longer describe what happens:

- **"Re-attaching across a restart is refused rather than restored, for now."** The commit that
  re-attaches now says what the observable holds, so a document rebuilt from a snapshot has
  everything it needs to apply it. `store` still refuses with `detached-elsewhere`, which is
  now stricter than the rule requires rather than the only safe answer. It stays until `store`
  revisits it with its own evidence: refusing loses nothing, and no consumer is waiting on the
  looser behaviour.
- **"the store table and the authority index agree structurally"** still holds for `store`'s own
  rows, which keep their slots with a null parent. What changed is core's index, which is not
  a persistence table and was never the thing this note was about.

The rest stands. Detaching is still not deleting in `store`, collecting is still a sweep the
application runs on its own policy, and the reachability rule for that sweep is unchanged.
