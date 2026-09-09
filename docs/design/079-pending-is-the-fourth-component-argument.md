# 079: `pending` is the fourth component argument

## Decision

A component is `(props, cleanup, mounted, pending)`. `pending(promise)` tells the mount root
that content is on its way. `render` resolves once the root has nothing pending, looping
because a settled promise may register another. On a page `pending` is tracked and nothing
waits on it.

## Why

Static generation has to wait for content before serializing, and the thing that knows
content is coming is the component fetching it. A registry at module scope is the other answer:
correct in a browser with one document and wrong on a server rendering several pages at once.
A root-tracked set is per render by construction.

The alternative, async components rendering a fallback until they resolve, is nicer to write
and changes the mount timing of every component that uses it. It can be built over this in
`ui` without changing this.

## What this costs

One more argument. A component that forgets to call `pending` renders its loading state into
the static page, which is visible and easy to find.

## What would reverse this

Async components landing in `dom` itself, which would make `pending` an implementation detail
of that path. The primitive comes first.
