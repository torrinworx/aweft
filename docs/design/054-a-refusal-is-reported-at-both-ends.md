# 054: A refusal is reported at both ends, and the link picks no winner

## Decision

When a commit arrives that this end cannot apply, because `accept` said no or because the
applier refused it, the link reports it to this end's handler and sends a `refused` frame
naming the commit's sequence and the reasons, so the other end's handler hears it too. Then
it carries on with the next commit. A refusal refuses the commit, never the link.

The link does nothing else about it. `resync(name)` asks the other end for its document, and
`reconcile` moves this one to it. Calling either is the application's decision.

An end keeps a bounded window of the commits it sent, so a `refused` about a recent commit is
reported with the commit and its undo. Past the window it is reported with its sequence only.

## Why

Choosing who yields is authority, and authority is the application's. The
alternative, resynchronizing toward the sender automatically, makes the link decide a winner
in every conflict, and the other alternative, closing the link, turns every ordinary race into
a full resynchronization at the busiest moment (the reasoning of 012 still holds).

Both ends hear it because the end that can act is usually the sender: its write is the one
that did not land, and its undo is the commit that yields.

## What it costs

Two ends replacing one slot at the same moment end up swapped, and stay swapped until an
application on one side yields. The README says so and the proof program shows it, with the
yield written as an ordinary handler. An application that cannot tolerate that arranges a star
with one node that refuses, which is a handler and a topology, not a library feature.

## Amended

A throw out of `accept` is a refusal with the code `accept-threw` and the error's message: the
commit did not land and the other end has to hear it. A throw out of a watcher while the
commit lands is not a refusal: the commit is in, and the error is the application's, raised
after the whole frame has been handled so a bad watcher cannot make the commits behind it
vanish. Before this, both silently dropped the rest of a frame.

## What would reverse this

Evidence from a real application that every handler it writes is the same "yield to the other
side", which would justify a default the application opts into.
