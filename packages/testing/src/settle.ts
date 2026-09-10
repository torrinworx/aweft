// Let scheduled work run.

import { codecError } from '@aweftjs/codec';

/**
 * Yield to the timer queue, once per round, so work that schedules more work gets to run.
 *
 * A single `await` drains microtasks and nothing else, which is why a suite that awaits once
 * and asserts sees a tree that is half settled. Ten rounds is what the suites that wrote this
 * by hand all chose.
 *
 * @param rounds How many times to yield. Each round lets one more layer of chained timers run.
 * @returns Nothing, once the rounds are done.
 * @throws `rounds-not-positive` when `rounds` is not a whole number of one or more.
 * @example
 * page.click();
 * await settle();
 * assert.equal(seen.length, 1);
 */
export const settle = async (rounds: number = 10): Promise<void> => {
	// A zero, a negative or a NaN means a caller computed the number and got it wrong; settling
	// for no rounds at all would answer at once and the assertion after it would fail somewhere
	// else entirely.
	if (!Number.isInteger(rounds) || rounds < 1) {
		throw codecError(
			'rounds-not-positive', `settle was asked for ${String(rounds)} rounds`,
			'Pass a whole number of rounds, one or more, or nothing for the default.',
		);
	}
	for (let i = 0; i < rounds; i++) await new Promise<void>((done) => setTimeout(done, 0));
};
