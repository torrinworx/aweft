# @aweftjs/health

The health battery: one server module, `health/Check`, that answers `GET /api/health` (and
`HEAD`) with whether the process and its store are up. It is what a deploy script polls to tell a
release that came up from one that did not, what a load balancer reads, and what you `curl` from
off the box.

## Quickstart

```ts
import { auth, paths } from '@aweftjs/auth';
import { health } from '@aweftjs/health';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...paths } });

const server = createServer({
	sources: [fromDirectory('./modules'), health, auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

```
$ curl -s localhost:8080/api/health
{"ok":true,"time":"2026-01-01T00:00:00.000Z","started":"2026-01-01T00:00:00.000Z","info":{},"checks":{}}
```

Its configuration is a file beside your application's own modules, exporting `config` and no
factory, exactly as any battery module is configured:

```ts
// modules/health/Check.ts
export const config = {
	info: { build: process.env.BUILD_SHA ?? null },
	checks: {
		backup: async () => {
			const status = JSON.parse(await readFile('/var/lib/app/backup-status.json', 'utf8'));
			return { ok: status.ok, ageHours: Math.round((Date.now() - status.at) / 36e5) };
		},
	},
	public: true,
};
```

The defaults are `info: {}`, `checks: {}` and `public: true`, so a server with `health` in its
sources answers the poll with no file at all. An `info` that is not an object JSON can write, a
`checks` that is not an object of functions, or a `public` that is not a boolean is refused at
load with reason `invalid-config`.

`public` is a word for a gate that reads it. Under `@aweftjs/auth`'s gate, `true` answers a poll
with no cookie and `false` answers 403 with the gate's reasons as
`{ "reasons": [{ "code": "private", "message": "..." }] }`, so the endpoint needs a signed-in
user. `open` reads nothing, so under it every poll is served whatever the word says.

## The answer, and there is no other

JSON, always these five keys in this order, with its length in `Content-Length` and with
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

**`ok`, and the status.** `ok` is true when the process answered and, when the server was handed a
`store`, when the store answered too. The status is 200 when `ok` is true and 503 when it is not.
The store is asked with `store.head('health')`: one read through whatever driver it has, of a
document that need not exist, writing nothing. A process that booted but cannot reach its store
serves an error on every real request while looking alive to a poll that only asks whether the
process answered; that is the state a rollback exists to catch, and it is the one this answer
catches. The store it asks is the one `createServer` was handed, for the process's life, so a
store that stopped is 503 on every poll until the process restarts.

**`time` and `started`**, both ISO 8601. `time` is when the answer was made. `started` is when the
process began, so two polls that disagree on it saw a restart between them. It is the process's
start, not the module's: a module reloaded while the process runs answers the same time as before.

**`info`** is your configured object as JSON writes it, in every answer, including a 503. It is
read once, at load: a getter runs then and not per poll, and a value that has to be fresh on every
poll is a check. Put the build hash here, from whatever your deploy writes it into, and a poll can
prove the right build is the one answering: a hash that does not match the one shipped means an
older process is still serving.

**`checks`** holds one entry per configured check, under the check's name, with whatever the check
answered as JSON can carry it: `null` when it answered nothing (`undefined`, or a function), and
`{ "ok": false }` when it answered what JSON cannot write (a BigInt, a cycle), so one check's
answer never costs the poll the body. The checks run together on every poll, not in turn. A check
that throws is written as `{ "ok": false }` under its name and nothing of what it threw.

**A check never decides `ok`.** However a check answers, and whether it throws, the answer's `ok`
and status are what the store said. A stale backup is not a reason to undo a deploy; a check is for
what an operator wants to see from off the box. An application that wants `ok` to reflect a check
of its own writes its own `health/Check`, which replaces this one by name.

**`GET /api/health` is the route, and `HEAD` on it** answers the same status and headers, the
body's length among them, and no body, for a probe that sends HEAD. Another method on that path,
`/api/health/`, or any other path is what no route matched, and whatever your modules' `request`
hooks say about it is its answer, or 404 when they say nothing. So a poll that reads a 200 reads
the body too: a static site configured to answer its shell for every unknown URL answers 200 to a
mistyped path, and a status-only poll would call that healthy. The query is not part of the path,
so `/api/health?t=1` is the route.

## What it never does

Echo an error. A store driver's message can carry the connection string, so a 503 says `ok: false`
and no more, whatever went wrong; the same for a check. Bound a check or the store read in time: a
check that hangs holds the whole answer, and your poller's own timeout is what says the process is
not answering, so a check puts its own timeout on whatever it reads. Name which environment
variable carries a build hash, or read one: `info` is yours, written as configured. Decide who may
poll, which is the gate's.

## Known limits

**One store read per poll.** A poller that hits the endpoint every second is a query a second
against the driver.

**One path.** An orchestrator that wants liveness and readiness on two paths gets one answer on one
path from this module. What would add a second route is in design 258.

Every error this package raises carries a `reason`: `invalid-config`. The design note is
[`docs/design/258`](https://github.com/torrinworx/aweft/tree/main/docs/design), which says what
was decided, why, what it costs, and what would reverse it.
