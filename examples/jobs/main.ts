// A content site's backend, dry-run by its operator: a nightly digest, an hourly cleanup, a
// reminder that was due before the process started, and a report an agent wrote as a module
// that runs in a sandbox. The schedule is a document in the store, so it survives the process;
// what the jobs do lands in a second document. The operator drives the clock, which is how
// you find out what a schedule will do next week without waiting for next week.
//
// Run: node examples/jobs/main.ts

import { createArray, createObject } from '@aweftjs/core';
import { createScheduler } from '@aweftjs/jobs';
import type { Clock, Job } from '@aweftjs/jobs';
import { createSandbox, inProcess } from '@aweftjs/sandbox';
import { createStore, memoryDriver } from '@aweftjs/store';

const check = (ok: boolean, what: string): void => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) process.exitCode = 1;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// --- the operator's clock -------------------------------------------------------------------

const driven = (start: number) => {
	let now = start;
	let id = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const clock: Clock = {
		now: () => now,
		setTimeout: (fn, ms) => { timers.set(++id, { at: now + ms, fn }); return id; },
		clearTimeout: (handle) => { timers.delete(handle as number); },
	};
	const breathe = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
	const advance = async (ms: number): Promise<void> => {
		const target = now + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void }] | undefined;
			for (const pair of timers) if (pair[1].at <= target && (next === undefined || pair[1].at < next[1].at)) next = pair;
			if (next === undefined) break;
			now = Math.max(now, next[1].at);
			timers.delete(next[0]);
			next[1].fn();
			await breathe();
		}
		now = target;
		await breathe();
	};
	return { clock, advance, sleep: (ms: number) => { now += ms; } };
};

// 06:00 in Toronto, the morning before the clocks go forward.
const { clock, advance, sleep } = driven(Date.UTC(2026, 2, 7, 11, 0));

// --- the report an agent wrote, run in a room -----------------------------------------------

const modules = createObject({
	'report/Daily': createObject({ source: `
		export default () => ({ run: (day) => 'report for ' + day + ': 3 posts, 12 comments' });
	` }),
});
const sandbox = await createSandbox({ runner: inProcess(), modules, grants: createArray<string>() });

// --- the store: the schedule and what the jobs did --------------------------------------------

type Ledger = { digests: number; cleanups: number; reminders: string[]; reports: string[] };
const driver = memoryDriver();
const store = createStore({ driver });
const schedule = await store.open('jobs', 'array');
const ledgerHandle = await store.open('ledger');
const ledger = ledgerHandle.root as Ledger;
ledger.digests = 0;
ledger.cleanups = 0;
ledger.reminders = createArray<string>();
ledger.reports = createArray<string>();

const jobs = schedule.root as Job[];
jobs.push(
	createObject<Job>({ kind: 'digest', cron: '0 7 * * *', tz: 'America/Toronto' }),
	createObject<Job>({ kind: 'cleanup', every: HOUR }),
	createObject<Job>({ kind: 'remind', at: clock.now() - 20 * 60_000, text: 'renew the domain' }),
	createObject<Job>({ kind: 'report', cron: '0 12 * * *', tz: 'America/Toronto', module: 'report/Daily', method: 'run' }),
);

const failures: { kind: string; message: string }[] = [];
const dues: Record<string, number[]> = {};

const run = async (job: Job, { due }: { due: number }): Promise<void> => {
	const kind = String(job.kind);
	(dues[kind] ??= []).push(due);
	if (kind === 'digest') ledger.digests += 1;
	else if (kind === 'cleanup') ledger.cleanups += 1;
	else if (kind === 'remind') ledger.reminders.push(String(job.text));
	else if (kind === 'report') {
		const name = String(job.module);
		const instance = (await sandbox.load([name]))[name] as Record<string, (day: string) => Promise<string>>;
		ledger.reports.push(await instance[String(job.method)]!(new Date(due).toISOString().slice(0, 10)));
	} else if (kind === 'broken') throw new Error(`${kind} has no rows to work on`);
};

const scheduler = createScheduler({
	jobs, run, clock,
	handlers: { failed: (job, error) => { failures.push({ kind: String(job.kind), message: (error as Error).message }); } },
});

console.log('two days of schedule');
await advance(26 * HOUR);
check(ledger.digests === 2 && dues.digest?.[0] === Date.UTC(2026, 2, 7, 12, 0) && dues.digest[1] === Date.UTC(2026, 2, 8, 11, 0),
	'the digest ran at 07:00 Toronto both mornings, 12:00 UTC before the clocks changed and 11:00 UTC after');
