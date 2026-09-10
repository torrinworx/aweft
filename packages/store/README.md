# @aweftjs/store

Keeping a document, and keeping it as it changes.

Open a document and mutate it. Every commit it produces is written when it is produced, at the
granularity of the slots that changed. There is no save interval, no flush, and no reload.

```ts
import { atomic, createObject } from '@aweftjs/core';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver() });

const board = await store.open('board:42');
const root = board.root as Record<string, unknown>;

atomic(() => {
	root.title = 'a board';
	root.owner = 'u_7';
	root.meta = createObject({ authorId: 'u_7' });     // a slot holds one of these, not a plain object
});

await store.settled(board);        // wait for the writes already in flight
```

Reopen it anywhere over the same driver and it is what you left.

**A slot holds a primitive, bytes, or an observable**, and an observable is one core made:
`createObject`, `createArray` or `createMap`. Assigning a plain object or array is refused
(`inline-container`), because a document is a graph of observables and a bare object has no
identity to give a row.

**Reach for `atomic` from the start.** Every assignment outside it is its own commit, and its
own entry in the history. Two bare assignments are two commits, so a watcher sees the document
half-changed and a replica receives the halves separately. `atomic` makes the whole block one
commit that applies whole or not at all.

**Finishing.** `close(handle)` lets go of one document. `stop()` ends the whole store and the
driver with it; nothing can be opened afterwards.

## What it holds

Three things, one job each.

**Rows.** One per observable: its id, its kind, where it is attached, and its slots. A commit
writes only the slots its deltas name, so the cost of a write follows the change rather than the
document. Measured against writing the document whole, in an embedded Postgres outside this repo
(design 047; no script here reproduces it): 0.054 ms and 3.9 KB of write-ahead log at a 620 KB
document, against 34.98 ms and 571 KB. The rows are the source of truth, and a document opens by
reading them.

**A commit tail.** Every commit, in order, with a per-document sequence: the document's
history, which an application reads through `since`. It is derived, so losing it costs a
resynchronization rather than a document, and `truncate` bounds it.

**A projection.** One record per document, one value per declared path, written in the same
transaction as the commit that changed it. This is what a query reads.

## Asking about documents

Declare the paths you will filter on, and query them:

```ts
const store = createStore({
	driver: memoryDriver(),
	declare: {
		ownerId: ['ownerId'],
		status: ['status'],
		author: ['meta', 'authorId'],     // a path may cross observables
	},
});

for (const { doc, fields } of await store.find({
	where: [
		{ field: 'ownerId', op: 'eq', value: 'u_7' },
		{ field: 'status', op: 'eq', value: 'open' },
	],
	sort: { field: 'ownerId' },
	limit: 20,
})) console.log(doc, fields.status);
```

A hit carries the declared fields the index already held, so listing what you found does not
mean reopening every document. Page with `after`, which takes the `cursor` of the last hit. A
cursor names a position in the order you asked for, not a document, so the next page carries
on even when that document has since been removed or re-ranked. It belongs to the sort it came
from: handing it to a query with a different sort is refused (`reason: 'cursor'`).

`op` is `eq`, `gt`, `gte`, `lt` or `lte`. There is no offset, because an offset re-reads what
you already saw.

**The first condition is the one an index answers**, and it does the pruning. The rest narrow
what it returned. So put the most selective condition first, and that is the whole of the
tuning advice.

**There is no query for every document ordered by a field.** A condition is required and it is
what selects; reading everything is `scan`, which orders by name.

**An undeclared path is refused.** Not scanned:

```
store: a condition names title, which is not declared. Declare it, or use scan
```

That is deliberate. A scan is not slow in the same way on two drivers: 32x on Postgres and
growing with the collection, and every record into JavaScript on IndexedDB. A query whose cost
depends on where it runs is a cliff wearing a portable API. When you do want the un-indexed
read, say so and give it a limit:

```ts
for (const doc of await store.scan(100, lastSeen)) await migrate(doc);
```

**A declaration holds literal steps only, and may not cross an array.** `['tasks', ANY,
'status']` names many paths inside one document, and a projection has one value per path per
document, so there is nowhere for them to go. Writing the position out literally does not
rescue it: an array slot is a byte string the runtime chooses and nothing keeps stable, so
`['tasks', '0', 'title']` is refused at the first write rather than indexing nothing quietly.
"Which documents have an urgent task" wants one row per match, which is a different index shape
and is not built. See design 049.

