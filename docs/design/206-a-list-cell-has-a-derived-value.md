# 206: A list cell has a derived value

## Decision

**`mutableArray` gains `derive(fn)`: a derived value of the whole list, recomputed on every edit.**

```ts
const rows = mutableArray<Session>();
const empty = rows.derive((items) => items.length === 0);

h('p', { hidden: empty.map((yes) => !yes) }, 'nothing here yet');
```

`fn` is handed the list to read and its answer is the derived value. It runs again after every
edit, and its watchers hear only the answers that changed, which is `Derived`'s own rule. Reading
it while nothing watches computes it on the spot.

**Inside an `atomic` block it settles where each edit is made, as a cell does.** Design 087
holds the list's edit list until the block closes, so a watcher gets one list per block; it does
not hold the mark, because a derived value that is being watched must never read the list as it
was before a write in the same block. So the edits arrive once and the value can arrive twice, and
that is the same split every derived value in core already has.

**The name is `derive` because the two names that read better are taken.** `map` and `filter` are
the array's own and mean something else on a list; `watch` is the edit list. `derive` says what it
answers, a derived value, in the word the rest of core uses for one, and nothing on `Array` is
called that.

## Why

An empty state is the ordinary thing a list drives, and until now reaching one meant a second cell
beside the list and a `watch` that set it, which is a copy of the list's length that can go stale,
in userspace, in every page that has a list.

The capability was already there and unreachable in one step: `all([list]).map(([items]) => ...)`
recomputes on every edit and settles by value, which is what this does. What that spelling asks a
reader to know is that a list is a source at all, that `all` takes one input as happily as
several, and that the answer arrives inside an array they then have to take it back out of. That
is not the spelling a reader finds, and `all`'s own documentation is about combining several
inputs.

So this is one name for a thing the graph already does, not a second mechanism: `derive` builds
exactly that chain. It is the one way to get a value out of a list, and `all` stays the way to
combine several inputs whatever kind they are.

## Evidence

`packages/core/tests/mutable-array.test.ts`: the value now and after every kind of edit (push,
splice, index assignment, length assignment); one recompute per edit inside an `atomic` block,
each settled where it happened while the edit list waits for the close; an answer that does not
change is not delivered while one that does is; the
unsubscribe; reading it with nothing watching, before and after an edit; and two derived values
over one list, each hearing its own answer.

Three ways to get this wrong, each caught by that file: the mark dropped inside an open block, so
a derived value goes stale until the block closes; `markAll` dropped from the ordinary delivery
jobs, so nothing recomputes at all; the clock stamp dropped, which leaves the idle cache trusted
and a read after an edit answering the value from before it.

## What this costs

One more name on a list, and one more thing to read past for someone who only wants `watch`. A
`fn` that answers a fresh object or array every time is delivered every time, because the settle
compares with `Object.is`; that is `Derived`'s rule everywhere and not new here.

## What would reverse this

A second thing a list wants that this shape cannot say, such as a derived value that follows one
row's own contents. That is a scope's job, not a list's, and it would be a design note of its own.
