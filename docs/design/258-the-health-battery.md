# 258: The health battery

## Decision

`@aweftjs/health` is a battery: a source of one server module, `health/Check`, that answers
`GET /api/health`, and `HEAD` on the same path with the same status and headers and no body, with
what a deploy script, a load balancer or a person at a terminal needs to tell a process that is
up and right from one that is up and wrong. The package exports `health`,
the source, and nothing else. The module's instance carries `public` from its configuration,
true unless configured otherwise, so under the auth battery's gate the poll needs no cookie.

Its configuration, set the way any battery module is configured (a same-named file in the
application's own source exporting `config`, design 240):

```ts
export const defaults = {
	info: {},        // written into every answer as it is: { build: process.env.BUILD_SHA }
	checks: {},      // named functions run per request, each answered under its name
	public: true,    // what the gate reads; false makes the poll need a signed-in user
};
```

An `info` that is not a plain object JSON can write, a `checks` that is not a plain object of
functions, or a `public` that is not a boolean is refused at load with reason `invalid-config`.

**The answer, and there is no other.** JSON, with its length in `Content-Length` and with
`Cache-Control: no-store` so nothing between the poller and the process keeps a copy:

```json
{
	"ok": true,
	"time": "2026-01-01T00:00:00.000Z",
	"started": "2026-01-01T00:00:00.000Z",
	"info": { "build": "abc123" },
	"checks": { "backup": { "ok": true, "ageHours": 3 } }
}
```

`ok` is true when the process answered and, when the server was handed a store, when the
store answered too: `store.head('health')`, one read through whatever driver the store has,
naming a document that need not exist and writing nothing. The status is 200 when `ok` is true
and 503 when it is not. `time` is when the answer was made and `started` is when the process
began, both ISO 8601, so a restart is visible from two polls. `info` is the configured object,
written as it is. `checks` holds one entry per configured check, under the check's name, with
whatever value the check answered; the checks run together, not in turn.

**A check never decides `ok`.** A check that throws is written as `{ "ok": false }` under its
name and nothing of what it threw, and the answer's `ok` and status are what the store said. A
stale backup is not a reason to undo a deploy, and gating the answer on an application's own
check is a rule the application can build for itself by answering 503 from a module of its own.

**What it never does.** Echo an error: a driver's message can carry the connection string, so
the body says `ok: false` and no more, whatever failed. Answer any method but GET and HEAD on its
path, or any other path: those are what no route matched, and the fallthrough of design 248
answers them, so a poll that reads a 200 has to read the body too, because a static shell answers
200 to a URL it does not know. Decide who may poll: `public` is a word for a gate that reads it,
and `open` reads nothing, so under `open` every poll is served. Bound a check or the store read
in time: a check that hangs holds the answer, and the poller's own timeout is what says the
process is not answering. Name which environment variable carries a build hash: `info` is the
application's, written as configured.

## Why

An application that writes this module by hand learns two rules the hard way: an unreachable
database's error text carries the password into a public body, and a shell served with 200 for
every unknown URL makes a broken deploy look healthy to a status-only poll. A battery states both
rules once, and an application that wants another answer replaces the module by name, as with
any battery.

The store is what `ok` reads because a process that booted but cannot reach its store serves
an error on every real request while looking alive to a check that only says the process
answered. That is the state a rollback exists to catch. `head` is the probe because every
driver has it, it costs one round trip, and it writes nothing.

Checks add detail and never gate, because the two questions have different consequences: a
false `ok` undoes a deploy, and a check is for the things an operator wants to see from off the
box without any of them being a reason to roll back. The one gate is the one the poller can act
on.

The route is fixed at `/api/health` rather than configured, the way the auth battery fixes
`/api/session`: one path every deploy script on the stack can assume, and an application that
wants another writes `health/Check` itself. HEAD is answered because a probe that sends it is
common, and a probe that sent it and fell through to a static shell would read the shell's 200
while GET said 503.

## What this costs

One store read per poll. A poller that hits the endpoint every second is a query a second
against the driver, which is the price of knowing.

A check that hangs holds the whole answer, and the module has no limit to put on it, because
limits are the application's. The check puts its own timeout on whatever it reads.

An application that wants `ok` to reflect one of its own checks writes its own module, since
this one refuses to gate on them by design.

`started` is the process's start, not the module's, so a module reloaded while the process
runs reports the older time. That is the question a poll asks.

The store it asks is the one `createServer` was handed, for the process's life: nothing can hand
in another, so a store that stopped is 503 on every poll until the process restarts, which is
what a poll should see.

## Evidence

`packages/health/tests/check.test.ts`, through a server with the node listener: the answer's
shape and headers, the length among them; `started` within a hundred milliseconds of the process
start after a wait longer than that; 200 and `ok: true` with no store and with one that answers;
503, `ok: false` and no error text with a store that throws, and the probe one `head` of
`health`; `info` written as configured; a check's value under its name, two checks run together,
a check that throws written as `{ ok: false }` and the answer still 200, a check answering
nothing written as `null` and one answering a BigInt or a cycle as `{ ok: false }` with the rest
of the body intact; HEAD with GET's status and headers and no body, for 200 and for 503; a
method that is neither and a path that is not the route falling through to 404; under the auth
gate, an anonymous poll served with `public: true` and refused 403 with it false, and under
`open` served either way; an invalid configuration refused at load with the fix on the error.
`packages/health/tests/surface.test.ts` pins the one export. `recipes/health` does a deploy's
job: polls the endpoint until the build it shipped is the one answering, then proves the two
states the poll must not mistake for health.

## What would reverse this

A deployment target that needs the liveness and readiness questions answered on two paths, as
some orchestrators ask. That adds a second route to this module rather than a second module. A
need to gate `ok` on an application check would need a note of its own, since this one says why
it does not.
