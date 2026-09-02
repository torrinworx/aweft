// Choosing an array position.
//
// The format specifies how positions compare and refuses one that is empty or ends in a zero
// byte. It deliberately does not say how a position between two others is chosen, because a
// receiver orders by comparing and never by regenerating. This is core's choice.
//
// A position is a run of fixed-width levels, each a digit and a few random bytes. Read as a
// fraction, the digits are the digits and the random bytes break a tie between two replicas
// that chose the same one. Fixed width is what makes a plain byte comparison mean the same
// thing as comparing level by level: a byte can only ever line up against a byte playing the
// same part.
//
// The random bytes are the whole point. Without them the choice is a pure function of the two
// neighbours, so two replicas inserting at the same place name the same slot and one of the
// two inserts is refused: two people adding to a list at the same moment lose one of them.
// Design 040. Design 014 claimed the keys already differed, nothing checked it, and they
// did not. `bench/replicate.ts` measures what the levels cost and counts the distinctness.

import { codecError, compareBytes } from '@aweftjs/codec';

/**
 * A level is one digit and three random bytes.
 *
 * Three bytes puts two replicas that chose the same digit at one chance in 16.7 million of
 * naming the same slot, and even then the loser's commit is refused rather than lost quietly.
 * It costs four bytes where a bare digit costs one.
 */
const JITTER = 3;
const LEVEL = 1 + JITTER;

// A chosen digit stays strictly inside the byte range, so there is always room to place one
// below the lowest and above the highest without adding a level.
const FLOOR = 1;
const CEILING = 254;
/** Where the first element of an array goes, so there is room on both sides of it. */
const START = 128;

/**
 * The digit to choose between two bounds, or undefined when none fits.
 *
 * A step of one at each end and the midpoint in the middle. Stepping matters: jumping to the
 * midpoint of an open end burns half the range on every append, which is 250 levels over two
 * thousand appends against eight. Two replicas choosing the same digit is fine and expected;
 * the randomness after it is what tells them apart.
 */
const digitFor = (da: number | undefined, db: number | undefined): number | undefined => {
	if (da === undefined && db === undefined) return START;
	if (db === undefined) return da! < CEILING ? da! + 1 : undefined;
	if (da === undefined) return db > FLOOR ? db - 1 : undefined;
	return db - da >= 2 ? da + ((db - da) >> 1) : undefined;
};

const jitter = (): number[] => {
	const bytes = crypto.getRandomValues(new Uint8Array(JITTER));
	// A position may not end in a zero byte, and any level may turn out to be the last one.
	if (bytes[JITTER - 1] === 0) bytes[JITTER - 1] = 1;
	return [...bytes];
};

/** The digit of level `i`, or undefined when the key has no level there. */
const digitAt = (key: Uint8Array | null, i: number): number | undefined =>
	(key === null || key.length <= i * LEVEL ? undefined : key[i * LEVEL]);

/** Do both keys carry the same bytes at level `i`? */
const sameLevel = (a: Uint8Array, b: Uint8Array, i: number): boolean => {
	const at = i * LEVEL;
	for (let j = 0; j < LEVEL; j++) {
		if (a[at + j] !== b[at + j]) return false;
	}
	return true;
};

/** Is level `i` of `key` the lowest one that digit has, with no randomness after it? */
const zeroJitter = (key: Uint8Array, i: number): boolean => {
	const at = i * LEVEL;
	for (let j = 1; j < LEVEL; j++) {
		if ((key[at + j] ?? 0) !== 0) return false;
	}
	return true;
};

/** Copy level `i` of `key` onto the answer. */
const copyLevel = (out: number[], key: Uint8Array, i: number): void => {
	const at = i * LEVEL;
	for (let j = 0; j < LEVEL; j++) out.push(key[at + j] ?? 0);
};

/**
 * A position strictly between two others.
 *
 * Params:
 *   a: the position before, or null for the start of the array
 *   b: the position after, or null for the end
 *
 * Returns: a valid position, non-empty and not ending in a zero byte. Two calls with the same
 * neighbours give two different positions, both between them, in an order both sides agree on.
 *
 * Throws `invalid-position` when `a` is not below `b`.
 *
 * `a` and `b` are positions this produced, or ones a replica of the same array produced. A
 * position written by hand is a valid slot key and is not a fraction this can subdivide, so
 * hand one to `insertAt` rather than expecting a neighbour to be chosen beside it.
 *
 * Example:
 *   between(null, null)  // one level: a digit near the middle, then three random bytes
 */
export const between = (a: Uint8Array | null, b: Uint8Array | null): Uint8Array => {
	// Checked here rather than discovered further down: every branch below assumes the two
	// bound a gap, and handed a pair that does not it would answer with a key outside it.
	if (a !== null && b !== null && compareBytes(a, b) >= 0) {
		throw codecError('invalid-position', 'a position must sit between two ordered positions');
	}

	const out: number[] = [];
	let above: Uint8Array | null = b;

	for (let i = 0; ; i++) {
		const da = digitAt(a, i);
		const db = digitAt(above, i);

		// The same level on both sides says nothing about where the answer goes. Copy it and
		// look at the next one.
		if (da !== undefined && db !== undefined && sameLevel(a!, above!, i)) {
			copyLevel(out, a!, i);
			continue;
		}

		const digit = digitFor(da, db);
		if (digit !== undefined) {
			out.push(digit, ...jitter());
			return Uint8Array.from(out);
		}

		if (da !== undefined) {
			// The digits are adjacent, or equal with different randomness, so nothing fits beside
			// them. Go under `a`: every level added below it is above `a`, and `a` is not a prefix
			// of `b` in this branch, so it is still below `b`.
			copyLevel(out, a!, i);
			above = null;
			continue;
		}

		// `a` has run out and `b` sits on the floor, so no digit fits below it. Take `b`'s digit
		// with no randomness at all, which is under every level that shares that digit, and
		// place the answer below that.
		//
		// Unless `b`'s own level is already that: then copying it puts the answer nowhere, and
		// the room has to be found further down. The last level of a position never has zero
		// randomness, because a position never ends in a zero byte, so this always ends.
		if (zeroJitter(above!, i)) {
			copyLevel(out, above!, i);
			continue;
		}
		// `db` is defined here: `a` has run out, so `digitFor` only answers undefined when `b`
		// has a level too, and the entry check has already refused a pair that is not a gap.
		out.push(db!, ...new Uint8Array(JITTER));
		above = null;
	}
};
