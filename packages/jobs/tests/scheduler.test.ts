// The scheduler through its public surface, on a clock the test drives.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createArray, createObject } from '@aweftjs/core';

import { createScheduler } from '../src/index.ts';
import type { Job, JobsError, Last, Scheduler } from '../src/index.ts';
import { DAY, HOUR, START, drivenClock, settle } from './helpers.ts';

interface Ran { readonly job: Job; readonly name: string; readonly due: number; readonly at: number }

const setup = (start = START, options: { early?: number } = {}) => {
	const driven = drivenClock(start, options);
	const jobs = createArray<Job>();
	const runs: Ran[] = [];
	const failed: { name: string; error: unknown }[] = [];
	let behaviour: (job: Job) => unknown = () => undefined;
	const scheduler = createScheduler({
		jobs,
		clock: driven.clock,
		run: async (job, { due }) => {
			runs.push({ job, name: String(job.name), due, at: driven.clock.now() });
			return behaviour(job);
		},
		handlers: { failed: (job, error) => { failed.push({ name: String(job.name), error }); } },
	});
	/** A run that takes this long on the driven clock. */
	const takes = (ms: number) => (): Promise<void> => new Promise((resolve) => { driven.clock.setTimeout(resolve, ms); });
	/** Stop, letting a run still waiting on the driven clock finish. */
	const finish = async (): Promise<void> => { const stopping = scheduler.stop(); await driven.advance(DAY); await stopping; };
	return { ...driven, jobs, runs, failed, scheduler, act: (fn: (job: Job) => unknown) => { behaviour = fn; }, takes, finish };
};

const row = (fields: Job): Job => createObject<Job>(fields);
/** Read `last` fresh: an assertion on it narrows the property for the rest of a test. */
const lastOf = (job: Job): Last | undefined => job.last;
const reasonOf = (error: unknown): string => (error as JobsError).reason;

test('refuses to be made without jobs or run, or over anything but an observable array', () => {
	const run = () => undefined;
	assert.throws(() => createScheduler({ run } as never), (e: unknown) => reasonOf(e) === 'missing' && /jobs/.test((e as Error).message));
	assert.throws(() => createScheduler({ jobs: createArray() } as never), (e: unknown) => reasonOf(e) === 'missing' && /run/.test((e as Error).message));
	assert.throws(() => createScheduler({ jobs: [row({ at: 1 })], run }), (e: unknown) => reasonOf(e) === 'not-a-list');
	assert.throws(() => createScheduler({ jobs: createObject() as never, run }), (e: unknown) => reasonOf(e) === 'not-a-list');
	assert.throws(() => createScheduler(undefined as never), (e: unknown) => reasonOf(e) === 'missing');
});

test('a one-off fires at its time, once, with due, and last is written when it starts and when it ends', async () => {
	const s = setup();
	const once = row({ name: 'once', at: START + 5000 });
	let seen: string | undefined;
	s.act((job) => { seen = `${job.last?.status} ${String(job.last?.ended)}`; });
	s.jobs.push(once);
	await s.advance(4999);
	assert.equal(s.runs.length, 0);
	assert.equal(once.last, undefined);
	await s.advance(1);
	assert.equal(s.runs.length, 1);
	assert.equal(s.runs[0]!.due, START + 5000);
	assert.equal(s.runs[0]!.at, START + 5000);
	assert.equal(s.runs[0]!.job, once, 'run is handed the row itself');
	assert.equal(seen, 'running undefined', 'while it runs, last says so and has no end');
	assert.deepEqual({ ...lastOf(once) }, { started: START + 5000, ended: START + 5000, status: 'ok' });
	await s.advance(DAY);
	assert.equal(s.runs.length, 1);
	assert.equal(s.armed(), 0, 'nothing is left armed for a one-off that ran');
	await s.scheduler.stop();
});

test('a one-off already past runs now, once, with the due it had', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'late', at: START - 60_000 }));
	await s.advance(0);
	assert.equal(s.runs.length, 1);
	assert.equal(s.runs[0]!.due, START - 60_000);
	assert.equal(s.runs[0]!.at, START);
	await s.advance(DAY);
	assert.equal(s.runs.length, 1);
	await s.scheduler.stop();
});

