# @aweftjs/store

Keeping a document, and keeping it as it changes.

Open a document and mutate it. Every commit it produces is written when it is produced, at the
granularity of the slots that changed. There is no save interval, no flush, and no reload.

```ts
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver() });

const board = await store.open('board:42');
const root = board.root as Record<string, unknown>;
root.title = 'a board';

await store.settled(board);        // wait for the writes already in flight
```

Reopen it anywhere over the same driver and it is what you left.

## What it holds

Three things, one job each.

**Rows.** One per observable: its id, its kind, where it is attached, and its slots. A commit
writes only the slots its deltas name, so the cost of a write follows the change rather than
the document. Measured against writing the document whole: 0.054 ms and 3.9 KB of write-ahead
log at a 620 KB document, against 34.98 ms and 571 KB. The rows are the source of truth, and a
document opens by reading them.

**A commit tail.** Every commit, in order, with the actor that wrote it and a per-document
sequence. This is what a session that fell behind asks for. It is derived, so losing it costs
a resynchronization rather than a document, and `truncate` bounds it.

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

const mine = await store.find({
	where: [
		{ field: 'ownerId', op: 'eq', value: 'u_7' },
		{ field: 'status', op: 'eq', value: 'open' },
	],
	sort: { field: 'ownerId' },
	limit: 20,
});
```

`op` is `eq`, `gt`, `gte`, `lt` or `lte`. Page with `after`, which takes the last document of
the previous page; there is no offset, because an offset re-reads what you already saw.

**The first condition is the one an index answers**, and it does the pruning. The rest narrow
what it returned. So put the most selective condition first, and that is the whole of the
tuning advice.

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

**A declaration holds literal steps only.** `['tasks', ANY, 'status']` names many paths inside
one document, and a projection has one value per path per document, so there is nowhere for
them to go. "Which documents have an urgent task" wants one row per match, which is a
different index shape and is not built. See design 049.

**Declaring is a schema decision.** IndexedDB may only create an index during a version
change, so a path declared later is a migration rather than a lazy index build. And indexes
are not free: twenty of them came to 3.3 MB against 2.2 MB of rows at 20,000 documents.
Declaring everything is the whole-document index by another route.

## Reading the history

```ts
const missed = await store.since('board:42', session.seq);
for (const { seq, actor, commit } of missed) send(seq, actor, commit);
```

A sequence older than the tail reaches back to is answered with what the tail still holds, so
compare the first sequence you get with the one you asked for and resynchronize when there is
a gap.

`truncate(doc, keep)` drops everything but the most recent `keep` commits. Keep at least the
longest outage a session may resume from.

## Commits from elsewhere

```ts
await store.receive(board, decodeCommit(bytes), 'u_7');
```

The actor is recorded beside the commit, so a persisted history can say who wrote something.

## Detaching is not deleting

An observable that loses its attach edge keeps its row and its slots. Nothing collects it
until you say so:

```ts
if (store.orphans(board).length > 10_000) await store.sweep(board);
```

This is the application's call, not the store's. The growth is visible and bounded while an
automatic sweep is data leaving at a moment nothing announces.

**One limit to know about.** A reopened document holds what is reachable, because that is all
`fromSnapshot` will build. So a commit that re-attaches an observable a reopened document does
not hold is refused with `detached-elsewhere` rather than applied against an empty observable.
In one process, popping an item off one list and pushing it onto another in two commits works
and stays one delta. Across a restart it is refused. Restoring it needs a core entry point
that does not exist yet; that is the open question.

## Writing a driver

A driver is ten methods: take the list of declared paths, claim a name, write a commit's slots
and its tail entry and its projection together, read the rows back, read a range of the tail,
say where the head is, answer one indexed condition, read documents for `scan`, truncate, and
forget. Nothing else. The interface stays this narrow on purpose, because widening it until the
weakest target fits is how the weakest target ends up deciding what the strongest may offer.

Prove it rather than claim it:

```ts
import { driverChecks } from '@aweftjs/testing';

for (const check of driverChecks()) {
	test(check.name, () => check.run(() => myDriver()));
}
```

The check that matters most runs four writers concurrently against slots that do not overlap
and asserts every one of them survives. A driver that writes rows whole passes everything else
and fails that one.

`examples/store/driver-file.ts` is a complete driver in about eighty lines, written outside the
package, and the proof program runs the real thing: it writes a document, sends the writing
process a `SIGKILL`, and reopens what survived.

## What this does not do

- **Answer a question about many things inside one document.** See the declaration note above.
- **Talk to a network.** `sync` moves commits between documents; this one keeps them.
- **Decide who may write.** `schema` does that, and a host runs it before `receive`.
- **Sweep on its own.** See above.
