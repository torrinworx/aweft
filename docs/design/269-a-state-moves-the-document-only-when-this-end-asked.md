# 269: A state moves the document only when this end asked for one

Amends design 044.

## Decision

A `state` frame is applied only when the topic it names is waiting for one: this end shared
with no document and was minted from the other end's root, or this end called `resync()`. A
state that arrives when neither is true is refused: the link answers a `fault` with reason
`unwanted-state`, applies nothing, and ends the topic at both ends, the way `root-mismatch`
does. A commit that follows is about a topic that is no longer open.

## Why

`accept` is the one rule the other end must not get around: every commit that arrives is handed
to it before it applies, and an end that refuses is a server if the application wants one
(design 054). A state frame did not go through `accept`, because it answers a question this end
asked, and the answer to "give me your document" is not something to refuse. But the link
applied it whether or not this end had asked, so an end holding a document under a refusing
`accept` could be moved to any state the other end cared to send, an empty one included. A page
that cannot write one field into an inbox could wipe the inbox in one frame, and an end that
sent a state built on another root could throw inside the applier and take the process with
it.

The topic ends rather than carrying on because an end that sends a state nobody asked for is
either wrong about the protocol or not the peer it was taken for, and in neither case is the
next frame worth trusting.

## What this costs

An end that used to be able to push its state onto a peer that had not asked no longer can. No
code in the repo did that: the two ends that send a state do so in answer to `want`.

## Evidence

`packages/sync/tests/behavior.sync.test.ts`: an end holding a document under a refusing
`accept` is paired by a raw peer that wants nothing and is then sent an empty state; the
document is unchanged, the peer is told `unwanted-state` by the number it used, this end hears
the same through `fault`, and a commit sent afterwards meets `no-topic`. The case is red against
the link before this note.

## What would reverse this

A legitimate flow in which an end sends a state unasked. There is none in the protocol as
written; one would come with its own frame or its own flag on `open`, and the rule here would
say which flag.
