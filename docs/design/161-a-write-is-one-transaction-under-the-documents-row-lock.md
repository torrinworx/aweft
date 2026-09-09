# 161: A write is one transaction under the document's row lock, and what the tables hold

## Decision

**The tables.** One row per document: its name, its root id and kind, and its head sequence.
One row per observable: the document, the id, the kind, the parent and slot that attach it, and
its slots as one jsonb value. One row per tail entry: the document, the sequence, and the
commit's bytes as bytea. One row per projected field: the document, the field, and the value
held in typed columns so that an index orders it the way `compare` orders (null, then boolean,
then number, then string, each kind ordered within itself), followed by the document's name so
the order is total. And a version row.

**A write is one transaction.** Lock the document's row, take its head plus one as the
sequence, merge each patch into its observable's row slot by slot (set what it sets, remove what
it unsets, apply the edge only when the patch carries one), insert the tail entry, write the
projected fields the write carries, move the head, commit. A write to a name nothing holds
creates the document row inside the same transaction; a write naming a root the stored document
does not have is refused with `root-conflict` and changes nothing.

**`create` is one insert** that does nothing on conflict and reports whether it inserted, so of
many processes opening one name at once exactly one creates it.

**The tables are made on the first call that needs them**, which is `declare` whenever a store
made the driver, and once per driver. A conformance check writes without declaring anything, so
the tables cannot wait for `declare` and still let the suite say what a driver has to do.

**Two advisory locks, and they are not the same kind of thing.** The install takes one because
`CREATE TABLE IF NOT EXISTS` is not a no-op while another process is inside its own: the two
collide in the catalogue on `pg_type`, and three drivers declaring at once on a bare schema fail
with a duplicate key. That is a guarantee, and `packages/store/tests/postgres.test.ts` pins it
with three drivers over three pools on one schema; removing the lock turns that test red. The
reconcile takes the same lock so that two processes declaring at once take turns rather than
interleaving a recompute with a delete, which is a cost paid for tidiness: every statement it
runs is idempotent on its own, and nothing could be shown to break without it.

**`find` answers one condition through the projection's index**, seeks past a cursor by the
value the cursor carries and then by name, and hands back every projected field of each hit.
`scan` orders by name and seeks past the name the cursor carries.

## Why

**The row lock is what makes the sequence contiguous.** Design 047 records that `MAX(seq)+1`
races under read committed and two appends collide on the key; the prototype hit exactly that.
Locking the document's row serialises every writer of that document at the one point that
must be serial, and nothing else waits. Measured in a probe of this shape: four
writers, eighty writes on one row, nothing lost, head 80, 28 ms in all.

**Slot by slot, because that is the whole design.** A row written whole would lose one writer's
slot to another's, which is the failure design 047 was written against, one level down. A
jsonb merge under the lock changes only the slots the patch names.

**A typed projection rather than a jsonb index.** Postgres orders jsonb values with null first
and strings before numbers before booleans; `compare` orders null, boolean, number, string.
An index over jsonb would page in an order no other driver produces, and the conformance suite
would catch it. Typed columns with a kind rank order the way every driver has to, and the text
column is collated `C` so that strings order by code point rather than by the locale initdb
picked. One table and
one composite index serve every declared field, where an index per field was what cost 3.3 MB
against 2.2 MB of rows in the R2 measurement (design 049).

**Everything in the transaction, because rows that disagree with the tail is the one corruption
this design can produce** (design 047), and a transaction is what rules it out.

## What this costs

One round trip per statement inside the transaction. Measured by `bench/store-postgres.ts`,
editing one field of one record: 0.17 to 0.34 ms and 0.7 KB of write-ahead log per
write, flat between a 151 KB and a 624 KB document. That is five to six times the latency of
the single statement design 047 measured, because it is the whole write (lock, merge, tail,
projection, head, commit), and it is still a thousandth of what a whole-document write cost at
the larger size. Folding the statements into one is not done: nothing waits on it, and a driver
with eight statements is easier to read than one with a single query doing all of them. A
document's sequence is an integer, so a document holds at most about two billion commits, which
the tail's truncation makes moot. The projection needs one more query per page to gather every
field of the hits, which the driver does rather than asking the store to.

## What would reverse this

A consumer whose write rate makes the round trips the cost that matters, which would fold the
patches into one statement and re-run the bench. A second SQL target, which would decide what
stays in this file and what becomes shared.
