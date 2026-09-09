# 056: `store` records no actor

Supersedes the actor half of design 047.

## Decision

`createStore` takes no actor. `receive(handle, commit)` takes none. An entry in the commit
tail carries a sequence and the commit, and nothing about who wrote it. The driver `Write`
carries none either.

`receive` stays: applying a commit through the store rather than around it reports a refusal
before the write happens.

## Why

The library knows nothing about a user, a client or an actor. A label beside a stored commit
is provenance rather than authority, and it is dropped anyway: an application that wants to
know who wrote something writes that into the document as state, where it replicates and
validates like everything else.

## What it costs

A persisted history cannot answer "who" on its own. The `Held` an application reads back from
`since` has a sequence and a commit.

## What would reverse this

A need for provenance in the tail. It would come back as an optional label with no
meaning to the library.
