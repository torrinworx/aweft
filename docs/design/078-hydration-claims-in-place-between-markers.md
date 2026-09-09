# 078: Hydration claims server nodes in place, between markers

## Decision

`render` writes `<!--[-->` before and `<!--]-->` after the nodes of every dynamic mount: an
observer's value, a component's output, and each item of a list. `hydrate` walks the server
children of a parent in order, claims a node when the mounter inserts a matching one, and
enters a marker pair when the mounter starts the dynamic mount that produced it.

The rules of a claim:

- An element pairs with the next unclaimed server element of the same tag under the same
  parent; its subtree is paired the same way, and the properties `h` set on the client node
  (`$name`, so listeners and `value` too) are set on the claimed node. An attribute the markup
  carries only because of such a property (`style`) is not a mismatch.
- A text node pairs with the next server text node; when the server text is longer, it is
  split and the rest stays for the next claim, because two adjacent client text nodes
  serialize as one.
- A node the application made itself is inserted, never claimed.
- A different tag, or no server node left where one was expected, is a structural mismatch:
  it asserts in dev and, in production, the region is replaced with what the client built.
- An attribute or text that differs is set to the client's value, and asserts in dev.

After hydration the markers stay in the page and nothing reads them; a list that grows later
inserts against live anchors, as a mounted page does. One live hydration per target: a second
`hydrate` over the same target would claim the first one's nodes, so it asserts.

## Why

Flat DOM is ambiguous about where a dynamic region begins and ends, because an observer can
render to zero, one or many nodes and a component can return an array. The markers make the
boundary explicit for the reader that needs it and cost a comment node each. Every list item
gets its own pair for the same reason: an item can render to any number of nodes.

Adopting in place is the point of hydration. Wiping the body and mounting again has a
visible flash and loses focus, scroll and input state.

Replacing a mismatched region in production is chosen over throwing because a page that
works with one region rebuilt is better than no page, and over silently continuing because a
mismatch is a defect the developer must see, which the dev assert guarantees.

## What this costs

Markup must parse back to the tree `render` wrote: explicit `tbody` in tables, no
whitespace-only text where the parser drops it (`head`, `table`). Where the parser
normalizes, the mismatch rules apply, and the README says so.

## What would reverse this

A structural way to find region boundaries that costs less than a comment and needs no
counting. None is known.
