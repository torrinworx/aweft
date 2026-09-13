# 069: A runner makes a room and says what it stops; the wall is the operator's

## Decision

A runner is `start()`, which makes the room and hands back the channel to it, and `stop()`,
which ends it. Three ship in the package, as `store`'s memory driver ships in `store`:

- `inProcess()`: the same process, no isolation at all. For tests, and for code the
  application trusts: a module runs behind the same window with the same imports, so moving
  it behind a wall later is a change of runner and not of the module.
- `iframe({ inside, into })`: a browser frame with `sandbox="allow-scripts"` and no
  `allow-same-origin`, so an opaque origin, with `default-src 'none'` and scripts allowed
  only inline, from `data:` (the default compile) and from the origin of the `inside`
  module. The frame is the browser's boundary, and the runner says so.
- `child(options)` on `@aweftjs/sandbox/node`: a Node process under `--permission` with
  `--disallow-code-generation-from-strings`, an empty environment unless `env` is given,
  read-only access to the package's own directory and whatever `read` names, and no
  network. The runner says what Node says: this is a seat belt, not a boundary, and a
  process that must be safe beside the database is wrapped by the operator. `wrap` is a
  command prefix put in front of the Node command, so that wrapping is one argument list.

Two more live in `examples/`, as `store`'s file driver does: a bubblewrap wrap for `child`,
and a docker runner whose channel is the container's stdin and stdout carrying
length-prefixed frames, so that no port opens. A runner proves itself by passing the escape
suite (design 070).

Limits ship with no value. `child` takes `limits.memoryMB` (its heap). How long the host
waits for a call into the room before it errors with `timeout` is `createSandbox`'s
`limits.callMs`, not a runner's, because a call into any room can hang, not only a child's: an
in-process module in an infinite loop and an unanswering frame both need the same escape.

The package makes no security claim of its own. It enforces the window (design 066);
each runner states what it stops; the README says the wall is the operator's.

## Why

The wall is the operator's. Node's own documentation says its permission model "does not
provide security guarantees in the presence of malicious code," and every product that runs
strangers' code puts an operating-system wall under whatever guard the engine provides. Limits
ship with no values because the application sets its own. The package is a standard security
and control boundary for running modules in a sandbox, without defining or enforcing that
sandbox itself.

Measured on one machine: the same child, link and loader run inside bubblewrap with no change
to any package, at 113 ms to the first module answer against 104 ms without the wall, the same
1.2 ms round trip, and about 90 MB of memory per room either way.

## What it costs

A room is a process on the server, about 90 MB while it runs and about 120 ms to start, so
one room per user always on is an arithmetic the application does. Without a wrap the Node
runner stops files, network, spawning, workers and eval and does not stop a determined
escape; the README says so in those words.

## What would reverse this

A runner with a real in-process boundary (a V8 isolate, an interpreter in WebAssembly) that
builds cleanly on the Node this repo runs. It would be a fourth runner behind the same
interface and would change nothing above it.

## Amended

`callMs` was first written here as a `child` parameter. It is built on `createSandbox`
instead, because the timeout guards a call into the room and a room of every runner can hang,
not only a child's. `memoryMB` stays on `child`, being a Node heap flag. Reversing this would
move `callMs` onto each runner.

`iframe()` takes `allow` (design 281): inline styles, and images, fonts and media from the
inside origin, `data:`, `blob:` and the origins the application names. `script-src` and
`connect-src` never widen and the sandbox attribute stays `allow-scripts` alone, so the frame's
claim is what it was.
