// What a row says, what the scheduler writes back, and what the application hands in
// (designs 075, 076).

import { codecError } from '@aweftjs/codec';

/** What the scheduler writes onto a row about its most recent run. */
export interface Last {
	/** When the run started, in milliseconds since the epoch. */
	started: number;
	/**
	 * When the run ended. Absent while it runs, and absent for good when the process died
	 * before it ended: nothing resumes such a run, and the next one overwrites this record.
	 */
	ended?: number;
	status: 'running' | 'ok' | 'failed';
	/** What `run` threw, when it threw: its message, and its `reason` when it carried one. */
	error?: { message: string; reason?: string };
}

/**
 * A row in the array: when to run, and whatever else the application keeps beside it.
 *
 * Exactly one of `at`, `every` and `cron`, and `tz` beside `cron`. The scheduler reads those
 * four, writes `last`, and ignores every other field, which is where the application keeps
 * what the job is.
 */
export interface Job {
	/** Run once, at this time in milliseconds since the epoch. A time already past runs now. */
	at?: number;
	/** Run this many milliseconds apart, starting one interval after the row is scheduled. */
	every?: number;
	/** Run on a five-field cron expression, read against the clock on the wall in `tz`. */
	cron?: string;
	/** An IANA time zone name. Required beside `cron`; there is no default. */
	tz?: string;
	/** The most recent run. Written by the scheduler; read by anyone. */
	last?: Last;
	[key: string]: unknown;
}

/**
 * Does the job. Awaited; what it returns is ignored; what it throws lands on the row as
 * `last.error` and reaches `handlers.failed`.
 *
 * Params:
 *   job: the row, as it is in the array
 *   context.due: the millisecond time this fire was scheduled for. It is earlier than now when
 *     the fire is late: a one-off added with an `at` already past, or a periodic fire the
 *     process slept through, which runs once on waking with the due it had
 */
export type Run = (job: Job, context: { readonly due: number }) => unknown;

export interface SchedulerHandlers {
	/**
	 * Called with a row that cannot be scheduled and the reason, or with a row whose `run`
	 * threw and what it threw. Without a handler the error is raised where nothing catches it,
	 * on purpose.
	 */
	readonly failed?: ((job: Job, error: unknown) => void) | undefined;
}

/** Where time comes from. The real clock is the only one that ships; a test hands in its own. */
export interface Clock {
	now(): number;
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export interface SchedulerOptions {
	/** An observable array from `@aweftjs/core`, so the scheduler can follow it. */
	readonly jobs: readonly Job[];
	readonly run: Run;
	readonly handlers?: SchedulerHandlers | undefined;
	readonly clock?: Clock | undefined;
}

export interface Scheduler {
	/**
	 * Cancel every timer, stop following the array, and wait for the runs in flight to
	 * settle. A `run` that never returns keeps this waiting; its timeout is the application's.
	 */
	stop(): Promise<void>;
}

/**
 * An error this package raises, with a reason a caller can branch on.
 *
 * Reasons: `missing` (`createScheduler` without `jobs` or `run`), `not-a-list` (`jobs` is not
 * an observable array), `invalid` (a row that cannot be scheduled; the message names the
 * field). A run that throws reaches `handlers.failed` as it was thrown, not wrapped.
 */
export interface JobsError extends Error {
	readonly reason: string;
}

export const jobsError = (reason: string, detail: string, fix: string): JobsError =>
	codecError(reason, detail, fix);
