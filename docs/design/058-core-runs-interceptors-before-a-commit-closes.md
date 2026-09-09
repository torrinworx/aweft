# 058: Core runs interceptors before a commit closes

## Decision

`intercept(document, fn)` registers a function on a document. It is called with the commit
about to close on that document, after every delta has been applied inside the transaction
and before anything is delivered to a watcher. It returns the refusals it found; an empty
result lets the commit close. A non-empty result rolls the transaction back, delivers
nothing, and throws a `RefusedError` carrying the refusals. It returns the function that
removes the interceptor.

One seam serves every way a commit is made: a plain assignment, an `atomic` block and
`apply` all close through the same transaction, so all three are intercepted alike. Reading
the document inside an interceptor sees the state the commit would leave, which is what a
rule across two slots needs.

With no interceptor registered the seam costs nothing measurable on the write path, and a
rule on one document costs every other document nothing: rules are kept per document, and a
commit on a document nobody watches or guards is not even built. `bench/write.ts`, the seam
section: one slot with nothing registered 0.176 us, with a rule on another
document 0.174 us, with an accepting rule on this document 0.316 us.

## Why

The validator is attached to the observer and every change is checked before it lands,
wherever it comes from. That needs a place in core where a commit
exists and nothing has seen it yet. The transaction already has one: a block that throws
rolls back and emits nothing (015), so refusing a commit is the path a throwing block takes,
with the refusals attached.

A hook per source (one for assignments, one for `apply`) was rejected because a commit that
reaches a watcher through two different checks is two definitions of what a commit is.

## What it costs

An interceptor runs on every commit on its document, so it is on the write hot path. A guard
over a whole document pays the walk from each delta to its path, on top of the seam's own cost.

Core does not know what an interceptor checks. It knows a function that can refuse, and the
`Refusal` type (a code, a message and an optional path) is core's, so `schema`, `sync` and
an application speak one word for it.

## What would reverse this

A measurement showing the seam costs more than noise on the literal hot path with nothing
registered, which would move the check to the two sources at the cost above.
