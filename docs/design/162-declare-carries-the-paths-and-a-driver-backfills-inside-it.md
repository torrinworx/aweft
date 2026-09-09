# 162: `declare` carries the paths, and a driver fills the projection for what it already holds

Amends the `declare` line of design 049 and the `Driver` contract of design 047. Settles the open
question of who owns migrating stored data.

## Decision

`Driver.declare(declaration)` takes the declaration itself, field names with their paths,
rather than the names alone. It is still called once, when the store is made, before anything
is written.

A driver that holds documents from before this call **brings their projection into line with
the declaration**, inside `declare`, before it resolves. The store awaits `declare` before it
answers `open`, `find` or `scan`, so no query runs against a partial index. The memory driver
holds nothing when it is called and does nothing. The file driver in `recipes/store` does the
whole of it, which is how the contract is shown to be implementable from outside.

**A document lacks a field when it has no value for it, and equally when it holds one computed
from another path.** A field keeps its name and changes its path in an ordinary refactor, and a
driver that only asks whether a value is there keeps answering from the path that was declared
last time, silently and for as long as nobody writes the document. So a driver records the
paths it projected under and computes a changed field again, from the rows, for every document.

**A field the declaration no longer names leaves the projection.** The declaration is what the
index is built from, so `Found.fields` carries the declared fields and nothing else, which is
what every driver hands back. Declaring fewer paths therefore drops the rest, and declaring
them again costs the walk that computed them.

`store` exports `projectionOf(rows, root, declaration)` beside `compare` and `holds`: a
document's projection, computed from the rows `read` returns. It is the same function `store`
uses on every write, so a driver's backfill and the store's own writes cannot disagree.

**That question is answered this way.** The projection is derived, and its migration is
the driver's, done from the rows at `declare`. The tables' migration is the version row of
design 160: a shape the driver does not know is refused, and the fix is in the message.
Nothing else stored has a shape that changes with the declaration.

## Why

**The projection was invisible for a path declared after the data.** An earlier fix covered this
inside one process: a document opened before a path was declared joined the
index on its next write. A durable driver makes the gap permanent: a document written under
one declaration and never written again after a new one is absent from `find` on the new field
for as long as nobody edits it, while its rows hold the value. `field eq null` would not find
it either, because there is no projection row to hold the null. That is a silent wrong answer,
which is the one kind of answer design 049 exists to refuse.

**The driver is the one that has the rows and the transaction.** Backfilling from the store
would need a thirteenth method to write a projection without a commit, and a crash between two
of those calls leaves a field half projected with nothing recording it. Inside `declare` the
driver reads its own rows and writes the missing fields in one transaction, so the index is
either whole or not yet there.

**Names alone were never enough.** Design 049 already says every driver builds its own index
from the same declaration. Passing the paths is what that sentence needed.

**The helper ships because the file driver needed it.** A driver outside the package cannot
reach `store`'s internals, and reimplementing the path walk is how two drivers come to disagree
about what a path names. `compare` and `holds` shipped for the same reason (design 049,
amended).

## What this costs

A `Driver` surface change: the memory driver, the file driver and the structural `StoreDriver`
in `testing` follow, and every check in `driverChecks` calls the new shape. Declaring a new path
over a large collection reads every document's rows once, at startup, before the store answers;
the README says so. One more export on `store`.

A driver keeps a second thing beside the index: the paths it built the index from. And two
stores over one place have to declare the same paths, because the one that declares fewer drops
the projection rows for the rest. Design 160 already says a place is one application's.

The recompute reads a document's rows and writes its fields without taking that document's row
lock, so a write that lands between the two, from another process still running the old
declaration, is projected from the rows before it. Holding every document's lock for the length
of a migration would stop every writer instead. Two processes with two declarations over one
place is a deployment mid-change, and the README says to finish one before starting the next.

## What would reverse this

A driver target that cannot read all its rows at startup within a tolerable time, which would
want the backfill to run behind the store rather than ahead of it, and a way to say which
documents are still behind.