Keep a scalar on the document instead: an application that needs "the top priority in this
project" maintains that number as a slot and declares it.

**Declaring is a schema decision.** IndexedDB may only create an index during a version
change, so a path declared later is a migration rather than a lazy index build. And indexes
are not free: twenty of them came to 3.3 MB against 2.2 MB of rows at 20,000 documents.
Declaring everything is the whole-document index by another route.

## Reading the history

```ts
const missed = await store.since('board:42', session.seq);
for (const { seq, commit } of missed) send(seq, commit);
```

A sequence the tail no longer reaches back to throws `truncated` rather than answering with what
is left, because a short answer reads exactly like a complete one. Catch it and take the
document whole:

```ts
try {
	for (const { seq, commit } of await store.since('board:42', session.seq)) send(seq, commit);
} catch (e) {
	if ((e as { reason?: string }).reason !== 'truncated') throw e;
	await sendWholeDocument('board:42');
}
```

`truncate(doc, keep)` drops everything but the most recent `keep` commits. How much history
to keep is yours; nothing in the stack reads the tail on its own.

## Commits from elsewhere

```ts
import { decodeCommit } from '@aweftjs/store';

await store.receive(board, decodeCommit(bytes));
```

A received commit joins the same tail as a local one, under the next sequence. Apply it
through the store rather than around it and a commit the document refuses is refused before
anything is written.

## Detaching is not deleting

An observable that loses its attach edge keeps its row and its slots. Nothing collects it
until you say so:

```ts
if (store.orphans(board).length > 10_000) await store.sweep(board);
```

`sweep` frees the rows for good, in storage and not just in this handle. A swept observable
cannot be re-attached afterwards, which is why nothing sweeps on its own.

This is the application's call, not the store's. The growth is visible and bounded while an
automatic sweep is data leaving at a moment nothing announces.

**One limit to know about.** A reopened document holds what is reachable, because that is all
`fromSnapshot` will build. So a commit that re-attaches an observable a reopened document does
not hold is refused with `detached-elsewhere` rather than applied against an empty observable.
In one process, popping an item off one list and pushing it onto another in two commits works
and stays one delta. Across a restart it is refused with `detached-elsewhere`, even though the
commit that re-attaches an observable carries everything it holds (design 084): the refusal is
stricter than the rule requires, loses nothing, and stays until there is a reason to relax it.

## On Postgres

```ts
import { Pool } from 'pg';
import { createStore } from '@aweftjs/store';
import { postgresDriver } from '@aweftjs/store/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = createStore({ driver: postgresDriver(pool), declare: { owner: ['ownerId'] } });
```

**You hand in the pool.** Anything whose `connect()` answers a client with `query(text, values)`
and `release()` will do, which is what `pg`'s `Pool` is, so nothing is installed by this package
and nothing is imported by the subpath. How many connections it has, how it authenticates and
when it ends are yours. `close()` finishes the driver and leaves the pool alone.

**The driver makes its own tables** (`aweft_documents`, `aweft_rows`, `aweft_tail`,
`aweft_projection`, `aweft_declared` and `aweft_version`), in whatever schema the pool's `search_path` names, on
the first call, which is `declare`. Two applications on one database keep apart by schema, which
the pool already decides, so there is no option for a prefix. The role the pool connects as needs
the right to create them.

**A version row guards the tables.** A shape this driver does not know is refused before anything
is read:

```
unknown-version: these tables are version 9 and this driver writes version 1.
Point the pool at a schema this driver made, or run the driver whose version matches the tables.
```

**Declaring a new path reads every stored document once**, at startup, inside `declare`, before
the store answers anything. That is what fills in the projection for documents written before
the path existed, and it happens again when a field keeps its name and changes its path, which
`aweft_declared` is what makes visible. It is proportional to the collection, so a large one
pays it at boot, and only when the declaration actually changed. Finish one deployment before
starting the next: a process still writing under the old declaration while a new one declares
can have a write projected from the rows just before it.

**The declaration is what the index holds.** A field you stop declaring leaves the projection,
so two stores over one schema declare the same paths, or the one that declares fewer drops the
rest and the other pays the walk to put them back.

**Nothing is told that a document changed.** No notification, no `LISTEN`. Live updates go
through `sync`, and one end decides a document's commits.

