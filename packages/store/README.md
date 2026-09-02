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

**Nothing else.** There is no query surface yet. open research gates it, because one
query that is an index lookup on one driver and a capped scan on another is a performance
cliff wearing a portable API, and that is worth measuring before it is built.

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

A driver is seven methods: claim a name, write a commit's slots and its tail entry together,
read the rows back, read a range of the tail, say where the head is, truncate, and forget.
Nothing else. The interface stays this narrow on purpose, because widening it until the
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

- **Query.** See R2 above.
- **Talk to a network.** `sync` moves commits between documents; this one keeps them.
- **Decide who may write.** `schema` does that, and a host runs it before `receive`.
- **Sweep on its own.** See above.
