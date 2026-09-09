# 043: Undo, apply, redo is the one mechanism for everything out of order

Superseded by design 053: there is no host to rebase against. Implements designs 011 and 012.

## Decision

A client holds its unaccepted commits in a pending list, applied to its own document. Every
case where the host says something the client did not expect is handled the same way:

1. Undo the pending list, newest first.
2. Apply what arrived, or drop what was refused.
3. Redo the list, oldest first.

A redo that will not apply is reported at once and **keeps its place in the pending list**
until the host decides it. It is not applied and not undone; the host will refuse it for the
same cause, and taking it out of the list would leave a hole in the run of sequence numbers
this side has sent or is about to send.

The list is the order the document saw things, which is what every undo is met by. What is
sent is that list in sequence order, which is not always the same: a commit a watcher makes
during a rebase sits in the middle of the document's order and carries the newest number.

There is no second path: a commit from another replica, a refusal, a reconnect and a
resynchronization all run this.

## Why

**The client's document is always what the host said plus what still applies on top.** That
is design 011's requirement stated as an invariant, and this is the only mechanism that
keeps it in every case. Inverting a refused commit in place is enough when nothing after it
depended on it, and it fails when something did.

**Newest first is not a detail.** Each undo was built against the state right after its own
commit, so meeting it against any other state is meeting it against a document it does not
describe. The corpus holds the case: an attach and a write inside it, with a refusal
underneath both.

**A redo that fails is a commit the host would refuse for the same cause**, because both
sides are applying the same sequence of commits in the same order. So the client can drop it
without waiting for the round trip, and the refusal that arrives later for a commit already
gone is ignored. The link is ordered, so the client can never learn a commit was accepted
after it decided the commit could not be rebased.

**The common case pays nothing.** An arriving commit with an empty pending list is an
ordinary apply, which is what a replica that is only reading ever does.

## What an earlier shape got wrong

`sendPending` stated the first pending commit's sequence and packed the rest behind it, which
is only correct while the list is a contiguous ascending run. Two ordinary things broke that:
a redo that failed left a hole, and a commit a watcher made during a rebase was pushed into
the list ahead of the commit being replayed. In
both cases the next frame reached the host out of order, the host ended the link, and a commit
was lost with nothing reported, which is the worst outcome this design has. Dead entries and
placing an entry in the list before it is applied are the two halves of the fix.

## What it costs

Undoing and redoing is work proportional to the pending list on every arriving commit that
meets one. A pending list is the commits made in one round trip: three at thirty commits a
second on a 100ms link. The application sees each rebase as ordinary changes, so a watcher
fires more than once for one settled value.

## What would reverse this

A measured workload where the rebase is the cost that matters, which would justify a fast
path that compares the arriving commit's slots against the pending list's and applies
directly when they do not meet. That is a filter in front of this, not a second mechanism.
