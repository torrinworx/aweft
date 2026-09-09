# 057: `schema` is the shape a document must keep

Supersedes designs 032, 033, 034, 035, 036, 037, 038 and 039, and the authority half of
design 009. The attach-edge rule of design 010 stands; it is the format's.

## Decision

`@aweftjs/schema` describes what a document may hold and answers whether a commit keeps it
that way. It knows nothing about who made the commit. There is no actor, role, policy or
permission anywhere in the package.

- `shape({ ... })`, `list(item)` and `table(value)` describe the three observable kinds:
  object, array, map. Those three words are the package's whole vocabulary.
- A leaf is any validator that implements the Standard Schema interface (`~standard` with a
  `validate` function), which the validator libraries people already use implement. The
  package ships no leaf vocabulary of its own and takes no dependency: the interface is a
  contract.
- `check(Shape, document, commit)` returns the problems the commit would introduce, empty
  when none. A problem names the path it is about and the validator's message. A delta into
  an observable the commit itself attaches is resolved through the commit, so a subtree built
  and attached in one commit is checked at the path it lands on.
- `guard(document, Shape)` runs the same check before every commit on the document, wherever
  it comes from, through core's `intercept` (design 058). A local write that breaks the shape
  throws; an arriving commit is refused before anything lands. Returns the function that
  stops guarding.

## Why

A validator attaches to an observer and decides which changes that observer accepts. It never
cares about a client, a user or anything of the kind; the same thing was wanted earlier as
value invariants. An earlier package checked who may write where instead, which is authority,
and authority belongs to the application.

`check` and `guard` are one job with two entry points, the same way `track` sits under a
link: a node that wants to refuse a commit before trying it needs the function, and an
application that wants every change checked wherever it comes from needs the attachment.

Standard Schema at the leaves is what a validator per slot means in practice, and it keeps the
package to the three observable kinds plus the walk from a delta to its path.

## What it costs

A draft under edit lives in a cell, not in the document (024): a guarded email field refuses
a half-typed address, so a form writes on submit. That is already the rule for interface
state.

The first version checks each slot against its own leaf. A rule across two slots ("ends after
it starts") is a refinement on a shape, which is the natural extension and changes nothing
on the wire; it is not built until an application asks for it.

## Amended

An alias filed into a described slot is judged there, whole, when it is filed. An earlier shape
walked only what a commit attaches, so filing a task into a table of people made `check` answer
nothing. The observable is judged at its attach path only, and the README says so: one object
cannot be held to two descriptions on every write.

## What would reverse this

A real application whose invariants are mostly cross-slot, which would make refinements the
common case rather than the extension.
