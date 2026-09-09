# 076: The scheduler writes `last` onto the row, and never makes up a fire

## Decision

The scheduler writes one thing onto a row: `last`, the record of its most recent run.
`{ started, status: 'running' }` when the run starts, replacing the previous run's record;
`ended` and `status: 'ok'` or `'failed'` when it ends, in one commit, with `error` as
`{ message, reason? }` when `run` threw, as a call row records an error (design 068).

Time that has passed is never made up:

- On start, and after every run, a periodic row's next fire is computed from now: the first
  `due + every` past now, or the first cron occurrence after now. A fire the process slept
  through, or skipped because the row was still running, is not run later. A process down
  for three days brings an hourly row back with one run.
- A one-off `at` in the past runs once, on start, unless the row shows it already ran: a
  `last.started` at or after `at`. Once, not once per restart. Setting `at` later, or removing
  `last`, runs it again.
- A row still running when its next fire is due is skipped that time; the fire after is
  scheduled from now.
- A run in flight when the process died is what the row says it is: `last.status` is
  `running` and `ended` is absent, until the next run overwrites it. Nothing resumes the run
  and nothing retries it.
- `tz` on a cron row has no default: a cron row without one is refused. A cron is read
  against the clock on the wall in that zone: a wall time that does not exist on a
  daylight-saving day is skipped that day, and one that occurs twice fires twice.

## Why

The shape is `last` on the row, no catch-up, `tz` required, overlap skipped, and an
interrupted run left as it was.

No catch-up because catching up is a policy about the job, not about time: one application
wants a missed nightly digest to run at noon and another wants its scrapers to wait for the
next slot rather than stampede a rate-limited API at boot. The scheduler cannot know which,
and the row carries what a `run` needs to decide for itself: `due` says when the fire was
scheduled for and `last.started` says when it last ran.

No default zone because a wrong zone is silent for weeks and a missing field is loud once.
The stack ships no value anywhere else.

Overlap skipped rather than queued or run concurrently because a queue is what the package is
not, and two concurrent runs of one row is what `running` on `last` exists to make visible.

The clock-on-the-wall reading of a cron over a daylight-saving change is the plain one:
every minute the wall clock shows is checked once, in order. A rule that runs a skipped
2:30 job at 3:00 instead, or runs a repeated 1:30 job once, is a second rule on top, and the
one job in this stack's applications that sits near the change (`0 3 * * 0`) is unaffected
either way.

## What it costs

A job that must run for every slot it missed keeps its own cursor in the row and catches up
inside `run`. A run interrupted by a crash is not distinguishable from one still running
except by the process being gone; the README says so. A job at 2:30 does not run on the day
the clocks go forward.

## What would reverse this

A stack application whose `run` cannot tell a missed slot from a first run with what the row
carries. The answer is a field on the row, in a new design note, not a catch-up in the
scheduler.