check(ledger.cleanups === 26, `the hourly cleanup ran 26 times in 26 hours (${ledger.cleanups})`);
check([...ledger.reminders].join() === 'renew the domain' && dues.remind?.[0] === Date.UTC(2026, 2, 7, 10, 40),
	'the reminder that was due before the process started ran once, with the due it had');
check(ledger.reports.length === 1 && ledger.reports[0] === 'report for 2026-03-07: 3 posts, 12 comments',
	'the report ran in the sandbox at noon, and its answer is in the ledger');
check(jobs.every((job) => job.last?.status === 'ok'), 'every row carries last with status ok');

console.log('live edits');
const soon = createObject<Job>({ kind: 'remind', at: clock.now() + HOUR, text: 'stand up' });
const never = createObject<Job>({ kind: 'remind', at: clock.now() + HOUR, text: 'sit down' });
jobs.push(soon, never);
jobs.splice(jobs.indexOf(never), 1);
await advance(HOUR);
check([...ledger.reminders].join() === 'renew the domain,stand up', 'a row pushed while the scheduler runs fires; one removed before its time does not');

const broken = createObject<Job>({ kind: 'broken', every: 1000 });
jobs.push(broken);
await advance(3500);
check(broken.last?.status === 'failed' && broken.last.error?.message === 'broken has no rows to work on', 'a run that throws lands failed on its row with the message');
check(failures.length === 3 && failures.every((f) => f.kind === 'broken'), `the handler heard each failure, and the schedule went on (${failures.length} of 3)`);
jobs.splice(jobs.indexOf(broken), 1);

const digest = jobs[0]!;
digest.cron = '0 8 * * *';
const before = ledger.digests;
await advance(DAY);
check(ledger.digests === before + 1 && dues.digest?.at(-1) === Date.UTC(2026, 2, 9, 12, 0), 'editing the cron moved the next digest to 08:00 Toronto');
check(ledger.reports.length === 2 && ledger.reports[1] === 'report for 2026-03-08: 3 posts, 12 comments', 'the second day\'s report ran in the sandbox too');

console.log('a restart, three days later');
await scheduler.stop();
await store.settled(schedule);
await store.settled(ledgerHandle);
const lastDigest = digest.last?.started;
await store.close(schedule);
await store.close(ledgerHandle);
sleep(3 * DAY);

const again = createStore({ driver });
const reopened = await again.open('jobs', 'array');
const ledgerAgain = (await again.open('ledger')).root as Ledger;
const jobsAgain = reopened.root as Job[];
check(jobsAgain.length === 5 && jobsAgain[0]!.last?.started === lastDigest && jobsAgain[0]!.last?.status === 'ok', 'the schedule and every last came back from the store');
check(ledgerAgain.digests === 3 && ledgerAgain.cleanups === 51 && ledgerAgain.reports.length === 2, `what the jobs did came back too (${ledgerAgain.digests} digests, ${ledgerAgain.cleanups} cleanups, ${ledgerAgain.reports.length} reports)`);

const digestsBefore = ledgerAgain.digests;
const runAgain = async (job: Job, context: { due: number }): Promise<void> => {
	if (job.kind === 'digest') ledgerAgain.digests += 1;
	if (job.kind === 'remind') ledgerAgain.reminders.push(String(job.text));
	(dues[String(job.kind)] ??= []).push(context.due);
};
const second = createScheduler({ jobs: jobsAgain, run: runAgain, clock, handlers: { failed: () => undefined } });
await advance(0);
check(ledgerAgain.digests === digestsBefore, 'nothing caught up: three missed digests stayed missed');
check(ledgerAgain.reminders.length === 2, 'the one-offs that already ran did not run again');
await advance(DAY);
check(ledgerAgain.digests === digestsBefore + 1, 'the digest ran once, at the next 08:00');
jobsAgain.push(createObject<Job>({ kind: 'remind', at: clock.now() - DAY, text: 'welcome back' }));
await advance(0);
check([...ledgerAgain.reminders].at(-1) === 'welcome back', 'a one-off in the past pushed after the restart ran once');
await second.stop();
await again.settled(reopened);
await again.stop();
await sandbox.stop();

console.log(process.exitCode ? 'proof failed' : 'proof passed');
