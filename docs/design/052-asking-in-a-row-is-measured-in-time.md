# 052: "In a row" is measured in time, not in commits taken

Superseded by design 053: nothing asks for the whole document on its own, so there is no give-up
guard and nothing counts asks. `resync` is the application's call, once.

## Decision

The guard that stops a client asking for the document forever counts the asks inside a moving
one-second window. A run that goes quiet for a second starts again from zero. Taking a commit
from the host still clears it immediately.

## Why

**The counter only ever cleared in one place, and a whole class of client never reaches it.**
It was cleared when a `commits` frame arrived. On a topic this client is the only writer of,
no `commits` frame ever arrives, so the count only went up for the life of the session and the
sixth ask killed the topic. The message it printed was false: the document had moved every
time.

Under that count, six rounds, each one a successful recovery:

```
round 2: asked=true state=live n=2 (the document moved every time)
...
round 6: asked=true state=live n=6 (the document moved every time)
FAULT resync-loop board asked for the document 6 times without moving
round 7: asked=false state=failed n=6
```

`spec/replication.md` 4 already says "several times in a row", so the spec was right and the
implementation was counting something else. This records what "in a row" means rather than
changing what is promised.

**Three other clear conditions fail against the corpus.** Clearing on an accept fails because a
client that keeps writing collects accepts whatever else is wrong. Clearing on a document
received would undo the guard entirely, since being answered with a document every time is the
shape of the starvation loop. And clearing when the document actually changed, which is the
most literal reading of "moving" and is a signal `reconcile` already produces, fails the corpus
case `a client that keeps writing still gives up on a host it cannot follow`: there the host's
document genuinely moves on every ask, and the client still has to stop, because a link
that drops every broadcast is unusable however much the document moves.

**Time is what the guard is actually about.** The harm is a loop that starves the event loop:
501 join frames in 4,000 microtask turns, no timer able to fire. That loop trips five asks in
well under a millisecond, so a one-second window catches it with three orders of magnitude to
spare, while a healthy client that resynchronizes twice a minute never accumulates.

**Both cases the guard has to separate are on the right side of it.** A client
resynchronizing eight times with more than a window between each stays `live`, and the same
probe against a plain counter reaches `failed` on the seventh. The corpus case, forty asks in
quick succession, still stops and still reports `resync-loop`.

## What it costs

A `Date.now()` on a path that runs when a client has lost its place, which is not a hot path.
And a pathological client that paces its asks to just over a second each is no longer caught.
That client is not starving anything, which is the only harm the guard was ever for.

## What would reverse this

A host telling a client why its resync did not help, at which point the client can stop for a
stated reason rather than on a count.