**Two things Postgres will not hold.** A string containing a zero byte (`\u0000`) is one, in a
document name, a slot name, a slot value or a projected value alike. The driver refuses it
itself, before the transaction opens, with `zero-byte` and the place it found it, rather than
letting a bare database error out of a half written commit. And string ordering is by code point
(the projection's text column is collated `C`), which matches every other driver for text inside
the basic plane.

Tested against Postgres 18, started per run by `embedded-postgres`; both it and `pg` are
development dependencies of this package and neither ships. Measured by
[`bench/store-postgres.ts`](https://github.com/torrinworx/aweft/blob/main/bench/store-postgres.ts)
on one machine, editing one field of one record over and over, two runs back to back:

| Document | Per write | Write-ahead log per write |
|---|---|---|
| 151 KB | 0.310 and 0.335 ms | 0.71 KB |
| 624 KB | 0.257 and 0.169 ms | 0.70 KB |

Flat in the size of the document, which is the whole point of design 047: the two document
sizes differ by four times and the numbers do not separate. A declared read against 20,000
documents is 0.29 to 0.36 ms through the index, and the same script prints the `EXPLAIN` showing
the index-only scan it takes.

## Writing a driver

A driver is twelve methods: take the declaration, claim a name, write a commit's
slots and its tail entry and its projection together, read the rows back, read a range of the
tail, say where the head is, answer one indexed condition, read documents for `scan`, truncate
the tail, forget swept rows, forget a whole document, and close. Nothing else. The interface stays this narrow on purpose, because widening it until the
weakest target fits is how the weakest target ends up deciding what the strongest may offer.

Three obligations are easy to miss, and each one is a check in the suite:

**`declare` carries the paths, and a driver that already holds documents brings their
projection into line with it inside it**, before it resolves (design 162). A document lacks a
field when it has no value for it and equally when it holds one computed from a path that has
since changed, so record the paths you projected under and compute a changed field again for
every document; a field the declaration no longer names leaves the projection, so `Found.fields`
carries the declared fields and nothing else. Read those documents' rows and compute each
projection with `projectionOf`:

```ts
async declare(declaration) {
	for (const doc of await documentsMissingAField(declaration)) {
		const held = await myRead(doc);
		await writeMissingFields(doc, projectionOf(held.rows, held.root, declaration));
	}
}
```

It is the same function `store` runs on every write, so a backfill and a write cannot disagree
about what a path names.

**A slot may hold bytes, and they have to come back as bytes.** A driver that keeps slots as
JSON writes a `Uint8Array` as an object keyed by index and reads back that object, silently. So
store a byte value as `{ bytes: <base64> }` and turn it back into a `Uint8Array` on read
(design 163). No reference carries that key and no primitive is an object, so the shape is
unambiguous.

**An absent `edge` on a patch means unchanged**, never detached.

Prove it rather than claim it:

```ts
import { driverChecks } from '@aweftjs/testing';

for (const check of driverChecks()) {
	test(check.name, () => check.run(() => myDriver()));
}
```

The check that matters most runs four writers concurrently against slots that do not overlap
and asserts every one of them survives. Two more exist for the same mistake from other angles:
a row nothing attaches keeps its slots, and an unset slot stays unset. A driver that writes rows
whole rather than slot by slot fails all three, which is what they are there to catch.
Thirty-three checks in all, a count the proof program pins, and the example driver below passes
every one there.

[`recipes/store/driver-file.ts`](https://github.com/torrinworx/aweft/blob/main/recipes/store/driver-file.ts)
is a complete driver written outside the package, and the proof program runs the real thing: it
writes a document, sends the writing process a `SIGKILL`, and reopens what survived.

## One thing to know about aliases

A snapshot holds what a document holds, so an observable nothing attaches is not in one. If a
slot still names that observable through `alias`, opening the document would mean rebuilding a
snapshot that names what it does not contain, which `fromSnapshot` refuses. So `store` drops
that slot when it opens the document rather than failing to open it at all. See design 050.

## What this does not do

- **Answer a question about many things inside one document.** See the declaration note above.
- **Talk to a network.** `sync` moves commits between documents; this one keeps them.
- **Decide who may write.** That is the application's rule, run before `receive`.
- **Sweep on its own.** See above.

## Known limits

**A declared path that crosses an `alias` indexes what a reopened document no longer holds.**
Every row is kept whether or not something attaches it, so the projection follows an `alias`
into a detached row and indexes the value there, while opening the document drops that slot
instead (design 050). A query can therefore answer with a document that has no such field once
it is open; settling it means the projection and `open` agreeing about an aliased row.

## The design notes

A `design NNN` above is the note of that number in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design), which says what was
decided, why, what it costs, and what would reverse it.