test('a one-off the row shows already ran does not run again; moving at past its last start, or deleting last, runs it again', async () => {
	const s = setup();
	const done = row({ name: 'done', at: START - 100, last: createObject({ started: START - 100, ended: START - 90, status: 'ok' }) });
	s.jobs.push(done);
	await s.advance(DAY);
	assert.equal(s.runs.length, 0, 'a reopened one-off that already ran stays run');

	done.at = s.clock.now() + 100;
	await s.advance(100);
	assert.equal(s.runs.length, 1, 'moving at past the last start runs it once more');
	await s.advance(DAY);
	assert.equal(s.runs.length, 1);

	delete done.last;
	await s.advance(0);
	assert.equal(s.runs.length, 2, 'deleting last runs it again');
	assert.equal(lastOf(done)?.status, 'ok');
	await s.advance(DAY);
	assert.equal(s.runs.length, 2);
	await s.scheduler.stop();
});

test('every fires one interval after the row is seen, keeps its cadence, and a slow run does not shift it', async () => {
	const s = setup();
	s.act(s.takes(300));
	s.jobs.push(row({ name: 'tick', every: 1000 }));
	await s.advance(999);
	assert.equal(s.runs.length, 0);
	await s.advance(1);
	assert.equal(s.runs.length, 1);
	assert.equal(s.runs[0]!.due, START + 1000);
	await s.advance(1000);
	assert.equal(s.runs.length, 2);
	assert.equal(s.runs[1]!.due, START + 2000, 'the next fire is a whole interval after the last due, not after the last end');
	assert.equal(s.runs[1]!.at, START + 2000);
	await s.finish();
});

test('a clock that jumps gives a periodic row one fire, and the cadence carries on from its own grid', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'tick', every: 1000 }));
	await s.advance(1000);
	assert.equal(s.runs.length, 1);
	s.jump(10_500);                          // asleep through ten fires
	await s.advance(0);
	assert.equal(s.runs.length, 2, 'one fire for the whole gap');
	assert.equal(s.runs[1]!.due, START + 2000, 'the fire that was due when the sleep began');
	await s.advance(499);
	assert.equal(s.runs.length, 2);
	await s.advance(1);
	assert.equal(s.runs.length, 3);
	assert.equal(s.runs[2]!.due, START + 12_000, 'the next fire on the grid past now');
	await s.scheduler.stop();
});

test('a timer that fires a moment early, or a clock that steps back after a fire, never names a minute twice', async () => {
	const s = setup(START, { early: 1 });
	s.jobs.push(row({ name: 'hourly', cron: '0 * * * *', tz: 'UTC' }), row({ name: 'tick', every: HOUR }));
	await s.advance(3 * HOUR);
	assert.deepEqual(s.runs.filter((r) => r.name === 'hourly').map((r) => r.due - START), [HOUR, 2 * HOUR, 3 * HOUR]);
	assert.deepEqual(s.runs.filter((r) => r.name === 'tick').map((r) => r.due - START), [HOUR, 2 * HOUR, 3 * HOUR]);
	s.act(() => { s.jump(-30 * 60_000); });            // the clock steps back half an hour inside a run
	await s.advance(HOUR);
	assert.deepEqual(s.runs.slice(6).map((r) => [r.name, r.due - START]).sort(), [['hourly', 4 * HOUR], ['tick', 4 * HOUR]]);
	await s.advance(2 * HOUR);
	assert.deepEqual(s.runs.slice(8).map((r) => [r.name, r.due - START]).sort(), [['hourly', 5 * HOUR], ['hourly', 6 * HOUR], ['tick', 5 * HOUR], ['tick', 6 * HOUR]], 'each fire after a step back is the next slot, never the same one again');
	await s.scheduler.stop();
});

