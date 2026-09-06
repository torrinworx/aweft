// One scheduler over one array (design 075), writing `last` and making up nothing
// (design 076).

import { atomic, createObject, isObservable, observer, pathOf } from '@aweftjs/core';

import {
	type Clock, type Job, type Last, type Scheduler, type SchedulerHandlers, type SchedulerOptions, jobsError,
} from './contract.ts';
import { type CronSpec, knownZone, nextCron, parseCron } from './cron.ts';

/** What a timer accepts. A longer wait is taken in pieces. */
const MAX_DELAY = 2 ** 31 - 1;

type Plan =
	| { readonly kind: 'at'; readonly at: number }
	| { readonly kind: 'every'; readonly every: number }
	| { readonly kind: 'cron'; readonly spec: CronSpec; readonly tz: string };

interface Entry {
	/** The schedule fields as last read, so a write of `last` is told from an edit. */
	key: string;
	/** Absent while the row cannot be scheduled. */
	plan: Plan | undefined;
	cancel: (() => void) | undefined;
	/** Whether this scheduler ran the row's one-off itself, so `at` is not read off `last`. */
	ran: boolean;
	running: Promise<void> | undefined;
}

const realClock: Clock = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const wait = (clock: Clock, ms: number, fn: () => void): (() => void) => {
	let handle: unknown;
	let cancelled = false;
	const arm = (remaining: number): void => {
		const piece = Math.min(remaining, MAX_DELAY);
		handle = clock.setTimeout(() => {
			if (cancelled) return;
			if (remaining > piece) arm(remaining - piece);
			else fn();
		}, piece);
	};
	arm(Math.max(0, ms));
	return () => { cancelled = true; clock.clearTimeout(handle); };
};

const keyOf = (job: Job): string => JSON.stringify([job.at, job.every, job.cron, job.tz]);

const planOf = (job: Job): Plan => {
	const given = (['at', 'every', 'cron'] as const).filter((field) => job[field] !== undefined);
	if (given.length !== 1) {
		throw jobsError(
			'invalid',
			`a row needs exactly one of at, every and cron; this one has ${given.length === 0 ? 'none' : given.join(' and ')}`,
			'Give the row one of at, every or cron, and tz beside cron.',
		);
	}
	if (job.at !== undefined) {
		if (typeof job.at !== 'number') {
			throw jobsError('invalid', 'at must be a number of milliseconds since the epoch', 'Set at to a number, as Date.now() gives one.');
		}
		return { kind: 'at', at: job.at };
	}
	if (job.every !== undefined) {
		if (typeof job.every !== 'number' || job.every <= 0) {
			throw jobsError('invalid', 'every must be a positive number of milliseconds', 'Set every to a positive number of milliseconds.');
		}
		return { kind: 'every', every: job.every };
	}
	if (typeof job.cron !== 'string') {
		throw jobsError('invalid', 'cron must be a string of five fields', 'Write five fields: minute, hour, day, month and weekday.');
	}
	if (typeof job.tz !== 'string' || job.tz === '') {
		throw jobsError('invalid', 'a cron row needs tz, an IANA time zone name; there is no default', 'Add tz to the row, such as America/Toronto.');
	}
	if (!knownZone(job.tz)) {
		throw jobsError('invalid', `tz "${job.tz}" is not a time zone this runtime knows`, 'Use an IANA time zone name, such as America/Toronto.');
	}
	return { kind: 'cron', spec: parseCron(job.cron), tz: job.tz };
};

const describe = (error: unknown): Last['error'] => {
	const message = error instanceof Error ? error.message : String(error);
	const reason = (error as { reason?: unknown } | null)?.reason;
	return typeof reason === 'string' ? { message, reason } : { message };
};

