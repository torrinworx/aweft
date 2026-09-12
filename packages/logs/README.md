# @aweftjs/logs

The logs battery: what a page and the server did, per visit, in the application's own store. A
crash, a bad state, a regression in one account: the visit that hit it is a document you read
back, by hand or with an agent. `@aweftjs/logs/client` is the browser half that records the
page; the readers this package exports are for any process, an agent or a job among them.

A visit is one page from load to close. Nothing records until the page calls `createLog`, and
nothing is read but through the store.

## Quickstart

The server side is three modules and the two store declarations they and the readers query:

```ts
import { auth, paths as authPaths } from '@aweftjs/auth';
import { logs, paths as logPaths } from '@aweftjs/logs';
import { fromDirectory } from '@aweftjs/modules/node';
import { createServer } from '@aweftjs/server';
import { node } from '@aweftjs/server/node';
import { createStore, memoryDriver } from '@aweftjs/store';

const store = createStore({ driver: memoryDriver(), declare: { ...authPaths, ...logPaths } });

const server = createServer({
	sources: [fromDirectory('./modules'), logs, auth],
	store,
	gate: 'auth/Gate',
	listener: node({ port: 8080 }),
});

await server.start();
```

The page wraps the client it already has, and uses the one the log hands back everywhere else:

```ts
import { createClient } from '@aweftjs/client';
import { createLog } from '@aweftjs/logs/client';

const log = createLog(createClient({ url }), { build: BUILD_SHA });
const client = log.client;                 // share and ask through this from here on

client.share('board');                     // its commits are recorded as shape
log.write({ kind: 'checkout', step: 3 });  // the page's own record
```

That is the whole wiring. From then on the page's errors, its console at error and warn, every
shared document's commits, every ask, the connection status, the URL, and clicks, keys and
submits are recorded, and the server's calls, routes, refusals and failures are recorded beside
them in the same visit.

## What is recorded

**On the page**, by `createLog`:

| kind | what it holds |
|---|---|
| `error`, `rejection` | an uncaught error or a rejected promise: message, and stack when there is one (trimmed to the byte cap, keeping the kind) |
| `console` | a `console.error` or `console.warn` the page made: `level` and `message` |
| `commit` | a shared document changed: the `topic`, the `paths` touched, the delta count, the bytes; never a value |
| `refused`, `fault` | a share the server refused a write to, or a topic that faulted |
| `ask` | a call the page made: `name`, `ms`, `ok`, and the reason when it failed; never the args or the result |
| `status` | the connection went connecting, open or closed |
| `url` | the router's URL changed (when a router is handed in) |
| `input` | a `click`, `keydown` or `submit`: a target descriptor, and for a key, the key when it is not a character |

**On the server**, by `logs/Observe` through the `observe` hook (design 260): a `call`
(`name`, `ms`, `ok`, and the reason when it failed), a `request` (`method`, `path`, `status`,
`ms`), a `refused` commit, a `failed` hook, and the connection opening and closing. A call's
args and result are recorded only for a module whose instance carries `logs: true`; otherwise
their byte size. A request's body is never recorded.

**Once per visit**: the user (from the gate), the build, and the browser (the UA string as it
is, the `userAgentData` brands and platform where the browser offers them, the viewport, screen,
pixel ratio, colour scheme, reduced motion, language and touch).

## The batches the page sends

The client half posts to one route; you never call it by hand, but this is its shape, for a
test or a recorder of your own. A batch is JSON, and identity comes from the request's cookie
through the gate:

```
POST /api/logs
  { "visit": "<id>", "build"?: "...", "browser"?: { ... }, "ended"?: true,
    "entries": [ { "at": 1789170542372, "kind": "error", "message": "..." }, ... ] }
  200 { "kept": 3 }
  400 { "reasons": [ ... ] }     the body is not a batch
  429 { "reasons": [ ... ] }     over a cap
```

