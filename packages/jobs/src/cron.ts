// Five-field cron: parsing, and the next minute on the wall clock of a named zone that an
// expression names (design 076).
//
// The search walks wall-clock hours. Within one hour the zone's offset is read at both ends
// and, when it is the same, every minute of that hour is arithmetic; when it differs (a zone
// that shifts on the half hour) the minutes are read one at a time. Nothing is skipped and
// nothing is assumed about when a zone shifts, so a wall time that does not exist on a
// daylight-saving day is never produced and one that exists twice is produced twice.

import { jobsError } from './contract.ts';

interface Field {
	/** `*`: any value. `list` is then empty. */
	readonly any: boolean;
	readonly values: ReadonlySet<number>;
	/** The values, ascending. */
	readonly list: readonly number[];
}

export interface CronSpec {
	readonly minute: Field;
	readonly hour: Field;
	readonly day: Field;
	readonly month: Field;
	readonly weekday: Field;
}

/** A moment as a wall clock shows it. `month` is 1 to 12, `weekday` 0 (Sunday) to 6. */
export interface Wall {
	readonly year: number;
	readonly month: number;
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly weekday: number;
}

type Name = keyof CronSpec;

const RANGE: Record<Name, readonly [number, number]> = {
	minute: [0, 59], hour: [0, 23], day: [1, 31], month: [1, 12], weekday: [0, 7],
};

const NAMES: Partial<Record<Name, Readonly<Record<string, number>>>> = {
	month: { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 },
	weekday: { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 },
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * How far ahead an occurrence is looked for before the expression is said never to occur:
 * past the next February 29, whatever year it is asked in.
 */
const HORIZON = (4 * 366 + 1) * 24 * HOUR;

const invalid = (text: string, detail: string, fix: string) => jobsError('invalid', `cron "${text}" ${detail}`, fix);

const whole = (token: string): number | undefined => (/^\d+$/.test(token) ? Number(token) : undefined);

const valueOf = (token: string, name: Name, text: string): number => {
	const value = NAMES[name]?.[token.toUpperCase()] ?? whole(token);
	if (value === undefined) {
		throw invalid(text, `has "${token}" where a ${name} should be`, 'Write a whole number, or a name such as JAN or MON.');
	}
	const [low, high] = RANGE[name];
	if (value < low || value > high) {
		throw invalid(text, `has ${name} ${token} outside ${low} to ${high}`, 'Write a value inside the range the message names.');
	}
	return value;
};

const fieldOf = (part: string, name: Name, text: string): Field => {
	if (part === '*') return { any: true, values: new Set(), list: [] };
	const [low, high] = RANGE[name];
	const values = new Set<number>();
	for (const segment of part.split(',')) {
		const [base, stepText, ...more] = segment.split('/');
		if (base === undefined || base === '' || more.length > 0) {
			throw invalid(text, `has "${segment}" where a ${name} should be`, 'Write the field as a value, a range, or a range and one step.');
		}
		const step = stepText === undefined ? 1 : (whole(stepText) ?? 0);
		if (step < 1) {
			throw invalid(text, `has a step in "${segment}" that is not a positive whole number`, 'Write the step after the slash as 1 or more.');
		}
		let start: number;
		let end: number;
		if (base === '*') {
			[start, end] = [low, high];
		} else if (base.includes('-')) {
			const [from, to, ...rest] = base.split('-');
			if (from === undefined || to === undefined || from === '' || to === '' || rest.length > 0) {
				throw invalid(text, `has a range "${base}" it cannot read`, 'Write a range as two values with one hyphen between them, such as 1-5.');
			}
			start = valueOf(from, name, text);
			end = valueOf(to, name, text);
			if (end < start) throw invalid(text, `has a range "${base}" that runs backwards`, 'Put the lower value first in the range.');
		} else {
			start = valueOf(base, name, text);
			end = stepText === undefined ? start : high;
		}
		// Sunday is 0 and 7 both, so 7 folds onto 0 and a range that reaches 7 covers Sunday.
		for (let v = start; v <= end; v += step) values.add(name === 'weekday' && v === 7 ? 0 : v);
	}
	return { any: false, values, list: [...values].sort((a, b) => a - b) };
};

/**
 * Parse a five-field cron expression: minute, hour, day of month, month, day of week.
 * Each field is `*`, a value, a range `a-b`, or a list of those, each with an optional `/step`;
 * months and weekdays may be named. Throws `invalid`, naming what it could not read.
 */
export const parseCron = (text: string): CronSpec => {
	const parts = text.trim().split(/\s+/);
	if (parts.length !== 5 || parts[0] === '') {
		throw invalid(text, `has ${parts[0] === '' ? 0 : parts.length} fields, not 5`, 'Write five fields: minute, hour, day, month and weekday.');
	}
	const [minute, hour, day, month, weekday] = parts as [string, string, string, string, string];
	return {
		minute: fieldOf(minute, 'minute', text),
		hour: fieldOf(hour, 'hour', text),
		day: fieldOf(day, 'day', text),
		month: fieldOf(month, 'month', text),
		weekday: fieldOf(weekday, 'weekday', text),
	};
};

const has = (field: Field, value: number): boolean => field.any || field.values.has(value);

// The one rule in cron that surprises: when both day fields are restricted, a day matches
// either of them, not both.
const dayMatches = (spec: CronSpec, wall: Wall): boolean => {
	if (spec.day.any) return has(spec.weekday, wall.weekday);
	if (spec.weekday.any) return spec.day.values.has(wall.day);
	return spec.day.values.has(wall.day) || spec.weekday.values.has(wall.weekday);
};

/** Whether the expression names this wall-clock minute. */
export const matches = (spec: CronSpec, wall: Wall): boolean =>
	has(spec.minute, wall.minute) && has(spec.hour, wall.hour) && has(spec.month, wall.month) && dayMatches(spec, wall);

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (tz: string): Intl.DateTimeFormat => {
	let formatter = formatters.get(tz);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
		formatters.set(tz, formatter);
	}
	return formatter;
};

