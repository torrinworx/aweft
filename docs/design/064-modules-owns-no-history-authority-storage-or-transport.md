# 064: `modules` owns no history, no authority, no storage and no transport

## Decision

`modules` imports `core` and nothing else, and knows nothing about:

- **History.** A module document's versions are its commit history, kept by `store` and
  bounded by `truncate` like any document's; undo is core's inverse. `modules` reads the
  current `source` and nothing about how it got there.
- **Authority.** No rule on who may read, write, load, run or pass parameters to a module, on
  disk or in a document. The application builds the boundary.
- **Storage and transport.** A module document is persisted by opening it through `store` and
  sent by sharing it over a link, both by the application. `modules` receives an observable
  and never asks where it came from.

## Why

A versioning system inside `modules` would be the same mistake as letting `schema` define user
authority on individual observers, or letting a link assume a server and client relationship:
as a library, `modules` has no domain over a store. Everything a module needs from storage,
transport and history a document already has, and a second copy of any of it inside `modules`
would be a second way per job and a dependency edge the ownership table forbids.

On authority: `modules` as a library never assumes responsibility for it. Neither a file nor a
document is inherently untrustworthy; the application decides what it exposes and to whom.

## What it costs

An application that wants versions readable as data rather than by replay keeps them as state
in the module document, in its own shape.

## What would reverse this

Nothing. Both follow from what the library is.
