# 123: An unmatched tail is parked for one child stage

## Decision

A stage that matched a path and did not take all of it holds the rest as its **tail**, a cell on
its stage value. The root stage owns the URL; every stage below it is driven by its parent's tail
and never reads the URL itself.

A child stage claims the tail when it mounts. The claim is once: the first `StageContext` that
mounts under a stage takes it, and a second one gets nothing and runs on `initial` and `open`
alone, the same as a stage with no router. A child releases its claim when it unmounts, so the
next one to mount takes it. This is the pattern `PopupContext` already uses for the render's popup
sink (design 113): one list, one renderer, and the second asker makes its own arrangement.

The child finds its parent by walking the context tree, `node(context)` and `parent` from design
114. There is no registry of stages to look in and no new mechanism.

**The tail is a cell, not a message.** It is recomputed on every navigation from the match the
parent made. So a tail nobody claimed is not remembered: navigate away from `/reports/2026/q3` to
`/reports`, and a child stage that mounts afterwards claims a tail of `''` and not `2026/q3`. That
is what "dropped on the next navigation" means, and it falls out of the tail being derived rather
than delivered.

Because it is a cell, a child that is already mounted follows it. `/posts/3/edit` to
`/posts/3/comments` changes the child's act with the parent's act left alone. That is what decides
when an act is rebuilt at all: **which act it is, the parameters it matched with, and which `open`
it is, and nothing else.** The tail is deliberately not in that list, because it belongs to the
stage below. A parameter change is a different page and does rebuild, so an act reads `params` at
build time rather than following it.

## Why

A deep link arrives before the tree that answers it exists: the URL says `/posts/3/edit`, and
nothing knows what `edit` means until the act for `posts/:id` has mounted and rendered a stage of
its own. Something has to hold `edit` in the gap. Holding it as the parent's current tail, rather
than as a queued hand-off, is what makes the gap invisible: there is no moment where the tail has
been delivered and is therefore gone, and no ordering between mounting and delivery to get wrong.

Claiming rather than broadcasting, because two sibling stages under one act reading one tail would
both route on it and both fight for the same part of the URL. One owner per part of the path is
the rule that makes nesting mean anything.

## What this costs

A second stage under one act is not routed. It is a content swapper, which is a real thing to
want, but an application that expected it to route gets a stage sitting on `initial` and no error.
The stage registry entry (design 126) is where that is visible: an unrouted stage has no prefix
from its parent.

## What would reverse this

An application needing two routed regions side by side under one act, which would mean splitting
the tail by a rule rather than handing it to one claimant, and that rule would be new syntax in
the act key.

## Amended

`ui` exports `claimTail(context)` (design 279): a component that is a routed child without
being a stage claims the parent's tail exactly as a nested `StageContext` does, once, released
on unmount, and a second claimant still gets null. The one-claimant rule is unchanged; what
changed is that the claimant need not be a stage.
