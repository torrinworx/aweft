# 327: the loader runs its hooks on the thread that imports

## Decision

`@aweftjs/build/loader` registers its `resolve` and `load` with `module.registerHooks`, not
`module.register`. Both hooks are synchronous: `load` reads the file with `readFileSync`, and the
icon generator is reached with `require`, which takes an ES module synchronously and goes through
the same hooks.

The setting variables (`AWEFT_DEFAULT_H`, `AWEFT_TEXT`) are still read once, when the loader is
imported. A worker thread runs `--import` again from its own `execArgv`, so it registers its own
hooks and reads its own environment, as it did before.

## Why

Node 26 deprecates `module.register` (DEP0205) and prints a warning the first time a process
calls it. Every process started with `--import @aweftjs/build/loader` printed it. The warning is
not only noise: a room that forwards its console to the host counted it as a report, and
`packages/sandbox/tests/reports.test.ts` timed out waiting for the count it expected. Under
`--no-deprecation` the same test passed, which is what pinned the cause.

`registerHooks` runs the hooks on the thread that imports, so there is no hooks worker to start
and nothing to post messages across. The hooks never needed to be asynchronous: the only awaits
were a file read and a dynamic import of the icon generator.

## What this costs

The hooks block the thread while they read a file or compile one. They did the same work before,
on a worker the importing thread waited for, so a process takes no longer to start.

`registerHooks` arrived in Node 22.15. The repo already asks for a Node that has it.

## What would reverse it

A hook that needs to wait on something asynchronous, a network fetch or a child process. Then
`register` comes back, with its warning silenced for the forwarded console.
