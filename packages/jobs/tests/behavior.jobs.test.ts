// The behavioral corpus for `jobs`: what this problem domain is known to need, each stated
// as a requirement aweft must meet. Append-only; removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray, createObject } from '@aweftjs/core';

import { createScheduler } from '../src/index.ts';
import type { Job } from '../src/index.ts';
import { DAY, HOUR, START, drivenClock } from './helpers.ts';

const row = (fields: Job): Job => createObject<Job>(fields);

const setup = (start = START) => {
	const driven = drivenClock(start);
	const jobs = createArray<Job>();
	const fired: { name: string; due: number; at: number }[] = [];
	let behaviour: (job: Job) => unknown = () => undefined;
	const scheduler = createScheduler({
		jobs, clock: driven.clock, handlers: { failed: () => undefined },
		run: async (job, { due }) => { fired.push({ name: String(job.name), due, at: driven.clock.now() }); return behaviour(job); },
	});
	/** Stop, letting a run still waiting on the driven clock finish. */
	const finish = async (): Promise<void> => { const stopping = scheduler.stop(); await driven.advance(DAY); await stopping; };
	return { ...driven, jobs, fired, scheduler, act: (fn: (job: Job) => unknown) => { behaviour = fn; }, finish };
};

test('requirement: a job that keeps throwing keeps its schedule', async () => {
	const s = setup();
	s.act(() => { throw new Error('every time'); });
	s.jobs.push(row({ name: 'flaky', every: 1000 }));
	await s.advance(3000);
	assert.equal(s.fired.length, 3);
	await s.scheduler.stop();
});

test('requirement: a wait past what one timer can hold fires at its time, not at once', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'far', every: 30 * DAY }));
	await s.advance(30 * DAY - 1);
	assert.equal(s.fired.length, 0, 'a timer that overflowed would have fired at once');
	await s.advance(1);
	assert.equal(s.fired.length, 1);
	await s.scheduler.stop();
});

test('requirement: Sunday is both 0 and 7', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'zero', cron: '0 0 * * 0', tz: 'UTC' }), row({ name: 'seven', cron: '0 0 * * 7', tz: 'UTC' }));
	await s.advance(DAY);
	assert.deepEqual(s.fired.map((f) => [f.name, f.due]), [['zero', Date.UTC(2026, 2, 8)], ['seven', Date.UTC(2026, 2, 8)]]);
	await s.scheduler.stop();
});

test('requirement: with day of month and day of week both given, a day that matches either runs', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'either', cron: '0 0 17 * 5', tz: 'UTC' }));
	await s.advance(14 * DAY);
	assert.deepEqual(s.fired.map((f) => f.due), [Date.UTC(2026, 2, 13), Date.UTC(2026, 2, 17), Date.UTC(2026, 2, 20)], 'Friday the 13th, Tuesday the 17th, Friday the 20th');
	await s.scheduler.stop();
});

test('requirement: a process asleep for a week gives an hourly row one fire on waking, not 168', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'hourly', cron: '0 * * * *', tz: 'UTC' }));
	await s.advance(HOUR);
	assert.equal(s.fired.length, 1);
	s.jump(7 * DAY);
	await s.advance(0);
	assert.equal(s.fired.length, 2, 'the fire that was due when the sleep began, and no more');
	await s.advance(HOUR);
	assert.equal(s.fired.length, 3, 'then the next hour, from now');
	await s.scheduler.stop();
});

test('requirement: a wall time the clocks skip is not run that day, and one they repeat is run twice', async () => {
	const s = setup(Date.UTC(2026, 2, 8, 5, 0));                  // 00:00 EST on the day Toronto goes forward
	s.jobs.push(row({ name: 'skipped', cron: '30 2 * * *', tz: 'America/Toronto' }));
	await s.advance(DAY);
	assert.deepEqual(s.fired.map((f) => f.due), [], 'no 02:30 on the day the clocks go forward');
	await s.advance(DAY);
	assert.deepEqual(s.fired.map((f) => f.due), [Date.UTC(2026, 2, 9, 6, 30)]);
	await s.scheduler.stop();

	const fold = setup(Date.UTC(2026, 10, 1, 4, 0));               // 00:00 EDT on the day Toronto goes back
	fold.jobs.push(row({ name: 'twice', cron: '30 1 * * *', tz: 'America/Toronto' }));
	await fold.advance(DAY);
	assert.deepEqual(fold.fired.map((f) => f.due), [Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 10, 1, 6, 30)], '01:30 EDT and 01:30 EST');
	await fold.scheduler.stop();
});

test('requirement: a row never runs concurrently with itself', async () => {
	const s = setup();
	let inFlight = 0;
	let most = 0;
	s.act(() => new Promise<void>((resolve) => {
		inFlight += 1;
		most = Math.max(most, inFlight);
		s.clock.setTimeout(() => { inFlight -= 1; resolve(); }, 3500);
	}));
	s.jobs.push(row({ name: 'long', every: 1000 }));
	await s.advance(20_000);
	assert.equal(most, 1);
	assert.ok(s.fired.length >= 4, `${s.fired.length} fires`);
	await s.finish();
});

test('requirement: an interval keeps its own grid whatever a run took', async () => {
	const s = setup();
	s.act(() => new Promise<void>((resolve) => { s.clock.setTimeout(resolve, 700); }));
	s.jobs.push(row({ name: 'grid', every: 1000 }));
	await s.advance(5000);
	assert.deepEqual(s.fired.map((f) => f.at - START), [1000, 2000, 3000, 4000, 5000]);
	await s.finish();
});

test('requirement: February 29 runs only in a leap year', async () => {
	const s = setup();
	s.jobs.push(row({ name: 'leap', cron: '0 0 29 2 *', tz: 'UTC' }));
	await s.advance(3 * 366 * DAY);
	assert.deepEqual(s.fired.map((f) => f.due), [Date.UTC(2028, 1, 29)]);
	await s.scheduler.stop();
});

test('requirement: nothing on a row but last is read or written, so the row is the application\'s', async () => {
	const s = setup();
	const job = row({ name: 'mine', every: 1000, owner: 'ada', args: '{"n":1}', module: 'report/Daily' });
	const before = JSON.stringify({ ...job });
	s.jobs.push(job);
	await s.advance(2500);
	const { last, ...rest } = job;
	assert.equal(JSON.stringify({ ...rest }), before);
	assert.equal(last?.status, 'ok');
	assert.deepEqual(Object.keys(job).sort(), ['args', 'every', 'last', 'module', 'name', 'owner']);
	await s.scheduler.stop();
});
