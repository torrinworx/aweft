# 114: A context node is walkable, and its value is read once

## Decision

`createContext(def, transform)` returns a provider component with four things on it:

| name | what it answers |
|---|---|
| `def` | the value with no provider above |
| `read(context)` | the resolved value, from outside a consumer |
| `node(context)` | the nearest provider's node, or null when there is none |
| `use(build)` | a component given the resolved value, once, when it is built |

A node has `id`, `parent`, `children` and `value()`. `id` comes from the render's counter
(design 109), so it is stable across a server render and the hydration that adopts it. `children`
is an observable array in mount order, so a parent can watch what appears below it.

`transform(raw, parentValue, children)` runs on first read and its result is cached. The cache is
cleared when `raw` changes, so a provider given a cell is live.

A provider splices itself out of its parent's `children` on cleanup, by identity, and does
nothing when it is not there.

## Why

Introspection is a stated requirement of the architecture (`Contexts`), and today the only way to
ask "is there a provider above me" is to catch the error from not finding one. `node()` answering
null is what lets `Popup` refuse with a remedy rather than a bare throw.

Reading the value once is what makes a context cheap: a context nobody consumes costs one object
and never runs its transform. Clearing on a `raw` change is the one case where caching forever is
wrong, and it is cheap to detect because `raw` is either a cell or it is not.

Splicing by identity rather than by index, because the index can be `-1` and `splice(-1, 1)`
removes the last child instead of nothing. That defect is real, and it removes the wrong node
silently.

## What this costs

Four names on the surface per context rather than two. The two extra are the ones static
generation and a future developer tool need.

## What would reverse this

`children` going unused, which would make a context a plain upward lookup and delete the tree.
