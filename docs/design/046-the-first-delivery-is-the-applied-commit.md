# 046: The first delivery inside an apply is the commit that was applied

## Decision

Replication tells an arriving commit from a locally made one by counting deliveries, not by
holding a flag. `receive` marks that one commit is landing; the first delivery to reach the
watcher is that commit, and every delivery after it in the same window was made here.

## Why

**A flag is wrong, and reproducibly so.** Delivery is deferred, so a watcher that writes in
answer to an arriving commit produces its commit inside the same drain, while the flag is
still up. A flag swallows it, and a local write made in answer to a remote change never
replicates. That is the ordinary way an application reacts to a change, so the bug would be
everywhere and silent. The case is the first entry of
`packages/sync/tests/behavior.sync.test.ts`, and it is red against a flag.

Three neighbouring facts were checked at the same time and all held: a flag does hold across
`apply` from ordinary code; it does not hold when `apply` is called from inside a watcher,
which is why every channel here queues and applies on a microtask, and core's own README says
so; and the inverse a rollback needs is available from inside the delivery that lands.

**Counting is exact for the one thing it has to be exact about.** An `apply` is one `atomic`
block, so it is one commit and one delivery to a watcher on the root, and anything a watcher
writes lands behind it in the queue.

**A commit that changes nothing delivers nothing**, so the count is cleared when the apply
returns rather than when a delivery arrives. Without that, one no-op commit would put the
count out by one for the life of the document and swallow the next real local commit. Both
halves are in the corpus.

## What it costs

`receive` must not be called from inside a watcher: the ordering it rests on is gone there.
Every channel in this package delivers on a microtask, so the rule is kept structurally
rather than asked for, and it is stated on `track`.

## What would reverse this

Core gaining a way to tell a watcher which commit it is being handed, at which point the
answer is to read it rather than to count.
