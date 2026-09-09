# 070: A runner is proven by the escape suite, and the suite only grows

## Decision

`@aweftjs/testing` exports `roomChecks()`: the escape suite for the window, one named check
each, run against a runner the caller makes. A runner that passes them all has proven the
window holds behind it. The suite runs in every shipped runner from the package's own tests.

The suite has two halves and both are append-only: a case is added for every escape ever
found and none is removed.

- **The window**, run in every runner: a hostile module reaches no name it was not granted;
  a name revoked mid-run refuses from the next call; a function, an observable or a live
  object in an argument or a result is refused by name; the room's writes to `modules` and
  `room` never reach the host; a malformed row does not stop the host; a call after `stop`
  fails rather than waits.
- **Each runner**, run where that runner runs: `child` denies files, network, spawning,
  workers, eval and the parent's environment; `iframe` denies the parent window, storage,
  cookies, network and navigation, run under Playwright's Chromium in the gate.

Playwright is a dev dependency of `@aweftjs/sandbox` alone, allowed by name in
`packages/testing/scripts/check-dependencies.ts`, and `npm test` installs its Chromium
before the suites run.

## Why

Whether the sandbox boundary is sound is answered by an escape suite run against the real
isolation mechanism on both a client and a server, append-only. The package does not own the
wall (design 069), so the suite proves the window in every runner and proves each runner's own
claim, and a wall the operator adds is the operator's to test. No fake DOM enforces an
iframe's isolation, so a real browser runs in the gate as a dev dependency.

## What it costs

`npm install` downloads a browser, about 150 MB, once. A test in the gate launches it.

## What would reverse this

Nothing foreseeable. A runner that cannot run the suite is not a runner.