test('a cron row fires on the wall clock of its zone, through the change to daylight time', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'nine', cron: '0 9 * * *', tz: 'America/Toronto' }));
	await s.advance(2 * HOUR - 1);
	assert.equal(s.runs.length, 0);
	await s.advance(1);
	assert.equal(s.runs.length, 1);
	assert.equal(s.runs[0]!.due, Date.UTC(2026, 2, 7, 14, 0), '09:00 EST is 14:00 UTC');
	await s.advance(23 * HOUR - 1);
	assert.equal(s.runs.length, 1);
	await s.advance(1);
	assert.equal(s.runs.length, 2);
	assert.equal(s.runs[1]!.due, Date.UTC(2026, 2, 8, 13, 0), '09:00 EDT is 13:00 UTC the next morning');
	await s.scheduler.stop();
});

test('a row that cannot be scheduled is refused once, by field, and an edit that fixes it schedules it', async () => {
	const s = setup();
	const noZone = row({ name: 'no-zone', cron: '0 9 * * *' });
	s.jobs.push(
		noZone,
		row({ name: 'mars', cron: '0 9 * * *', tz: 'Mars/Olympus' }),
		row({ name: 'four', cron: '0 9 * *', tz: 'UTC' }),
		row({ name: 'never', cron: '0 0 31 2 *', tz: 'UTC' }),
		row({ name: 'two', at: START + 1, every: 5 }),
		row({ name: 'none' }),
		row({ name: 'zero', every: 0 }),
		row({ name: 'text-at', at: '5' as never }),
		row({ name: 'text', every: '5' as never }),
	);
	await s.advance(DAY);
	assert.equal(s.runs.length, 0);
	assert.equal(s.armed(), 0);
	const byName = new Map(s.failed.map((f) => [f.name, f.error as JobsError]));
	assert.equal(s.failed.length, 9, 'each refused exactly once');
	for (const error of byName.values()) assert.equal(error.reason, 'invalid');
	assert.match(byName.get('no-zone')!.message, /needs tz/);
	assert.match(byName.get('mars')!.message, /Mars\/Olympus/);
	assert.match(byName.get('four')!.message, /4 fields, not 5/);
	assert.match(byName.get('never')!.message, /does not occur/);
	assert.match(byName.get('two')!.message, /at and every/);
	assert.match(byName.get('none')!.message, /has none/);
	assert.match(byName.get('zero')!.message, /every must be a positive/);
	assert.match(byName.get('text-at')!.message, /at must be a number/);
	assert.match(byName.get('text')!.message, /every must be a positive/);

	noZone.tz = 'UTC';
	await s.advance(0);
	assert.equal(s.armed(), 1, 'the fixed row is scheduled');
	assert.equal(s.failed.length, 9, 'fixing one row re-reports nothing');
	await s.advance(DAY);
	assert.equal(s.runs.length, 1);
	assert.equal(s.runs[0]!.name, 'no-zone');
	assert.equal(s.failed.length, 9, 'a write of last re-reports nothing either');
	await s.scheduler.stop();
});

test('the scheduler follows the array: a row pushed is scheduled, one removed never fires, one edited fires on its new schedule', async () => {
	const s = setup();
	await s.advance(HOUR);
	const a = row({ name: 'a', at: s.clock.now() + 1000 });
	const b = row({ name: 'b', at: s.clock.now() + 1000 });
	s.jobs.push(a, b);
	assert.equal(s.armed(), 2);
	s.jobs.splice(s.jobs.indexOf(b), 1);
	assert.equal(s.armed(), 1);
	await s.advance(1000);
	assert.deepEqual(s.runs.map((r) => r.name), ['a']);

	const c = row({ name: 'c', cron: '0 9 * * *', tz: 'UTC' });
	s.jobs.push(c);
	c.cron = '0 10 * * *';
	await s.advance(DAY);
	assert.deepEqual(s.runs.slice(1).map((r) => [r.name, r.due]), [['c', Date.UTC(2026, 2, 8, 10, 0)]]);
	assert.equal(s.armed(), 1);
	await s.scheduler.stop();
});

