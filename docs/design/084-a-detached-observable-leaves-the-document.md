# 084: A detached observable leaves the document at commit close

Closes the last open item of `spec/format.md` 8, and reverses the earlier answer that a
detached observable stays in the index.

## Decision

When a commit takes an observable's attach edge away, and nothing in that same commit gives it
another one, that observable and everything attached below it leave the document's index as the
commit closes. `byId` stops answering for it. The document holds nothing about it.

It keeps its slots and it keeps pointing at the document it was in, so a write to it still
throws `unreachable`, which is what a receiver does with the same delta.

Attaching it somewhere again, in a later commit, puts it back. That commit carries its whole
contents as adds, exactly as it would for an observable the document had never held, because
that is what the document now believes. A receiver that dropped it too builds a fresh
observable out of those adds. Both ends agree by rule instead of by remembering.

## Why

Nothing removed was ever forgotten. The index kept every observable a commit had ever attached,
so a list that is filled and cleared grows the document by every row it has ever held, and the
rows stay reachable through `byId` forever. Measured: rows cleared three create-and-clear
cycles earlier were still answered by `byId`, and the browser's run-and-clear memory was
6.0 MB against the reference page's 0.8 MB.

Keeping them bought one thing: a move written as two commits, a remove and then an add, could
re-attach the same observable and the second commit needed to carry nothing but the edge. That
is a real saving on a rare shape, and the price for it was an unbounded index on every shape.
Re-sending the contents costs the subtree once, at the moment somebody re-attaches it, and only
then.

Re-sending is what makes the rule symmetric. A receiver applies the commits it is given and has
no other channel, so a rule that keeps state on one side and not the other is not a rule the two
ends can both follow. "Forget at close, re-send on re-attach" is one sentence and both ends
implement the same sentence.

## What this costs

A re-attach carries the subtree's slots rather than one delta. An application that parks an
observable out of the tree and puts it back pays for its contents each time.

**The inverse of a commit that dropped a subtree carries the subtree too**, because it is a
commit that attaches it again and the rule above says what such a commit contains. Without
that, undoing a removal puts an empty observable back where the data was, which the core proof
program catches: `undo 6 left the board inconsistent`. The slots it names
are the ones the subtree held before the commit: the close copies them off each dropped node on
the same walk that takes it out of the index, and the delta objects are built only when
something asks for the inverse (design 016's rule, that prior values are captured while the
change is applied and the commit is assembled on demand, now applied to the whole inverse rather
than to the deltas alone).

Copying at the close is what makes the answer right. Read late, the subtree described whatever
had happened to it since, so undoing a removal after a later commit had re-attached and edited
the subtree restored the edited values rather than the ones the removal took away. What it costs
is one map copy per node a commit drops, paid whether or not anything ever asks for the inverse.
Measured at 10,000 rows, best of five runs of the core timing script: clearing a watched array
of 10,000 rows went
from 5.11 ms to 6.36 ms, and a commit that drops nothing, one atomic push of 10,000 rows, went
from 19.60 ms to 20.00 ms, which is inside the run to run spread.

Design 048's "refused rather than restored" paragraph was written when a re-attach carried no
contents, so a rebuilt document could not be told what the observable held. The commit now
carries it, and `store`'s `detached-elsewhere` refusal is stricter than the rule needs. It is
left standing: it refuses rather than loses, nothing depends on the looser behaviour, and
relaxing it is `store`'s own decision to take with its own evidence.

The earlier answer here was "no change: it stays in the index, and collecting is a sweep on a
policy", taken before a long-lived list was measured. The sweep in design 048 is still how
`store` collects rows; what changed is that core's own index no longer needs one.

## What would reverse this

A workload that moves observables between parents across commit boundaries often enough that
re-sending their contents dominates, measured on a real edit stream rather than assumed. The
answer then is a bounded window both ends implement identically, not a return to keeping
everything.
