# 010: One attach edge carries authority, and every other reference is an alias

## Decision

Every reachable observable has exactly one **attach** parent. A reference carries which kind
of edge it is: attach or alias.

Write authority over an observable is decided by the single chain of attach edges from the
root to it, and by nothing else. Aliases keep the graph a graph. They grant nothing and
revoke nothing.

Four invariants, enforced when a commit is applied:

1. An observable that already has an attach parent may not be given a second one.
2. Two attach edges naming one target inside one commit are refused. Deltas in a commit are
   unordered, so no tie-break is defensible.
3. A delta whose target has no attach path is refused as unreachable.
4. Moving an observable is one commit that removes the old attach edge and adds the new one.

## Why

**Enumerating an observable's paths is not implementable.** Shared references multiply paths.
Measured on documents of users with posts, where each post names its author:

| observables | every simple path |
|---|---|
| 72 | 13,687 paths, busiest node 390 |
| 142 | 36,507 paths, busiest node 1,040 |
| 482 | gave up past 400,000 |
| around 2,000 | exhausted a 4 GB heap |

So every rule that reads the whole reference graph is either impossible or wrong. Each
candidate fails a concrete case:

- **Shortest path decides.** Adding an unrelated reference elsewhere can shorten a path and
  silently change which rule governs an object. Authority must not flip because of a remote
  edit that touched neither the policy nor the object.
- **Any reachable rule grants.** An actor who can write a reference in a permissive region
  points it at any id and gains write access to that object. Privilege escalation through a
  reference.
- **Every reachable rule must agree.** The exact dual. An actor who can write a reference in a
  restrictive region points it at any object and blocks writes to it. One person's private
  selection list, referencing a shape, would freeze that shape for everyone else.
- **Refuse a reference that crosses a policy boundary.** This refuses the feature in its main
  use, since a post naming its author crosses a boundary by design, and it has no enforcement
  moment when a policy edit moves a boundary after the reference already exists.

With one attach path there is nothing to enumerate, so the explosion above stops being a
problem that was survived and becomes one that does not exist. Resolving a path is a walk up
the attach chain.

Moving an object across a privilege boundary needs remove authority at the old parent and add
authority at the new one. A reference can neither widen nor narrow authority, so escalation
and freezing are both impossible by construction rather than by care.

No comparable system has this problem, because none of them has a graph-shaped document with
shared references. The closest shape, a path-addressed tree, cascades grants downward, and on
a graph that cascade is exactly the escalation channel above.

## The cost

One byte per reference. Measured on a representative editing stream of 2,000 commits and
10,431 deltas, of which 1,478 carry a reference:

| | raw | per-frame gzip | stream gzip | stream brotli |
|---|---|---|---|---|
| cost of the edge field | +0.26% | +0.31% | -0.04% | +0.07% |

It is free once compressed. The stream figure is negative because one more repeated small
integer per reference compresses slightly better than the bytes around it, which is noise at
this scale rather than a saving. The honest reading is that two whole classes of privilege
bug become unrepresentable for a quarter of a percent of raw bytes and nothing measurable on
the wire.

The runtime picks the edge kind in the ordinary cases. Creating and inserting a new observable
attaches, inserting one that already exists aliases, and re-attaching is an explicit move.

## What would reverse this

A real workload where objects have no defensible single home, so authors fight the invariant
instead of using it. Or a measurement showing that detaching a large subtree is too slow at
canvas rate and no subtree-local index maintenance fixes it. That cost is not yet measured.
