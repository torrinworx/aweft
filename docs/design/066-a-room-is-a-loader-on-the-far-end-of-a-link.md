# 066: A room is a loader on the far end of a link, and the link is the only way in or out

## Decision

A sandbox is a room: a realm the host does not trust, made by a runner (design 069),
holding one ordinary `@aweftjs/modules` loader, joined to the host by one ordinary
`@aweftjs/sync` link. Nothing else joins the two. Three documents cross that link, and
nothing but those three:

- **`modules`**, the application's module document, shared by the host. The host refuses
  every commit the room makes to it, so the room reads it and never writes it. The room's
  loader reads it through `fromDocument`.
- **`room`**, the control document the host makes: the loader's `props`, the `grants` list
  (design 067), the `bundle` specifier, the `follow` flag, and the `exposed` table of names
  and their function names. The host refuses every commit the room makes to it.
- **`calls`**, the one document both ends write, holding call rows (design 068).

Inside the room nothing is ambient. There is no fetch, no file system, no network, no
environment in the code the package runs; what a runner leaves reachable is the runner's
claim (design 069). What a module inside can reach is exactly what the host granted by
name, and each granted name is an import.

`props` cross as JSON text, because a document slot holds a primitive or an observable and
props are the application's plain data. A prop that is not plain data is refused by name
when the sandbox is made.

## Why

The package is a standard security and control boundary for running modules in a sandbox,
without defining or enforcing that sandbox itself. It owns the window, meaning what crosses
the link, and the runner owns the room; this note is the window. Neither the module system nor
the link changes for it, as design 065 says: a loader on the far end of a link inside a child
process under Node's permission flags loads a module from a shared document with no change to
either package.

Sharing the application's own module document, rather than a copy, is what makes a module
edited on the host reload in the room through the same `follow` a single process uses. The
host refusing the room's commits is what keeps the room from editing another module's
source.

## What it costs

The room's copy of `modules` and `room` diverges from the host's after a refused write: the
refused commit stays applied on the room's side. That is the room's own view of its own
tampering; the host's documents are the ones the host acts on, so nothing the room writes
there reaches anything.

## What would reverse this

A consumer that needs a fourth document across the link. That would be a new design note, not
a widening of this one.

## Amended

Design 278 is the fourth-document note this one asked for. The three fixed documents still
cross, and beside them the documents the application names in `createSandbox`'s `documents`,
each under its key, writable both ways, and, when the room has a page, the `route` document
(design 279). Their names are reserved beside the three. The control document gained
`documents`, `console`, `status` and `page`. Nothing else crosses.
