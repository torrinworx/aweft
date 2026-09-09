# 050: A dangling alias is dropped when a document opens

Re-scoped by design 053 where it speaks of a host: the end that opens the document is the one
that drops the alias.

## Decision

When `store` builds a document from its rows, a slot holding an `alias` to an observable that
nothing attaches is left out, and so is the slot. `store` reports which slots went.

The row for the aliased observable is untouched. Design 048 keeps it, and this changes
nothing about that.

## Why

**Because the document was otherwise unopenable.** Two ordinary core calls reach it: alias an
observable, then detach it. Core is self-consistent about the result, and so is `snapshot`,
which holds what the document holds and therefore leaves the detached observable out. But the
slot holding the alias is still there, so a snapshot built from the rows names something it
does not contain, and `fromSnapshot` refuses exactly that:

```
unreachable: <id> is named but not in the snapshot
```

`open` is `fromSnapshot` over a snapshot built from the rows, so the document could not be
opened again, ever, through any part of the API.

**Because the alternatives are worse here.** Carrying the aliased observable into the snapshot
runs into `fromSnapshot`'s other rule, that an observable needs an attach path from the root.
Refusing to detach something an alias names is the privilege-freezing shape design 010 took
out of authority, reintroduced as a structural rule. Dropping the slot loses the least, and it
loses something the document could not act on anyway: a write into an unreachable observable is
already refused.

## What this costs

**A slot disappears across a restart, quietly from the document's point of view.** It is
reported at the open that drops it, so a caller can log it, and nothing else in the document
changes. In one process the alias stays until something detaches its target, so this is a
difference between a live document and a reopened one.

**Design 048 said this was no longer `store`'s question, and it was wrong.** That design
reasoned that nothing round-trips through `snapshot` to persist. True, and beside the point:
`store` round-trips through `snapshot` to **open**. The claim is corrected here rather than
left standing.

## What would reverse this

`fromSnapshot` gaining a way to take observables nothing attaches, which is already wanted for
a different reason: core has no entry point that seeds a document with observables nothing
attaches. Then a snapshot could carry both the alias and its target, nothing would be dropped,
and this design would be replaced rather than amended.
