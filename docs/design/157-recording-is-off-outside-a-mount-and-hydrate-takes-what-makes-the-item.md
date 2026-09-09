# 157: Recording is off outside a mount, and `hydrate` takes what makes the item

Amends design 098.

## Decision

The hydration bookkeeping in `dom/src/props.ts` (which nodes the binding made, which
`$name` properties it set, which attributes a scope or cell drives) is recorded only while a
hydration is running. Outside every mount the flag is off. Design 098 had it on there.

`hydrate(target, item)` therefore takes something it can build inside the hydrating mount: a
component call, `h(App, props)`, or a function that makes the item, which `dom` already
mounts as a component with no props. An element built before the call was made outside any
mount and is not marked, so it can claim nothing. Handed to `hydrate` as the top-level item,
directly or returned by the maker, it is refused before anything is inserted, with the maker
form named as the fix; without the refusal the maker shape stood the client's copy in for
the server's node and finished silently. Deeper in a component tree a node built
outside the mount is inserted as an application node and stands in for the server's node
of the same tag, which is what the mounter already did with a node the page made itself. The
README says both where it shows `hydrate`.

`ssg`'s `attach` wraps a bare function the same way on both of its branches, so one entry
file hydrates a generated page and renders a live one; `mount`'s own contract, where a bare
function is a Mounter, does not change. That needs `isComponentCall` on `dom`'s surface,
exported rather than written a second time inside `ssg`. The tests that passed a built
element to `hydrate` pass a maker.

## Why

Design 098 kept recording on outside a mount for one caller shape, `hydrate(target,
h('main', ...))`, and every element an application builds eagerly paid for it. Measured
on the prebuilt-elements idiom of the row table, where rows
are built in an event handler and pushed into a list: `recordProperty` 2.45 MB and the
made-set 2.0 MB of allocation per 10,000 rows, for a hydration that never runs. Every
`hydrate` call in the repo outside the tests already passes a component call.

## What would reverse it

An application that has to hydrate an element it built elsewhere and cannot wrap the
building in a function. None is known; the wrap is one arrow.