test('writing last is not an edit: it arms nothing new and re-reports nothing', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'tick', every: 1000 }));
	const before = s.asked().length;
	await s.advance(3000);
	assert.equal(s.runs.length, 3);
	assert.equal(s.asked().length - before, 3, 'one timer per fire, for the next fire, and nothing for the writes of last');
	assert.equal(s.armed(), 1);
	await s.scheduler.stop();
});

test('a row still running when it comes due is skipped that time, and the fire after is found from now', async () => {
	const s = setup();
	s.act(s.takes(2500));
	s.jobs.push(row({ name: 'slow', every: 1000 }));
	await s.advance(6000);
	assert.deepEqual(s.runs.map((r) => r.at - START), [1000, 4000], 'the fires at 2000 and 3000 were skipped while the first ran');
	assert.deepEqual(s.runs.map((r) => r.due - START), [1000, 4000]);
	await s.finish();
});

test('a fire that lands while the row still runs, after an edit re-armed it, is skipped and never runs concurrently', async () => {
	const s = setup();
	let inFlight = 0;
	let most = 0;
	s.act(() => {
		inFlight += 1;
		most = Math.max(most, inFlight);
		return new Promise<void>((resolve) => { s.clock.setTimeout(() => { inFlight -= 1; resolve(); }, 5000); });
	});
	const slow = row({ name: 'slow', every: 1000 });
	s.jobs.push(slow);
	await s.advance(1500);                             // running since 1000, until 6000
	slow.every = 500;                                  // re-armed from now, while it runs
	await s.advance(4000);
	assert.equal(s.runs.length, 1, 'every fire that landed during the run was skipped');
	assert.equal(most, 1);
	await s.advance(2000);
	assert.deepEqual(s.runs.map((r) => r.due - START), [1000, 6500], 'the next fire is on the new grid, after the run ended');
	await s.finish();
});

test('stop called from inside run, before its first await, still waits for that run', async () => {
	const s = setup();
	let stopped = false;
	s.act(() => {
		void s.scheduler.stop().then(() => { stopped = true; });
		return new Promise<void>((resolve) => { s.clock.setTimeout(resolve, 500); });
	});
	s.jobs.push(row({ name: 'self', at: START + 10 }));
	await s.advance(10);
	assert.equal(s.runs.length, 1);
	assert.equal(stopped, false, 'stop is waiting on the run that called it');
	await s.advance(500);
	assert.equal(stopped, true);
});

test('a second stop waits for the same runs as the first', async () => {
	const s = setup();
	s.act(s.takes(500));
	s.jobs.push(row({ name: 'tick', every: 1000 }));
	await s.advance(1000);
	const first = s.scheduler.stop();
	const second = s.scheduler.stop();
	let a = false;
	let b = false;
	void first.then(() => { a = true; });
	void second.then(() => { b = true; });
	await settle();
	assert.deepEqual([a, b], [false, false]);
	await s.advance(500);
	await first;
	await second;
	assert.deepEqual([a, b], [true, true]);
});

test('two schedulers over one array both run every row, which is why the README says to make one', async () => {
	const driven = drivenClock(START);
	const jobs = createArray<Job>();
	const names: string[] = [];
	const a = createScheduler({ jobs, clock: driven.clock, run: () => { names.push('a'); } });
	const b = createScheduler({ jobs, clock: driven.clock, run: () => { names.push('b'); } });
	jobs.push(row({ name: 'once', at: START + 100 }));
	await driven.advance(100);
	assert.deepEqual(names.sort(), ['a', 'b']);
	await a.stop();
	await b.stop();
});