`build` and `browser` are read once, from the first batch that carries them; `ended` stamps the
visit's end. An entry is any flat object with a `kind`; `at` defaults to now. There is no read
route: reading a visit is the readers below, in a process you trust.

## What is never recorded

No IP address. No typed value. No character key, and no key at all from a password or hidden
field. No page text. No route body. No commit value. **No value under a leading-underscore
slot**: the recorder watches a shared document through core's `skip(Infinity)`, which never
delivers a delta whose path passes through an object slot whose key starts with an underscore
(design 259), so a `_password` or `_ssn` slot is carried as a commit's shape and never its
value, with nothing to configure. On the server, a call's args and result are carried only when
the called module says `logs: true`, the way `public: true` is a word the gate reads.

This is why a diagnostics recorder is lawful with a privacy-policy line and stays out of the
territory that gets session-replay vendors sued: it records that things happened and their
shape, not their content.

## The store, and reading it back

Each visit is `visit:<id>`, each server run `process:<id>`, an ordinary document with the
fields above and an `entries` list. Read one back with the readers, which take the store and
run in any process:

```ts
import { errors, prune, visit, visits } from '@aweftjs/logs';

const seen = await visit(store, id);                          // one timeline, entries in time order
const theirs = await visits(store, { user, since });          // matches, newest first; each id is `visit:<id>`
const top = await errors(store, { since });                   // messages grouped, most seen first
await prune(store, Date.now() - 30 * 86_400_000);             // drop what is older than 30 days
```

`postgres/views.sql` flattens the documents into `aweft_log_visits` and `aweft_log_entries`
for a reader that speaks SQL, such as a Metabase. Apply it by hand against the store's database;
the battery never runs it.

## Configuring it

Each module is configured the way any battery module is (design 240): a same-named file
exporting `config` in a source before this one. `logs/Visits` holds the caps and the retention,
generous by default:

```ts
// modules/logs/Visits.ts
export const config = {
	keep: 30,            // days a document is kept; the sweep runs on start and hourly
	build: process.env.BUILD_SHA ?? null,
	batch: 500,          // entries a batch may carry
	entry: 4096,         // bytes an entry may take; over it it is trimmed to fit, keeping its kind
	perVisit: 10_000,    // entries a visit may hold; the last is capped and the rest are dropped
	batchesPerMinute: 60,
	visitsPerMinute: 600,
};
```

An application that wants its own retention runs `prune` from a `jobs` row instead of, or beside,
`keep`. `logs/Record`'s one setting is `public`, true by default so an anonymous page may post;
set it false for a route that needs a signed-in user.

## What it never decides

**Who may read.** No module answers a read over the wire, because "allowed" differs in every
application. An application that wants a route or a call over a reader writes the module and
its gate rule, the way it writes any private module.

**Whether to record.** Nothing records until the page calls `createLog` and `logs` is in
`sources`.

**Retention beyond the defaults**, and any per-address cap: the route is handed a request and a
context, never the peer, so the caps here are per visit and per process. A gate that puts the
address in its context gives an application what it needs to cap by address in a module of its
own.

## Known limits

- **No replay.** A commit is recorded as its shape, not its values, so a visit is read, not
  re-run. Recording came first on purpose; replaying a visit against the real page is a later
  step that adds the values back through the same private-slot wildcard.
- **Server output written with `console.log` inside a module is not attributed to a visit.**
  A module that wants a line in the record calls `logs/Visits`'s `write` (name it in `deps`).
  Per-module console capture would need an async-context wrapper around every hook and is not
  here.
- **The process document is held open for the process's life.** `prune` from outside with a
  cutoff later than the process started removes it under the module; the module's own sweep
  skips it.
- **A second library that replaces `console.error` after this one wins.** The page puts the
  console back on `stop`.

The design notes are 259 (the `skip(Infinity)` wildcard), 260 (the `observe` hook on `server`)
and 261 (this battery).