/**
 * Make a scheduler over an array of rows.
 *
 * Params:
 *   jobs: an observable array from `@aweftjs/core` (`createArray`, or the root of a document
 *     a store opened as an array). Each row carries exactly one of `at`, `every` and `cron`,
 *     with `tz` beside `cron`; everything else on a row is yours.
 *   run: what to do when a row is due. Called with the row and `{ due }`, awaited.
 *   handlers.failed: hears a row that cannot be scheduled, and a run that threw. Without it
 *     the error is raised where nothing catches it. A row that cannot be scheduled is reported
 *     once the walk that found it is over, and, for a row already in the array when the
 *     scheduler is made, after `createScheduler` has returned.
 *   clock: `{ now, setTimeout, clearTimeout }`. The real clock unless you hand one in.
 *
 * Returns: the scheduler, which is `stop()`.
 *
 * Throws: a JobsError. `missing` without `jobs` or `run`, `not-a-list` when `jobs` is not an
 * observable array. A row that cannot be scheduled is `invalid`, reported to `handlers.failed`
 * rather than thrown from here.
 *
 * The scheduler follows the array: a row pushed is scheduled, a row removed has its timer
 * cancelled, a row whose `at`, `every`, `cron` or `tz` changes is rescheduled. It writes
 * `last` onto a row when a run starts and when it ends, and nothing else. A periodic row's
 * next fire is always computed from now, so nothing missed is made up; a one-off `at` in the
 * past runs once. Two schedulers over one array both run every row: make one.
 *
 * Example:
 *   const jobs = createArray<Job>([createObject({ cron: '0 7 * * *', tz: 'America/Toronto', name: 'digest' })]);
 *   const scheduler = createScheduler({ jobs, run: (job) => digest(job.name) });
 *   // ...
 *   await scheduler.stop();
 */
