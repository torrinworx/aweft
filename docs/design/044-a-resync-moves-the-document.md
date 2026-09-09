# 044: A resynchronization moves the document rather than replacing it

Re-scoped by design 053: `reconcile` stands and a `state` moves the document; the host that
said the state is gone.

## Decision

When a client needs the whole document, the host says the document as one commit of `add`
deltas. The client builds that into a scratch tree, works out the difference between it and
what the client holds, and applies the difference.

The document the application holds is never swapped for another one.

## Why

**A swapped tree breaks everything pointing at the old one.** Every watcher, every derived
value, every piece of interface holding the document would be pointing at something nothing
writes to any more, and nothing would say so. Applying a difference reads to a watcher like
any other change, so an application that never thought about resynchronization keeps working
through one.

**One shape on the wire.** The whole document is a commit, so it goes through the same
encoder, the same validator and the same applier as everything else, and `record` can fold
it into an authority index. A second shape for state would be a second thing to specify,
version and refuse. It is also what a host with no history has to send anyway.

**The difference is computed on the receiving side** because the host does not know what the
client holds. The transfer is the whole document; the change applied is only what actually
differs.

## What it costs

A resynchronization allocates a second copy of the document to diff against, and sends the
whole document over the link even when little changed. A host that keeps recent commits
avoids the whole path for a short outage; closing the gap for a long one needs a history,
which is `store`'s job.

## What would reverse this

A history that lets a host send only what a client missed, at which point the whole-document
path is the fallback rather than the normal answer for a reconnect.