/** Whether the runtime knows a zone by this name. */
export const knownZone = (tz: string): boolean => {
	try { formatterFor(tz); return true; } catch { return false; }
};

/** The zone's offset east of UTC at `t`, in minutes. */
export const offsetAt = (t: number, tz: string): number => {
	const label = formatterFor(tz).formatToParts(t).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
	const found = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(label);
	if (found === null || found[1] === undefined) return 0;
	const minutes = Number(found[2]) * 60 + Number(found[3]);
	return found[1] === '-' ? -minutes : minutes;
};

const wallOf = (shifted: number): Wall => {
	const d = new Date(shifted);
	return {
		year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
		hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay(),
	};
};

/** The wall clock in `tz` at `t`. */
export const wallAt = (t: number, tz: string): Wall => wallOf(t + offsetAt(t, tz) * MINUTE);

/**
 * The first minute strictly after `from` that the expression names, in milliseconds, or
 * undefined when there is none in the four years ahead.
 */
export const nextCron = (spec: CronSpec, tz: string, from: number): number | undefined => {
	let t = Math.floor(from / MINUTE) * MINUTE + MINUTE;
	const limit = t + HORIZON;
	while (t < limit) {
		const offset = offsetAt(t, tz);
		const wall = wallOf(t + offset * MINUTE);
		const blockStart = t - wall.minute * MINUTE;
		const blockEnd = blockStart + HOUR;
		if (offsetAt(blockEnd - MINUTE, tz) !== offset) {
			// The zone shifts inside this hour. Read the minutes one at a time.
			for (let m = t; m < blockEnd; m += MINUTE) if (matches(spec, wallAt(m, tz))) return m;
		} else if (!has(spec.month, wall.month) || !dayMatches(spec, wall)) {
			// Not today. Jump to the next wall midnight as this offset reckons it. A zone that
			// moves its clocks at midnight lands here on the new day's first minute either way;
			// one that moved them forward across midnight would lose its first hour, and none does.
			t = Math.max(blockEnd, Date.UTC(wall.year, wall.month - 1, wall.day + 1) - offset * MINUTE);
			continue;
		} else if (has(spec.hour, wall.hour)) {
			for (const minute of spec.minute.any ? EVERY_MINUTE : spec.minute.list) {
				const candidate = blockStart + minute * MINUTE;
				if (candidate >= t) return candidate;
			}
		}
		t = blockEnd;
	}
	return undefined;
};

const EVERY_MINUTE: readonly number[] = Array.from({ length: 60 }, (_, i) => i);
