# 075: The schedule is an array the application hands in, and the application runs the job

## Decision

`createScheduler({ jobs, run, handlers, clock })` returns `{ stop }`. That is the package.

- `jobs` is an observable array from `core`, made by the application: `createArray()` for a
  list that lives in memory, or the root of a document opened through a store for one that
  persists. The scheduler follows it: a row pushed is scheduled, a row removed has its timer
  cancelled, a row whose schedule fields change is rescheduled, none of it needing a restart.
  It is the only source of schedules; nothing reads a schedule off a module.
- A row says when, with exactly one of `at` (a millisecond time, once), `every` (milliseconds
  apart) and `cron` (five fields, with `tz` required beside it), and every other field on the
  row is the application's. The scheduler reads those four and writes `last` (design 076).
- `run(job, { due })` is the application's, awaited, its return value ignored. It is handed
  the row itself and the millisecond time the fire was scheduled for. What a job is, and what
  running it means, is decided there: the form that loads a module and calls a method is one
  line in the README, and a sandbox works with no special case.
- `handlers.failed(job, error)` hears a row that cannot be scheduled (none or two of the three,
  `cron` without `tz`, a zone the runtime does not know, a cron that does not parse or does not
  occur in the four years ahead (so February 29 is always found), `every` that is not a positive number) and a run that threw, the
  error as it was thrown. Without a handler the error is raised where nothing catches it, as
  `follow` and `server` do. A bad row is reported once, when it is first seen in that state,
  and an edit that makes it valid schedules it.
- `clock` is `{ now, setTimeout, clearTimeout }`; the real one is the only value that ships.
- `stop()` cancels every timer, stops following the array, and resolves once the runs in
  flight have settled.

The package is tier 7, server plane, and imports `core` and nothing else. Errors carry a
`reason`: `missing`, `not-a-list`, `invalid`.

## Why

There is no dashboard and no store: an array is passed into the scheduler, holding the jobs
that run, and that list is kept in a database or not, as the application likes. The scheduler
is not responsible for a queue or for retries; both sit above scheduling and are application
logic.

An array the application makes is the shape `sandbox` already takes for `grants`: the
package follows a list it does not own, and whether that list is stored, shared over a link,
or edited by a page is the application's business and costs the package nothing. A stored
array is its own log, because the store keeps the document's history; a shared one is a live
admin page, because a page edits the row and the scheduler follows the edit, with no RPC.

`run` from the application rather than a row naming a module and a method, because a
scheduler that called `load` would be deciding how arguments cross, what happens when a
module is not loaded, and whether to unload afterwards, which are decisions about modules
and not about time. Following the array rather than snapshotting it, because handing in a live
list means the list is live.

Measured: one watcher on a core array hears a row pushed, a field edited on that row, an
object written onto it, an atomic block as one, and the row removed, five changes and five
deliveries. Following rests on nothing new.

## What it costs

An application that declares schedules in code pushes a row per schedule itself. A form that
wants to refuse a bad cron before pushing it has no export to ask: it pushes and hears
`failed`. Two schedulers
over one array both run every row: one scheduler per array, and the README says so.

## What would reverse this

An application that needs the scheduler to know what a module is. The answer then is a helper
above this package, not a change to it.
