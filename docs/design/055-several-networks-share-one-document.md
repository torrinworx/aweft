# 055: Several networks share one document

## Decision

Any number of links, trackers and stores may hold one document at the same time, and each
hears every commit the others land. A commit that arrives through one link is a local commit
to every other link on that document and to every watcher, so a link over a socket and a
store on the same document work together without either knowing about the other, and a node
holding one document at the end of two links forwards between them.

This is a stated guarantee, so it is a corpus case in `sync` (two trackers on one document,
one receives, the other hears it as made here and ships it) and a proof: a document shared
over a link and persisted by a `store` at the same time, with a commit that arrived over the
link ending up in the store's history, and a three-node chain converging.

## Why

The networks an application runs chain: one network over a websocket, another recording the
same document into persistence. The mechanism is already right in `track` (design 046): each
tracker counts only its own landings, so a landing through one tracker is an ordinary delivery
to every other. The store watches the document rather than any link. Nothing new is built for
this; it is written down and checked so it cannot be lost.

## What it costs

A link must apply an arriving commit through its own tracker, never through a bare `apply`,
or it would ship the commit back to the end it came from. That was already the rule.

## What would reverse this

Nothing foreseeable. If a network ever needs to know which link a commit came from, that is a
field on the handler's event, not a change to this.
