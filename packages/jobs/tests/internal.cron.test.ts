// The cron arithmetic, white-box: parsing, the day rule, and the next occurrence in a zone.
// Every expected time here is derived by hand or by the minute-by-minute scan below, never
// from the search under test.

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomBelow, randomFrom } from '@aweftjs/testing';

import type { JobsError } from '../src/index.ts';
import { type CronSpec, knownZone, matches, nextCron, offsetAt, parseCron, wallAt } from '../src/cron.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const list = (spec: CronSpec, field: keyof CronSpec): readonly number[] => spec[field].list;

/** The second implementation: every minute after `from`, in order, until one matches. */
const scan = (spec: CronSpec, tz: string, from: number, days: number): number | undefined => {
	let t = Math.floor(from / MINUTE) * MINUTE + MINUTE;
	for (const end = t + days * DAY; t < end; t += MINUTE) if (matches(spec, wallAt(t, tz))) return t;
	return undefined;
};

test('parses values, lists, ranges, steps and names, and folds Sunday 7 onto 0', () => {
	const office = parseCron('*/15 9-17 * * MON-FRI');
	assert.deepEqual(list(office, 'minute'), [0, 15, 30, 45]);
	assert.deepEqual(list(office, 'hour'), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
	assert.equal(office.day.any, true);
	assert.equal(office.month.any, true);
	assert.deepEqual(list(office, 'weekday'), [1, 2, 3, 4, 5]);

	assert.deepEqual(list(parseCron('5/10 * * * *'), 'minute'), [5, 15, 25, 35, 45, 55]);
	assert.deepEqual(list(parseCron('0 0 1,15 jan,JUL *'), 'month'), [1, 7]);
	assert.deepEqual(list(parseCron('0 0 1,15 * *'), 'day'), [1, 15]);
	assert.deepEqual(list(parseCron('0 0 * * 7'), 'weekday'), [0]);
	assert.deepEqual(list(parseCron('0 0 * * 5-7'), 'weekday'), [0, 5, 6]);
	assert.deepEqual(list(parseCron('0 0 * * 1-7/2'), 'weekday'), [0, 1, 3, 5]);
	assert.deepEqual(list(parseCron('  0   0 * * *  '), 'hour'), [0]);
});

test('refuses what it cannot read, naming the field', () => {
	const refused = (text: string, pattern: RegExp): void => {
		assert.throws(() => parseCron(text), (e: unknown) => (e as JobsError).reason === 'invalid' && pattern.test((e as Error).message), text);
	};
	refused('0 9 * *', /4 fields, not 5/);
	refused('0 9 * * * *', /6 fields, not 5/);
	refused('', /0 fields, not 5/);
	refused('60 * * * *', /minute 60 outside 0 to 59/);
	refused('* 24 * * *', /hour 24 outside 0 to 23/);
	refused('* * 0 * *', /day 0 outside 1 to 31/);
	refused('* * * 13 *', /month 13 outside 1 to 12/);
	refused('* * * * 8', /weekday 8 outside 0 to 7/);
	refused('*/0 * * * *', /step/);
	refused('*/x * * * *', /step/);
	refused('9-5 * * * *', /runs backwards/);
	refused('1-2-3 * * * *', /range/);
	refused('a * * * *', /"a" where a minute/);
	refused('1//2 * * * *', /where a minute/);
	refused('-5 * * * *', /range/);
	refused('* * * JANUARY *', /"JANUARY" where a month/);
	refused(', * * * *', /where a minute/);
});

test('with both day fields restricted a day matches either; with one, that one', () => {
	const at = (year: number, month: number, day: number): ReturnType<typeof wallAt> => wallAt(Date.UTC(year, month - 1, day, 0, 0), 'UTC');
	const both = parseCron('0 0 13 * FRI');
	assert.equal(matches(both, at(2026, 3, 13)), true, 'Friday the 13th');
	assert.equal(matches(both, at(2026, 3, 20)), true, 'a Friday that is not the 13th');
	assert.equal(matches(both, at(2026, 4, 13)), true, 'a 13th that is a Monday');
	assert.equal(matches(both, at(2026, 3, 14)), false, 'a Saturday the 14th');
	const dayOnly = parseCron('0 0 13 * *');
	assert.equal(matches(dayOnly, at(2026, 3, 20)), false);
	assert.equal(matches(dayOnly, at(2026, 4, 13)), true);
	const weekdayOnly = parseCron('0 0 * * FRI');
	assert.equal(matches(weekdayOnly, at(2026, 3, 20)), true);
	assert.equal(matches(weekdayOnly, at(2026, 4, 13)), false);
});

test('the next occurrence is strictly after the moment asked, by hand', () => {
	const noon = Date.UTC(2026, 2, 7, 12, 0);
	assert.equal(nextCron(parseCron('0 9 * * *'), 'UTC', noon), Date.UTC(2026, 2, 8, 9, 0));
	assert.equal(nextCron(parseCron('30 12 * * *'), 'UTC', noon), Date.UTC(2026, 2, 7, 12, 30));
	assert.equal(nextCron(parseCron('0 12 * * *'), 'UTC', noon), Date.UTC(2026, 2, 8, 12, 0), 'the minute asked from is not after itself');
	assert.equal(nextCron(parseCron('0 12 * * *'), 'UTC', noon - 1), noon, 'one millisecond before is before');
	assert.equal(nextCron(parseCron('* * * * *'), 'UTC', noon + 30_000), noon + MINUTE, 'a moment inside a minute rounds up to the next');
	assert.equal(nextCron(parseCron('0 0 29 2 *'), 'UTC', noon), Date.UTC(2028, 1, 29, 0, 0), 'February 29 waits for a leap year');
	assert.equal(nextCron(parseCron('0 0 31 2 *'), 'UTC', noon), undefined, 'February 31 never comes');
	assert.equal(nextCron(parseCron('0 0 * * SUN'), 'UTC', noon), Date.UTC(2026, 2, 8, 0, 0));
	assert.equal(nextCron(parseCron('0 3 * * 0'), 'America/Toronto', noon), Date.UTC(2026, 2, 8, 7, 0), '03:00 on the Sunday the clocks go forward is 07:00 UTC');
	assert.equal(nextCron(parseCron('0 9 * * *'), 'Asia/Kolkata', Date.UTC(2026, 2, 7, 0, 0)), Date.UTC(2026, 2, 7, 3, 30), 'a half-hour zone');
});

test('a wall time that does not exist on the day the clocks go forward is skipped; one that occurs twice when they go back fires twice', () => {
	const toronto = 'America/Toronto';
	// On the day the clocks go forward, 02:00 EST becomes 03:00 EDT. 02:30 does not happen that day.
	const gap = parseCron('30 2 * * *');
	const beforeGap = Date.UTC(2026, 2, 8, 5, 0);                               // 00:00 EST on the day
	assert.equal(nextCron(gap, toronto, beforeGap), Date.UTC(2026, 2, 9, 6, 30), '02:30 EDT the day after');
	// On the day they go back, 02:00 EDT becomes 01:00 EST. 01:30 happens twice.
	const twice = parseCron('30 1 * * *');
	const beforeFold = Date.UTC(2026, 10, 1, 4, 0);                             // 00:00 EDT on the day
	const first = nextCron(twice, toronto, beforeFold);
	assert.equal(first, Date.UTC(2026, 10, 1, 5, 30), '01:30 EDT');
	const second = nextCron(twice, toronto, first!);
	assert.equal(second, Date.UTC(2026, 10, 1, 6, 30), '01:30 EST, an hour later');
	assert.equal(nextCron(twice, toronto, second!), Date.UTC(2026, 10, 2, 6, 30), 'then the next day');
});

test('agrees with a minute-by-minute scan through a zone that shifts by half an hour', () => {
	// Lord Howe Island moves its clocks by thirty minutes: 02:00 becomes 01:30.
	const tz = 'Australia/Lord_Howe';
	const spec = parseCron('*/20 * * * *');
	let t = Date.UTC(2026, 3, 3, 12, 0);
	for (let i = 0; i < 150; i++) {
		const expected = scan(spec, tz, t, 2);
		const actual = nextCron(spec, tz, t);
		assert.equal(actual, expected, `from ${new Date(t).toISOString()}`);
		t = actual!;
	}
});

test('a zone that moves its clocks on the half hour is read minute by minute, and agrees with the scan', () => {
	// No zone in the database shifts at half past, so one is made up for the length of this
	// test: an hour ahead of UTC, and two hours ahead from 01:30 wall time on the day `shift` names.
	const shift = Date.UTC(2026, 5, 1, 0, 30);
	const Real = Intl.DateTimeFormat;
	const fake = (t: number): Intl.DateTimeFormatPart[] => [{ type: 'timeZoneName', value: t < shift ? 'GMT+01:00' : 'GMT+02:00' }];
	const Faked = function (this: unknown, locale?: string, options?: Intl.DateTimeFormatOptions) {
		if (options?.timeZone === 'Test/HalfPast') return { formatToParts: fake } as unknown as Intl.DateTimeFormat;
		return new Real(locale, options);
	} as unknown as typeof Intl.DateTimeFormat;
	Intl.DateTimeFormat = Faked;
	try {
		const tz = 'Test/HalfPast';
		assert.equal(knownZone(tz), true);
		for (const text of ['*/20 * * * *', '45 1 * * *', '0 2 * * *', '15 * * * *']) {
			const spec = parseCron(text);
			let t = shift - 3 * 60 * MINUTE;
			for (let i = 0; i < 12; i++) {
				const expected = scan(spec, tz, t, 2);
				const actual = nextCron(spec, tz, t);
				assert.equal(actual, expected, `${text} from ${new Date(t).toISOString()}`);
				t = actual!;
			}
		}
		// 01:45 wall time is jumped over by the shift and is not produced that day.
		assert.equal(nextCron(parseCron('45 1 * * *'), tz, shift - 60 * MINUTE), Date.UTC(2026, 5, 1, 23, 45));
	} finally {
		Intl.DateTimeFormat = Real;
	}
});

test('agrees with the scan through zones that move their clocks at midnight', () => {
	// Santiago goes back at 00:00 and forward at 00:00 again; Havana goes forward at 00:00 and
	// so do the Azores. A row that runs on one day of the month is the case that skips days, so
	// it is the one that has to land on the right minute of the day after a shift.
	const cases: [string, number][] = [
		['America/Santiago', Date.UTC(2026, 3, 3, 12)], ['America/Santiago', Date.UTC(2026, 8, 4, 12)],
		['America/Havana', Date.UTC(2026, 2, 6, 12)], ['Atlantic/Azores', Date.UTC(2026, 2, 27, 12)],
	];
	for (const [tz, from] of cases) {
		for (const text of ['0 0 * * *', '30 0 * * *', '15 23 * * *', '0 1 * * *', '*/20 * 5,6,8,29 * *']) {
			const spec = parseCron(text);
			let t = from;
			for (let i = 0; i < 6; i++) {
				const expected = scan(spec, tz, t, 4);
				const actual = nextCron(spec, tz, t);
				assert.equal(actual, expected, `${text} in ${tz} from ${new Date(t).toISOString()}`);
				if (actual === undefined) break;
				t = actual;
			}
		}
	}
});

test('agrees with the scan on seeded random expressions and moments', () => {
	const random = randomFrom(20260904);
	const zones = ['UTC', 'America/Toronto', 'Asia/Kolkata', 'Europe/London', 'Australia/Lord_Howe'];
	const pick = <T>(from: readonly T[]): T => from[randomBelow(random, from.length)]!;
	const some = (high: number, count: number): string => Array.from({ length: count }, () => String(randomBelow(random, high + 1))).join(',');
	let compared = 0;
	for (let i = 0; i < 80; i++) {
		const minute = pick(['*', some(59, 1), some(59, 3), `*/${1 + randomBelow(random, 30)}`]);
		const hour = pick(['*', some(23, 1), some(23, 2), '*/6']);
		const day = pick(['*', '*', String(1 + randomBelow(random, 28))]);
		const weekday = pick(['*', '*', String(randomBelow(random, 7)), 'MON-FRI']);
		const text = `${minute} ${hour} ${day} * ${weekday}`;
		const spec = parseCron(text);
		const tz = pick(zones);
		const from = Date.UTC(2026, 0, 1) + randomBelow(random, 365 * 24 * 60) * MINUTE;
		const expected = scan(spec, tz, from, 3);
		if (expected === undefined) continue;
		compared += 1;
		assert.equal(nextCron(spec, tz, from), expected, `${text} in ${tz} from ${new Date(from).toISOString()}`);
	}
	assert.ok(compared >= 40, `compared ${compared}`);
});

test('offsets, and whether a zone is known', () => {
	assert.equal(offsetAt(Date.UTC(2026, 0, 15), 'America/Toronto'), -300);
	assert.equal(offsetAt(Date.UTC(2026, 6, 15), 'America/Toronto'), -240);
	assert.equal(offsetAt(0, 'Asia/Kolkata'), 330);
	assert.equal(offsetAt(0, 'UTC'), 0);
	assert.equal(knownZone('Europe/Berlin'), true);
	assert.equal(knownZone('Mars/Olympus'), false);
	assert.equal(knownZone(''), false);
});
