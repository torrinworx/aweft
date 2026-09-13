# 261: The logs battery

## Decision

`@aweftjs/logs` is a battery: a source of three server modules that keep, per visit, what a
page and the server did, in the application's own store; a client half that records the page;
and readers any process imports. A visit is one page from load to close. Nothing records until
the page calls `createLog`, and nothing is read but through the store.

**The server modules**, configured the way every battery module is (design 240):

- `logs/Visits` is the keeper. It opens `visit:<id>` and `process:<id>` documents, appends
  entries, binds a connection to a visit, offers `write(entry, context?)` to any module that
  names it in `deps` (with a context the entry lands in that connection's visit, without one in
  this process's document), and sweeps. Its `call`, public, takes `{ visit }` from the page once
  per open socket, so the server's events for that connection land in the visit. Its
  configuration and defaults: `keep` 30 (days a document is kept), `sweepMs` 3600000, `batch`
  500 (entries a batch may carry), `entry` 4096 (bytes an entry may take as JSON; over it the
  entry is trimmed to fit, keeping its `kind` and a prefix of its `message`, so an error over the
  budget is still an error and still groups), `perVisit` 10000 (entries a visit may hold; the
  last one is a `capped` sentinel and the rest are dropped), `batchesPerMinute` 60 (per visit),
  `visitsPerMinute` 600 (new visits, this process), `idleMs` 60000 (a visit document is held
  open this long after its last batch), `build` null (written into this process's document). A
  value of the wrong type is refused at load with `invalid-config`, as is a timer setting over
  what a timer can hold (2147483647 ms). The process document has the same cap and a
  different answer to it: once the next entry would be its sentinel, the module closes it and
  opens a fresh `process:<id>`, so the record goes on and the full one waits for the sweep.
- `logs/Record`, public unless configured otherwise, answers `POST /api/logs` with a batch
  `{ visit, build?, browser?, ended?, entries }`: 200 with `{ kept }`, 400 with reasons for a
  body that is not a batch, 429 with reasons over a cap. HTTP is the only transport for a
  batch: `sendBeacon` on `pagehide` is the one delivery a browser makes for a page that is
  leaving, and a page whose socket is the thing that broke still has `fetch`. The identity a
  batch carries is the request's cookie through the gate: `user` on the visit is the latest
  signed-in identity a batch arrived with, and a sign-out does not clear it.
- `logs/Observe` declares the `observe` hook of design 260 and writes each event to the visit
  bound to its context, or to the process document when none is. A call's `args` and `result`
  are written only when the called module's instance carries `logs: true`; otherwise their
  byte size. A request's body is never written.

**The client half.** `createLog(client, options?)` answers `{ client, visit, write, each, flush, stop }`, and
`log.client` is the recording client the page uses everywhere. It hears window `error` and
`unhandledrejection`; `console.error` and `console.warn`, put back on `stop`; every commit on
every document a `share` hands back, through `skip(Infinity)` (design 259), as its shape
(topic, the paths touched, delta count, bytes) and never a value; a share's `refused` and
`fault`; every `ask` with its name, duration and outcome, never its args or result; the
client's `status`; the router's URL when handed a router; `click`, `keydown` and `submit` on
the document as events with a target descriptor (tag, role, accessible label, theme segments
from the class tokens), never a value, a key only when it is not printable, and nothing inside a
password or hidden field. A key is named when it is two or more letters and digits (`Enter`,
`ArrowLeft`, `F5`); whatever a layout produces for a character, one code point or a base letter
with its combining marks, is not. Browser facts once at start: the UA string as the browser
gives it, `userAgentData` brands and platform where offered, viewport, screen, pixel ratio,
colour scheme, reduced motion, language, touch. Batches go by `fetch` with `keepalive` every
`flushMs` (4000) and by `sendBeacon` on `pagehide`, one send in flight at a time; a batch
carries at most `batch` entries (500) and stays under 48000 bytes, because a keepalive request
and a beacon may carry 64 KiB at most across what is in flight and the browser refuses the send
over it. A stack is cut at 8000 characters on the page. The visit id is minted with the stack's
id source and held in memory only, so a reload is a new visit. It never throws into the page,
and it never depends on the socket it records. `visit` is the id, `flush()` sends what is queued
now, and `each(fn)` taps the stream for another consumer on the page. Options: `origin` (the
page's own by default), `build`, `router`, `fetch`, `flushMs`, `batch` (at or under
`logs/Visits`'s, or the route refuses it), and `window` (the global one by default, a seam a
test hands its own).

**What is stored.** `visit:<id>`: `kind`, `user`, `build`, `browser`, `startedAt`, `endedAt`,
`errors`, `entries`. `process:<id>`: `kind`, `build`, `startedAt`, `errors`, `entries`. An
entry is one flat object of primitives: `at`, `side` (`page` or `server`), `kind`, and the
fields of the kind, with anything structured written as JSON text, so a row in the store is a
row in a view. `errors` counts the entries of kind `error`, `rejection`, `failed`, and `console`
at level `error`. An entry over the byte budget loses the fields that make one large first (the
stack, a call's args and result, a commit's paths, a refusal's reasons) and keeps its kind and
its names, so a failed call over the budget still says which module; only past that is the
message cut. The battery truncates its own documents' tails, since nothing replays them.
`paths` declares `kind`, `build`, `startedAt` and `errors` for the application's store, beside
auth's `user`; `kind` is what lets `visits` ask for visits in the query rather than after it.

**The readers**, exported from the root for a script, a harness or a job: `visit(store, id)`
answers one document as plain data with its entries in time order; `visits(store, { user,
build, since, errors, limit })` lists them newest first; `errors(store, { since, build, limit })`
groups the error entries by message, kind and build with a count, a visit count, and the first
and last time seen; `prune(store,
olderThan)` removes every visit and process document that started before that time.
`postgres/views.sql` is one view per document kind over `aweft_rows`, for a reader that speaks
SQL, applied by hand.

**What it never does.** Decide who may read: no module answers a read over the wire. Record
without being asked. Store an address, a typed value, a printable key, a field a password or
hidden input holds, the text of the page, a request body, a commit's values, a value under a
leading-underscore slot, or a call's args and result for a module that did not say so. Parse a
UA string. Pick a URL but the one route.

## Why

The identity half existed: the gate puts `user` in every context, so a visit links to a user
when the auth battery is loaded and stands alone when it is not, with no user battery needed.
The state half existed: the store keeps every commit. What did not exist was anything about the
page, and the store's tail records no time and no actor (design 056), so "what did this person
see, and when" had nowhere to come from. A visit document is that record, and it is a
document so that `find`, `since`, `truncate` and `debug` already work on it and a Metabase view
is a flatten over rows the store already writes.

The commit stream is recorded as shape and not values, because values are the one place the
record would copy a person's content into a second document under a different retention, and
the job is finding the failure, not replaying it; replay is a later step, and the wildcard of
design 259 is what will make its values safe for the slots an author marked.

The underscore rule is the whole redaction rule on purpose. An author who knows the stack
knows `_x` is private from wildcard observers, and a recorder is one; the battery holds no
list of sensitive names and no flag to set. On the server a call's args are plain values with
no rule to read, so the module that owns them says whether they may be written, in the one
word `logs: true`, the way `public: true` is the gate's word.

The caps are per visit and per process rather than per address, because a route is handed a
request and a context and never the peer, and reading a forwarding header here would be a
second copy of the listener's rule. A gate that puts the address in its context gives an
application what it needs to cap by address in a module of its own.

## What this costs

Each batch is one commit on the visit document, one row per entry, and one truncation. A visit
that fills its cap is ten thousand rows. A page that shares a busy document writes one entry
per commit it sees, which is the page's own traffic again as text.

An observer runs on every server event, and `logs/Observe` looks up the visit for each; a
server with the battery loaded pays that on every call and request.

The process document is held open until it fills or the process ends. `prune` from outside the
module with a cutoff later than the process's start removes it under the module, and what the
process writes after that is lost until it fills or restarts; the module's own sweep skips it.
Entries into it go one at a time, so a full one rotates once.

`console.error` and `console.warn` are replaced on the page while a log runs, and a second
library that replaces them after this one wins.

Server output written with `console.log` inside a module is not attributed to a visit; a module
that wants a line in the record calls `write`.

## Evidence

`packages/logs/tests/`: `visits.test.ts` (the documents, the caps, `write` with and without a
context, binding, the sweep, the process document rotating when full, two first writes opening
a document once, a trimmed entry keeping its name, `invalid-config` for a wrong type and for a
timer over its bound), `record.test.ts` (the route: a batch kept, `user` from the cookie and
kept across a sign-out, `browser` and `build` written once, `ended`, a body that is not a
batch, 429 over each cap, two anonymous sockets under the auth gate as two visits),
`observe.test.ts` (every event kind written to the bound visit or the process document,
`logs: true` read off the instance, a body never written, a binary result measured as bytes),
`client.test.ts` (each source recorded through a fake window, console put back, a `_secret`
commit recorded as shape with the path absent, a printable key absent, a key of a base letter
and combining marks absent, a password field's key absent, the socket never touched, a batch
cut at the count and under the bytes a keepalive send may carry, one send in flight at a time,
`sendBeacon` on `pagehide` for every batch left, a throwing sink swallowed),
`readers.test.ts` (each reader over a memory store, `visits` answering its limit in visits),
`views.test.ts` (the SQL views over a throwaway database, skipped without one),
`surface.test.ts`. `recipes/logs` drives a page in
Chromium through the full-stack shape and reads the visit back with the readers.

## What would reverse this

A need to record commit values, which is the replay step and a `values` option on `createLog`
rather than a change here. A need for the peer address on a batch, which is the gate's to put
in the context. A driver with a raw append path, which does not exist and which this design
says is not needed.
