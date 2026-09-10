# @aweftjs/jobs

A scheduler over an array of rows you hand in. Each row says when; you say what runs. It
writes one thing back onto a row, `last`, and decides nothing else: not what a job is, not
who may schedule one, not whether the list is stored, and nothing about retries, queues or
catching up.

## Quickstart

```ts
import { createArray, createObject } from '@aweftjs/core';
import { createScheduler } from '@aweftjs/jobs';
import type { Job } from '@aweftjs/jobs';

const jobs = createArray<Job>([
	createObject({ name: 'digest', cron: '0 7 * * *', tz: 'America/Toronto' }),
	createObject({ name: 'cleanup', every: 60 * 60 * 1000 }),
	createObject({ name: 'remind', at: Date.parse('2026-09-05T15:00:00Z') }),
]);

const scheduler = createScheduler({
	jobs,
	run: async (job, { due }) => { await work(String(job.name), due); },
	handlers: { failed: (job, error) => log.warn(job.name, error) },
});
// ...
await scheduler.stop();
```

Two things, both required, and a handler. **The array** is an `@aweftjs/core` observable
array (`createArray`), because the scheduler follows it; a plain array is refused. **`run`**
is called with the row and `{ due }`, the millisecond time the fire was scheduled for, and is
awaited; what it returns is ignored. Everything on a row besides the four fields below is
yours: a name, a module and a method, arguments, an owner.

## A row

| field | means | example |
|---|---|---|
| `at` | once, at this time in milliseconds since the epoch | `Date.parse('2026-09-05T15:00:00Z')` |
| `every` | this many milliseconds apart, the first one interval after the row is seen | `3_600_000` |
| `cron` | on a five-field expression, read on the wall clock of `tz` | `'0 7 * * MON-FRI'` |
| `tz` | an IANA zone name, required beside `cron` | `'America/Toronto'` |

Exactly one of `at`, `every` and `cron`. A cron expression is minute, hour, day of month,
month and day of week: each `*`, a value, a range `9-17`, or a list of those, each with an
optional `/step`; months and weekdays may be named; Sunday is `0` or `7`; when both day
fields are given, a day that matches either one runs, which is cron's own rule.

A row that cannot be scheduled (none or two of the three, `cron` without `tz`, a zone the
runtime does not know, an expression that does not parse, one that does not occur in the four
years ahead, `every` that is not a positive number) is reported once to `handlers.failed` with
`reason: 'invalid'` and a message naming the field, and is not scheduled. Fix the row and it
is. The report comes once the walk that found the row is over, so a handler may edit the
array; for a row already in the array when the scheduler is made, it comes after
`createScheduler` has returned, so a handler may `stop()`.

## What it writes

`last`, the record of the row's most recent run:

```ts
{ started: 1772892000000, status: 'running' }                                    // while it runs
{ started: 1772892000000, ended: 1772892000412, status: 'ok' }                    // afterwards
{ started: 1772892000000, ended: 1772892000009, status: 'failed', error: { message: 'no rows', reason: 'empty' } }
```

That is all it writes. A run in flight when the process died is what its row says it is:
`running`, with no `ended`, until the next run overwrites it. Nothing resumes it, and a
one-off in that state is done: it started once, and it runs again only if you move `at` past
that start or `delete row.last`. If you assign your own `last` onto a row while a run is in
flight, the scheduler's record of that run has nowhere to go and is dropped.

Because `last` is on the row, a list you keep in a store is its own log: the store keeps the
document's history. A list you share over a link is a live admin page with no RPC: the page
edits a row's `cron` or removes it, and the scheduler follows the edit.

## Following the array

A row pushed is scheduled. A row removed has its timer cancelled, and a run of it already in
flight finishes without writing back. A row whose `at`, `every`, `cron` or `tz` changes is
rescheduled; a change to any other field, `last` included, is not an edit. None of it needs a
restart. Two schedulers over one array both run every row: make one.

## Time

**Nothing is made up.** On start, and after every run, a periodic row's next fire is computed
from now: the first `every` interval past now on the row's own grid, or the first cron minute
after now. A process asleep for a week brings an hourly row back with one run, not 168, and
that run's `due` is the slot it was armed for, so `run` can see how late it is. A one-off
`at` in the past runs once, on start, unless its `last.started` shows it already ran;
to run it again, move `at` past that start or `delete row.last`. A job that must make up for
every slot it missed keeps its own cursor on the row and does so inside `run`, with `due` and
`last.started` to work from.

**A row still running when it comes due is skipped that time**, and the fire after is found
from now. A row never runs concurrently with itself.

**A cron reads the wall clock of its zone.** On the day the clocks go forward a wall time that
does not exist (02:30 in Toronto) is not run that day; on the day they go back a wall time that
occurs twice runs twice. `tz` has no default, because a wrong zone is silent for weeks and a
missing field is loud once.

A wait longer than a timer can hold is taken in pieces. February 29 is found in whatever year
it is asked for.

## When something throws

A `run` that throws lands `failed` on the row, with the error's message and its `reason` when
it had one, reaches `handlers.failed(job, error)` with what was thrown, and does not touch the
schedule: the next fire is found as usual. Without a handler the error is raised where nothing
catches it, and the process says so; that is on purpose, the same as `follow` and `server`.

## Stopping

`stop()` cancels every timer, stops following the array, and resolves once the runs in flight
have settled. A `run` that never returns keeps it waiting; a timeout on a run is yours.

## Keeping the list, and running a module

The array can be the root of a document in a store, so the schedule and every `last` survive
the process:

```ts
const handle = await store.open('jobs', 'array');
const scheduler = createScheduler({ jobs: handle.root as Job[], run });
```

What runs is yours. The form that loads a module and calls a method on it is one line, and
because a sandbox has `load` too, the same line runs a module a stranger wrote in a room:

```ts
run: async (job) => {
	const name = String(job.module);
	const instance = (await loader.load([name]))[name] as Record<string, (args: unknown) => unknown>;
	return instance[String(job.method)]!(job.args);
},
```

## Testing a schedule

`clock` is `{ now, setTimeout, clearTimeout }`. Hand in your own and a week of schedule runs in
a millisecond, with every fire at a time you chose; nothing else changes. The real clock is
the only one that ships.

## What this package never decides

What a job is or does. Who may add, edit or remove a row. Whether the array is stored, or
shared. Catch-up, retries, queues, progress, notifications, and which process runs a row.

Every error this package raises carries a `reason`: `missing` (`createScheduler` without `jobs` or
`run`), `not-a-list` (`jobs` is not an observable array), `invalid` (a row that cannot be
scheduled). The design notes are in
[`docs/design/`](https://github.com/torrinworx/aweft/tree/main/docs/design) 075 and 076.