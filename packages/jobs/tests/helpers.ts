// A clock a test drives by hand, so a day of schedule runs in milliseconds and every fire
// lands at a time the test chose.

import type { Clock } from '../src/index.ts';

export interface Driven {
	readonly clock: Clock;
	/** Move time forward, firing every timer due on the way in order, and letting each run settle. */
	advance(ms: number): Promise<void>;
	/** Move time forward without firing anything: the process was asleep. */
	jump(ms: number): void;
	/** Every delay handed to `setTimeout` so far. */
	asked(): readonly number[];
	/** How many timers are armed right now. */
	armed(): number;
}

/** Let the promises a fire set off run to the end. */
export const settle = async (): Promise<void> => {
	for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** `early`: how many milliseconds before its time a timer fires, as a real one sometimes does. */
export const drivenClock = (start: number, options: { early?: number } = {}): Driven => {
	const early = options.early ?? 0;
	let now = start;
	let id = 0;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const delays: number[] = [];
	const clock: Clock = {
		now: () => now,
		setTimeout: (fn, ms) => { delays.push(ms); timers.set(++id, { at: now + ms, fn }); return id; },
		clearTimeout: (handle) => { timers.delete(handle as number); },
	};
	const advance = async (ms: number): Promise<void> => {
		const target = now + ms;
		for (;;) {
			let next: [number, { at: number; fn: () => void }] | undefined;
			for (const pair of timers) {
				if (pair[1].at > target) continue;
				if (next === undefined || pair[1].at < next[1].at) next = pair;
			}
			if (next === undefined) break;
			now = Math.max(now, next[1].at - early);
			timers.delete(next[0]);
			next[1].fn();
			await settle();
		}
		now = target;
		await settle();
	};
	return {
		clock,
		advance,
		jump: (ms) => { now += ms; },
		asked: () => [...delays],
		armed: () => timers.size,
	};
};

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Saturday 12:00 UTC, the day before Toronto's clocks go forward. */
export const START = Date.UTC(2026, 2, 7, 12, 0);