export const createScheduler = (options: SchedulerOptions): Scheduler => {
	const jobs = options?.jobs;
	const run = options?.run;
	if (jobs === undefined) {
		throw jobsError('missing', 'createScheduler needs jobs, the array of rows', 'Pass both: createScheduler({ jobs, run }).');
	}
	if (typeof run !== 'function') {
		throw jobsError('missing', 'createScheduler needs run, the function that does a job', 'Pass both: createScheduler({ jobs, run }).');
	}
	if (!Array.isArray(jobs) || !isObservable(jobs)) {
		throw jobsError(
			'not-a-list',
			'jobs must be an observable array from @aweftjs/core (createArray), so the scheduler can follow it',
			'Build the array with createArray from @aweftjs/core.',
		);
	}
	const handlers: SchedulerHandlers = options.handlers ?? {};
	const clock = options.clock ?? realClock;

	const entries = new Map<Job, Entry>();
	let stopping: Promise<void> | undefined;

	// Without a handler the error is thrown from a fresh microtask, where nothing catches it
	// and the process reports it as uncaught. A handler that throws is treated the same way.
	// While the array is being walked, nothing of the application's runs: a report made then
	// is held until the walk is over, so a handler that edits the array edits nothing mid-walk.
	const raise = (error: unknown): void => queueMicrotask(() => { throw error; });
	let held: [Job, unknown][] | undefined;
	const report = (job: Job, error: unknown): void => {
		if (held !== undefined) { held.push([job, error]); return; }
		if (handlers.failed === undefined) { raise(error); return; }
		try { handlers.failed(job, error); } catch (thrown) { raise(thrown); }
	};

	/** The next fire, or undefined when there is none. `previous` is the fire just taken. */
	const nextDue = (job: Job, entry: Entry, plan: Plan, previous: number | undefined): number | undefined => {
		const now = clock.now();
		switch (plan.kind) {
			case 'at': {
				if (entry.ran) return undefined;
				const started = job.last?.started;
				return typeof started === 'number' && started >= plan.at ? undefined : plan.at;
			}
			case 'every': {
				if (previous === undefined || previous > now) return (previous ?? now) + plan.every;
				return previous + (Math.floor((now - previous) / plan.every) + 1) * plan.every;
			}
			case 'cron': {
				// From the later of now and the fire just taken: a timer that fired a moment early,
				// or a clock that stepped back, must not name the same minute twice.
				const due = nextCron(plan.spec, plan.tz, previous === undefined ? now : Math.max(now, previous));
				if (due === undefined) {
					entry.plan = undefined;
					report(job, jobsError(
						'invalid',
						`cron "${String(job.cron)}" does not occur in the four years ahead`,
						'Write a cron expression whose day and month can fall together.',
					));
				}
				return due;
			}
		}
	};

	const schedule = (job: Job, entry: Entry, previous: number | undefined): void => {
		entry.cancel?.();
		entry.cancel = undefined;
		if (stopping !== undefined || entry.plan === undefined) return;
		const due = nextDue(job, entry, entry.plan, previous);
		if (due === undefined) return;
		entry.cancel = wait(clock, due - clock.now(), () => fire(job, entry, due));
	};

	// The row may have left the array, or the application may have replaced `last`, while the
	// run went on. Then the record has nowhere to go: core refuses a write nothing reaches.
	const finish = (last: Last, status: 'ok' | 'failed', error?: Last['error']): void => {
		if (pathOf(last) === undefined) return;
		atomic(() => {
			last.ended = clock.now();
			last.status = status;
			if (error !== undefined) last.error = createObject(error);
		});
	};

	const execute = async (job: Job, due: number): Promise<void> => {
		const last = createObject<Last>({ started: clock.now(), status: 'running' });
		job.last = last;
		try {
			await run(job, { due });
			finish(last, 'ok');
		} catch (error) {
			finish(last, 'failed', describe(error));
			report(job, error);
		}
	};

	const fire = (job: Job, entry: Entry, due: number): void => {
		entry.cancel = undefined;
		if (stopping !== undefined) return;
		// Still running from the last fire, which an edit re-armed under: this fire is skipped,
		// and the next is found from now.
		if (entry.running !== undefined) { schedule(job, entry, due); return; }
		if (entry.plan?.kind === 'at') entry.ran = true;
		// On the entry before `run` is called, so a `stop()` from inside `run` waits for it too.
		let settle: () => void = () => undefined;
		entry.running = new Promise<void>((resolve) => { settle = resolve; });
		execute(job, due).then(() => {
			entry.running = undefined;
			settle();
			// The row may have left the array, or been edited into a new entry, while it ran.
			if (entries.get(job) === entry) schedule(job, entry, due);
		});
	};

	const walk = (): void => {
		const present = new Set<Job>();
		for (const job of jobs) {
			present.add(job);
			const key = keyOf(job);
			let entry = entries.get(job);
			if (entry !== undefined && entry.key === key) {
				// A one-off this scheduler ran, whose record was deleted: the row asks to run again.
				if (entry.ran && job.last === undefined) { entry.ran = false; schedule(job, entry, undefined); }
				continue;
			}
			if (entry === undefined) {
				entry = { key, plan: undefined, cancel: undefined, ran: false, running: undefined };
				entries.set(job, entry);
			} else {
				entry.key = key;
				entry.ran = false;
				entry.cancel?.();
				entry.cancel = undefined;
			}
			try {
				entry.plan = planOf(job);
			} catch (error) {
				entry.plan = undefined;
				report(job, error);
				continue;
			}
			schedule(job, entry, undefined);
		}
		for (const [job, entry] of entries) {
			if (present.has(job)) continue;
			entry.cancel?.();
			entries.delete(job);
		}
	};

	const rescan = (later: boolean): void => {
		if (stopping !== undefined) return;
		const found: [Job, unknown][] = [];
		held = found;
		try { walk(); } finally { held = undefined; }
		const deliver = (): void => { for (const [job, error] of found) report(job, error); };
		if (later) queueMicrotask(deliver);
		else deliver();
	};

	rescan(true);
	const unwatch = observer(jobs).watch(() => { rescan(false); });

	const stop = (): Promise<void> => {
		if (stopping !== undefined) return stopping;
		unwatch();
		const inFlight: Promise<void>[] = [];
		for (const entry of entries.values()) {
			entry.cancel?.();
			entry.cancel = undefined;
			if (entry.running !== undefined) inFlight.push(entry.running);
		}
		entries.clear();
		stopping = Promise.allSettled(inFlight).then(() => undefined);
		return stopping;
	};

	return { stop };
};
