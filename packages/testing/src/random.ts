// Seeded randomness for property tests.
//
// A property test is only worth having if a failure can be run again, so the generator is
// seeded and the seed is what a failing assertion prints. There is one implementation here
// rather than one per suite, because four copies of the same shift-register drifted apart in
// small ways and a seed that reproduces a failure under one of them reproduces nothing under
// another.

/**
 * A seeded stream of numbers in [0, 1).
 *
 * Params:
 *   seed: any integer. It is folded to 32 bits, so seeds equal modulo 2^32 give one stream,
 *         and zero is mapped to 1, since a shift register cannot leave zero
 *
 * Returns: a function giving the next number. Two generators made with one seed produce the
 * same stream, so a failure prints its seed and the run can be repeated exactly.
 *
 * Example:
 *   const random = randomFrom(20260901);
 *   assert.ok(check(list), `failed at seed 20260901`);
 */
export const randomFrom = (seed: number): (() => number) => {
	let s = seed >>> 0 || 1;

	return () => {
		s ^= s << 13; s >>>= 0;
		s ^= s >> 17;
		s ^= s << 5; s >>>= 0;
		return s / 0x100000000;
	};
};

/**
 * A whole number in [0, bound).
 *
 * Params:
 *   random: a stream from randomFrom
 *   bound: how many values, at least 1
 *
 * Returns: an index into something of that length.
 *
 * Example:
 *   const victim = items[randomBelow(random, items.length)];
 */
export const randomBelow = (random: () => number, bound: number): number => {
	// A bound of zero has no index to give, and returning 0 anyway would read as one.
	if (!(bound >= 1)) throw new Error(`randomBelow needs a bound of at least 1, got ${bound}`);
	return Math.floor(random() * bound);
};
