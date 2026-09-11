# recipes/health

A deploy's verification against the stack's own health endpoint. A release built from `new` is
shipped, and the script that shipped it polls `/api/health` until the build answering is the one it
shipped, with no cookie, through the auth gate.

## See it

```
node recipes/health/main.ts
```

That is also what the gate runs. It exits nonzero when any assertion fails. Three passes.

**The poll.** Two processes of one application boot, each `createServer({ sources, store, gate,
listener })` with `health` and `auth` in the sources and the auth gate named, and each with its own
build written into `info` the way a deploy writes a hash into the environment. The application's
own `modules/health/Check.ts` configures the battery's module without replacing it: the build from
the environment, and a `backup` check that reads the nightly dump's status file. The poll meets the
process the release was meant to replace first and says so: 200, but the older build. Then the new
one: 200, `ok`, the shipped build, `Cache-Control: no-store`, the backup check's answer under its
name, and a `started` before its `time`.

**A check that threw.** The status file is removed, so the application's own check throws on the
next poll. The answer is still 200 and `ok`, with `{ ok: false }` under `backup` and nothing of what
it threw, because a check never decides `ok`.

**A store that stopped answering.** The store is stopped under the running process. The next poll is
503 and `ok: false`, the build is still readable in `info`, and the body carries no error text. The
deploy script's verdict is that the process is not answering, and it keeps polling.

## What this does not do for you

It never lets a check decide `ok`: the backup above was stale and then gone, and the answer stayed
200, because a stale backup is not a reason to undo a deploy. An application that wants that rule
writes its own `health/Check`. It puts no timeout on a check or on the store read; the poll's own
timeout is what says the process is not answering.
