# 065: Isolation is a later package, and `modules` claims none

`sandbox` is built to designs 066 to 070, and `modules` still claims nothing, exactly as
written here.

## Decision

`sandbox` is not built in this phase. It starts after `modules` is foundational-complete and
the question of whether the window holds and each runner stops what it says is answered. Until
then `modules` makes no isolation claim: its
README says that loading a module runs its code with the loader's own privileges, and nothing
more.

Nothing in `modules` changes for `sandbox` later. A link has two equal ends and a
`MessagePort` channel ships, so an isolated runner is a frame or a child process holding a
loader on the far end of a link, sharing the same module document.

## Why

Server-side isolation requires specific Node features and flags turned on at the start of the
process, and this library does not take on the security responsibility of running that. The
module system is valuable on its own behind an operator's own gate, and its correctness can be
proven without an isolation mechanism.

## What it costs

Running a module from a document is, for now, running code the operator trusts.

## What would reverse this

The window shown to hold, and `modules` proven. Then `sandbox` gets its own plan.
