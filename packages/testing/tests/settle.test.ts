// The tick loop, defined in 22 files before it shipped once.

import test from 'node:test';
import assert from 'node:assert/strict';

import { settle } from '../src/index.ts';

test('settle yields to the timer queue, so work scheduled by work gets to run', async () => {
	const order: string[] = [];
	// A chain a single await would not drain: each timer schedules the next.
	setTimeout(() => {
		order.push('first');
		setTimeout(() => { order.push('second'); }, 0);
	}, 0);

	await settle();
	assert.deepEqual(order, ['first', 'second']);
});

test('settle takes the number of rounds it was given', async () => {
	let rounds = 0;
	const again = (): void => { rounds += 1; if (rounds < 10) setTimeout(again, 0); };
	setTimeout(again, 0);

	await settle(3);
	assert.equal(rounds, 3, 'three rounds drains three chained timers and no more');
});

test('a round count that is not a whole number of one or more is refused', async () => {
	for (const rounds of [0, -1, 1.5, Number.NaN]) {
		await assert.rejects(
			() => settle(rounds),
			(error: { reason?: string }) => {
				assert.equal(error.reason, 'rounds-not-positive');
				return true;
			},
			`settle(${String(rounds)}) settled for no rounds instead of refusing`,
		);
	}
});