test('a row whose record shows a run a dead process never ended is scheduled as usual and the next run overwrites it; a one-off in that state is done', async () => {
	const s = setup();
	const periodic = row({ name: 'p', every: 1000, last: createObject({ started: START - 5000, status: 'running' }) });
	const oneOff = row({ name: 'o', at: START - 5000, last: createObject({ started: START - 5000, status: 'running' }) });
	s.jobs.push(periodic, oneOff);
	await s.advance(999);
	assert.equal(lastOf(periodic)?.status, 'running');
	assert.equal(lastOf(periodic)?.ended, undefined, 'the crash record stands until the next run');
	await s.advance(1);
	assert.deepEqual({ ...lastOf(periodic) }, { started: START + 1000, ended: START + 1000, status: 'ok' });
	await s.advance(DAY);
	assert.deepEqual(s.runs.filter((r) => r.name === 'o'), [], 'a one-off that started once is done, however it ended');
	assert.equal(lastOf(oneOff)?.status, 'running');
	await s.scheduler.stop();
});

test('a row that cannot be scheduled is reported once the walk that found it is over, and after createScheduler has returned', async () => {
	const driven = drivenClock(START);
	const jobs = createArray<Job>([row({ name: 'bad' }), row({ name: 'good', at: START + 100 })]);
	const seen: { name: string; armed: number; had: boolean }[] = [];
	let scheduler: Scheduler | undefined;
	scheduler = createScheduler({
		jobs, clock: driven.clock, run: () => undefined,
		handlers: { failed: (job) => { seen.push({ name: String(job.name), armed: driven.armed(), had: scheduler !== undefined }); jobs.splice(jobs.indexOf(job), 1); } },
	});
	assert.deepEqual(seen, [], 'nothing of the application\'s ran inside createScheduler');
	await settle();
	assert.deepEqual(seen, [{ name: 'bad', armed: 1, had: true }], 'the row after the bad one was armed before the handler ran, and the scheduler existed');
	jobs.push(row({ name: 'bad2', every: 0 }), row({ name: 'good2', at: START + 200 }));
	assert.deepEqual(seen.at(-1), { name: 'bad2', armed: 2, had: true }, 'reported once the walk that found it was over, with the later row already armed');
	assert.deepEqual(jobs.map((j) => j.name), ['good', 'good2'], 'the handler removed both bad rows without upsetting the walk');
	await driven.advance(200);
	await scheduler.stop();
});

test('a run that throws lands failed on the row with its message and reason, reaches the handler as thrown, and the schedule goes on', async () => {
	const s = setup();
	const thrown = Object.assign(new Error('the report is empty'), { reason: 'empty' });
	let fail = true;
	s.act(() => { if (fail) throw thrown; });
	const report = row({ name: 'report', every: 1000 });
	s.jobs.push(report);
	await s.advance(1000);
	assert.equal(lastOf(report)?.status, 'failed');
	assert.deepEqual({ ...lastOf(report)?.error }, { message: 'the report is empty', reason: 'empty' });
	assert.equal(lastOf(report)?.ended, START + 1000);
	assert.equal(s.failed.length, 1);
	assert.equal(s.failed[0]!.error, thrown, 'the handler gets what run threw, not a wrapper');
	fail = false;
	await s.advance(1000);
	assert.equal(s.runs.length, 2);
	assert.equal(lastOf(report)?.status, 'ok');
	assert.equal(lastOf(report)?.error, undefined, 'a good run leaves no error behind');
	s.act(() => { throw 'a string'; });
	await s.advance(1000);
	assert.deepEqual({ ...lastOf(report)?.error }, { message: 'a string' });
	await s.scheduler.stop();
});

const uncaught = (script: string): { status: number | null; stdout: string; stderr: string } => {
	const here = fileURLToPath(new URL('.', import.meta.url));
	const core = new URL('../../core/src/index.ts', import.meta.url).href;
	const jobs = new URL('../src/index.ts', import.meta.url).href;
	const source = `
		import { createArray, createObject } from '${core}';
		import { createScheduler } from '${jobs}';
		const jobs = createArray([createObject({ at: Date.now() - 1 })]);
		${script}
		setTimeout(() => console.log('still alive'), 300);
	`;
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd: here, encoding: 'utf8', timeout: 20_000 });
	return { status: run.status, stdout: run.stdout, stderr: run.stderr };
};

