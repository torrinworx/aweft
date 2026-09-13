// A count per key inside a sliding window (design 272). The server counts requests by peer
// address with one; the auth battery counts sign-in attempts by email and by address with two.

import { serverError } from './contract.ts';

/** How many inside how long. */
export interface Window {
	readonly count: number;
	readonly windowMs: number;
}

/** Whether one more fits, and when the next will when it does not. */
export type Taken = { readonly ok: true } | { readonly ok: false; readonly retryAfter: number };

export interface Sliding {
	/**
	 * Count one for `key` if the window has room.
	 *
	 * Returns: `{ ok: true }` and the hit is counted; `{ ok: false, retryAfter }` with the whole
	 * seconds until the oldest hit leaves the window, and nothing is counted.
	 */
	take(key: string, now?: number): Taken;
	/** Forget every hit for `key`. */
	clear(key: string): void;
}

// Over 2^31 - 1 milliseconds Node fires a timer after one millisecond instead, and a window
// nobody could wait out is a mistake to stop at construction.
const MAX_WINDOW = 2_147_483_647;

// How many keys are held at once. A flood from as many addresses as it likes, each hit once,
// would otherwise grow the map for the length of the window; past this a key goes, which costs
// that key its count and the process nothing. The key let go is the oldest that is under its
// count, looked for among the oldest few, so a flood of fresh keys does not free a key that is
// at its count; only a flood that puts that many keys at their count does.
const MAX_KEYS = 65_536;
const LOOK = 8;

/**
 * A sliding-window counter: at most `count` hits per key in any `windowMs` span.
 *
 * Params:
 *   window: `{ count, windowMs }`, both positive; `windowMs` at most 2147483647
 *
 * Returns: `take` and `clear`. A key not seen inside the window holds nothing; a key whose
 * every hit has left the window is dropped when the map has grown past a few thousand; and
 * past 65 536 keys one is dropped for each new one, the oldest under its count among the
 * oldest few, else the oldest, so a flood of keys bounds the memory it costs at the price of a
 * count, and a key at its count keeps it unless the flood puts that many keys at theirs.
 * `retryAfter` is never more than the window.
 *
 * Throws: `invalid-limit` when either number is not positive or the window is over the bound.
 *
 * Example:
 *   const attempts = sliding({ count: 5, windowMs: 900_000 });
 *   const taken = attempts.take('ada@example.com');
 *   if (!taken.ok) answer(429, { 'retry-after': String(taken.retryAfter) });
 */
export const sliding = ({ count, windowMs }: Window): Sliding => {
	if (!(Number.isInteger(count) && count > 0)) {
		throw serverError('invalid-limit', `count ${JSON.stringify(count)} is not a positive number`, 'Give count a positive number of hits per window.');
	}
	if (!(typeof windowMs === 'number' && windowMs > 0 && windowMs <= MAX_WINDOW)) {
		throw serverError('invalid-limit', `windowMs ${JSON.stringify(windowMs)} is not a positive number a timer holds`, 'Give windowMs a positive number of milliseconds, at most 2147483647.');
	}
	const hits = new Map<string, number[]>();
	let sweepAt = 0;

	// Keys are addresses and emails, which a flood varies without bound; the map is swept of
	// empty keys once it is large, at most once per window, so the sweep is not itself the cost.
	const sweep = (now: number): void => {
		if (hits.size <= 4096 || now < sweepAt) return;
		sweepAt = now + windowMs;
		const since = now - windowMs;
		for (const [key, held] of hits) if (held.length === 0 || held[held.length - 1]! <= since) hits.delete(key);
	};

	// A Map keeps insertion order, so its first keys are the oldest.
	const evict = (): void => {
		let looked = 0;
		for (const [key, held] of hits) {
			if (held.length < count) { hits.delete(key); return; }
			if (++looked >= LOOK) break;
		}
		hits.delete(hits.keys().next().value!);
	};

	return {
		take: (key, now = Date.now()) => {
			sweep(now);
			const since = now - windowMs;
			let held = hits.get(key);
			if (held === undefined) {
				held = [];
				hits.set(key, held);
				if (hits.size > MAX_KEYS) evict();
			}
			while (held.length > 0 && held[0]! <= since) held.shift();
			if (held.length >= count) {
				// A clock that moved back would put the oldest hit in the future; the wait is never
				// longer than the window itself.
				const wait = Math.min(windowMs, Math.max(0, held[0]! + windowMs - now));
				return { ok: false, retryAfter: Math.max(1, Math.ceil(wait / 1000)) };
			}
			held.push(now);
			return { ok: true };
		},
		clear: (key) => { hits.delete(key); },
	};
};