test('without a handler, a run that throws is raised where nothing catches it', () => {
	const run = uncaught(`createScheduler({ jobs, run: () => { throw new Error('nobody heard this'); } });`);
	assert.notEqual(run.status, 0, `the process should have died: ${run.stdout} ${run.stderr}`);
	assert.match(run.stderr, /nobody heard this/);
	assert.doesNotMatch(run.stdout, /still alive/);
});

test('without a handler, a row that cannot be scheduled is raised the same way', () => {
	const run = uncaught(`jobs.push(createObject({ cron: '0 9 * * *' })); createScheduler({ jobs, run: () => {} });`);
	assert.notEqual(run.status, 0, `the process should have died: ${run.stdout} ${run.stderr}`);
	assert.match(run.stderr, /needs tz/);
});

test('a handler that throws is raised the same way, so a broken handler cannot hide a failure', () => {
	const run = uncaught(`createScheduler({ jobs, run: () => { throw new Error('inner'); }, handlers: { failed: () => { throw new Error('the handler is broken'); } } });`);
	assert.notEqual(run.status, 0, `the process should have died: ${run.stdout} ${run.stderr}`);
	assert.match(run.stderr, /the handler is broken/);
});

test('stop cancels every timer, stops following, and waits for the run in flight', async () => {
	const s = setup();
	s.act(s.takes(500));
	s.jobs.push(row({ name: 'tick', every: 1000 }), row({ name: 'later', at: START + DAY }));
	await s.advance(1000);
	assert.equal(s.runs.length, 1);
	let stopped = false;
	const stopping = s.scheduler.stop().then(() => { stopped = true; });
	await settle();
	assert.equal(stopped, false, 'stop waits for the run in flight');
	assert.equal(s.armed(), 1, 'only the run\'s own wait is left');
	await s.advance(500);
	await stopping;
	assert.equal(stopped, true);
	assert.equal(s.armed(), 0);
	s.jobs.push(row({ name: 'after', at: START + 2000 }));
	await s.advance(2 * DAY);
	assert.equal(s.runs.length, 1, 'nothing fires after stop, and a row pushed after stop is not followed');
	await s.scheduler.stop();
});

test('a wait longer than one timer can hold is taken in pieces and still fires at its time', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'far', at: START + 40 * DAY }));
	await s.advance(40 * DAY - 1);
	assert.equal(s.runs.length, 0);
	await s.advance(1);
	assert.equal(s.runs.length, 1);
	assert.equal(s.runs[0]!.at, START + 40 * DAY);
	assert.ok(s.asked().every((ms) => ms <= 2 ** 31 - 1), 'no single wait exceeded what a timer accepts');
	assert.ok(s.asked().length >= 2, 'the wait was taken in pieces');
	await s.scheduler.stop();
});

test('a row edited while it runs follows the new schedule afterwards; one removed while it runs is not rescheduled', async () => {
	const s = setup();
	s.act(s.takes(500));
	const edited = row({ name: 'edited', every: 1000 });
	const removed = row({ name: 'removed', every: 1000 });
	s.jobs.push(edited, removed);
	await s.advance(1000);
	assert.equal(s.runs.length, 2);
	edited.every = 5000;
	s.jobs.splice(s.jobs.indexOf(removed), 1);
	await s.advance(500);
	assert.equal(s.armed(), 1, 'one timer: the edited row\'s next fire');
	await s.advance(20_000);
	assert.deepEqual(s.runs.slice(2).map((r) => [r.name, r.due - START]), [['edited', 6000], ['edited', 11_000], ['edited', 16_000], ['edited', 21_000]]);
	assert.ok(s.runs.slice(2).every((r) => r.name === 'edited'));
	await s.finish();
});

test('run\'s return value is ignored, and nothing but last is written onto a row', async () => {
	const s = setup();
	s.act(() => ({ anything: 'at all' }));
	const job = row({ name: 'plain', every: 1000, note: 'mine' });
	s.jobs.push(job);
	await s.advance(2000);
	const { last, ...rest } = job;
	assert.deepEqual({ ...rest }, { name: 'plain', every: 1000, note: 'mine' });
	assert.equal(last?.status, 'ok');
	await s.scheduler.stop();
});
