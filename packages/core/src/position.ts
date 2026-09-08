// Choosing an array position.
//
// The format specifies how positions compare and refuses one that is empty or ends in a zero
// byte. It deliberately does not say how a position between two others is chosen, because a
// receiver orders by comparing and never by regenerating. This is core's choice.
//
// A position is an integer part followed by fractional levels. The integer part is one count
// byte, that many digits in base 254 with no leading zero, and three random bytes; a longer
// integer sorts after every shorter one because the count is compared first, so appending is
// counting up and the key for the ten thousandth row is six bytes (design 082). A fractional
// level is one digit and three random bytes, fixed width, so a byte only ever lines up against
// a byte playing the same part (design 040).
//
// The random bytes are the whole point. Without them the choice is a pure function of the two
// neighbours, so two replicas inserting at the same place name the same slot and one of the
// two inserts is refused: two people adding to a list at the same moment lose one of them.
// `bench/replicate.ts` measures what the levels cost and counts the distinctness.

import { type Position, assertPosition, codecError, compareBytes } from '@aweftjs/codec';

/**
 * Three random bytes follow the integer part and every fractional digit.
 *
 * Three bytes puts two replicas that chose the same digit at one chance in 16.7 million of
 * naming the same slot, and even then the loser's commit is refused rather than lost quietly.
 */
const JITTER = 3;
const LEVEL = 1 + JITTER;

// A fractional digit stays strictly inside the byte range, so there is always room to place
// one below the lowest and above the highest without adding a level.
const FLOOR = 1;
const CEILING = 254;
/** The first fractional digit under a level, so there is room on both sides of it. */
const START = 128;

// An integer digit is its value plus one, so a digit byte is never zero and a key with no
// fractional part still ends in its random bytes. The first element of an array gets this
// integer, so a prepend has as much room as an append before the integer runs out.
const BASE = 254;
const FIRST = 128;
const BASE_WIDE = 254n;

// The arithmetic runs on Numbers, and reaches for BigInt only where a Number cannot hold the
// answer exactly (design 155). Six digits in base 254 is 2.7e14, well inside 2^53; seven is
// 6.8e16, past it. So a key with six digits or fewer is read, compared and counted as a
// Number, and everything a run of them produces stays inside 2^53 as well, because the widest
// answer six digits can lead to is 254^6.
const NUMBER_DIGITS = 6;

/** Is this key's integer part too wide to do exact arithmetic on as a Number? */
const wide = (key: Uint8Array | null): boolean => key !== null && (key[0] ?? 0) > NUMBER_DIGITS;

/**
 * The fractional digit to choose between two bounds, or undefined when none fits.
 *
 * A step of one at each end and the midpoint in the middle. Stepping matters: jumping to the
 * midpoint of an open end burns half the range on every insert. Two replicas choosing the
 * same digit is fine and expected; the randomness after it is what tells them apart.
 */
const digitFor = (da: number | undefined, db: number | undefined): number | undefined => {
	if (da === undefined && db === undefined) return START;
	if (db === undefined) return da! < CEILING ? da! + 1 : undefined;
	if (da === undefined) return db > FLOOR ? db - 1 : undefined;
	return db - da >= 2 ? da + ((db - da) >> 1) : undefined;
};

/** The integer to choose between two bounds, or undefined when none fits. */
const integerFor = (va: number | undefined, vb: number | undefined): number | undefined => {
	if (va === undefined && vb === undefined) return FIRST;
	if (vb === undefined) return va! + 1;
	if (va === undefined) return vb > 0 ? vb - 1 : undefined;
	return vb - va >= 2 ? va + Math.floor((vb - va) / 2) : undefined;
};

/** The same choice where a Number would lose digits. */
const wideIntegerFor = (va: bigint | undefined, vb: bigint | undefined): bigint | undefined => {
	if (va === undefined && vb === undefined) return BigInt(FIRST);
	if (vb === undefined) return va! + 1n;
	if (va === undefined) return vb > 0n ? vb - 1n : undefined;
	return vb - va >= 2n ? va + (vb - va) / 2n : undefined;
};

// Drawn from a pool filled in one call, because one system call per key is most of the cost
// of choosing ten thousand positions in one commit.
const POOL = 4096;
let pool = new Uint8Array(0);
let drawn = 0;
const draw = (): Uint8Array => {
	if (drawn + JITTER > pool.length) {
		pool = crypto.getRandomValues(new Uint8Array(POOL));
		drawn = 0;
	}
	const bytes = pool.subarray(drawn, drawn + JITTER);
	drawn += JITTER;
	return bytes;
};

const jitter = (): number[] => {
	const bytes = draw();
	// A position may not end in a zero byte, and any level may turn out to be the last one.
	if (bytes[JITTER - 1] === 0) bytes[JITTER - 1] = 1;
	return [...bytes];
};

/** The count byte and digits of an integer, without its random bytes. */
const integerBytes = (value: number): number[] => {
	const digits: number[] = [];
	let rest = value;
	do {
		digits.unshift((rest % BASE) + 1);
		rest = Math.floor(rest / BASE);
	} while (rest > 0);
	return [digits.length, ...digits];
};

/** The same bytes for an integer past 2^53. */
const wideIntegerBytes = (value: bigint): number[] => {
	const digits: number[] = [];
	let rest = value;
	do {
		digits.unshift(Number(rest % BASE_WIDE) + 1);
		rest /= BASE_WIDE;
	} while (rest > 0n);
	return [digits.length, ...digits];
};

/** How many bytes the integer part of `key` takes, random bytes included. */
const integerWidth = (key: Uint8Array): number => 1 + (key[0] ?? 0) + JITTER;

/** The integer a key starts with. A key cut short by hand reads as the digits it has. */
const integerOf = (key: Uint8Array | null): number | undefined => {
	if (key === null) return undefined;
	const count = key[0] ?? 0;
	let value = 0;
	for (let i = 1; i <= count && i < key.length; i++) value = value * BASE + (key[i]! - 1);
	return value;
};

/** The same read for a key past 2^53. */
const wideIntegerOf = (key: Uint8Array | null): bigint | undefined => {
	if (key === null) return undefined;
	const count = key[0] ?? 0;
	let value = 0n;
	for (let i = 1; i <= count && i < key.length; i++) value = value * BASE_WIDE + BigInt(key[i]! - 1);
	return value;
};

/**
 * The count byte and digits of the integer strictly between two keys, or null when none fits.
 *
 * One place decides which arithmetic answers, so every caller gets the Number path unless a
 * key on either side is too wide for it.
 */
const integerBetween = (a: Uint8Array | null, b: Uint8Array | null): number[] | null => {
	if (wide(a) || wide(b)) {
		const value = wideIntegerFor(wideIntegerOf(a), wideIntegerOf(b));
		return value === undefined ? null : wideIntegerBytes(value);
	}
	const value = integerFor(integerOf(a), integerOf(b));
	return value === undefined ? null : integerBytes(value);
};

/** Where level `i` of `key` starts. Level 0 is the integer part; the rest are fixed width. */
const levelStart = (key: Uint8Array, i: number): number =>
	(i === 0 ? 0 : integerWidth(key) + (i - 1) * LEVEL);

const levelWidth = (key: Uint8Array, i: number): number => (i === 0 ? integerWidth(key) : LEVEL);

/** The fractional digit of level `i`, or undefined when the key has no level there. */
const digitAt = (key: Uint8Array | null, i: number): number | undefined =>
	(key === null || key.length <= levelStart(key, i) ? undefined : key[levelStart(key, i)]);

/** Do both keys carry the same bytes at level `i`? */
const sameLevel = (a: Uint8Array, b: Uint8Array, i: number): boolean => {
	const width = levelWidth(a, i);
	if (width !== levelWidth(b, i)) return false;
	const at = levelStart(a, i);
	const bt = levelStart(b, i);
	for (let j = 0; j < width; j++) {
		if (a[at + j] !== b[bt + j]) return false;
	}
	return true;
};

/** Is level `i` of `key` the lowest one its digit has, with no randomness after it? */
const zeroJitter = (key: Uint8Array, i: number): boolean => {
	const end = levelStart(key, i) + levelWidth(key, i);
	for (let j = end - JITTER; j < end; j++) {
		if ((key[j] ?? 0) !== 0) return false;
	}
	return true;
};

/** Copy level `i` of `key` onto the answer. */
const copyLevel = (out: number[], key: Uint8Array, i: number): void => {
	const at = levelStart(key, i);
	const width = levelWidth(key, i);
	for (let j = 0; j < width; j++) out.push(key[at + j] ?? 0);
};

/** Copy level `i` of `key` with its randomness zeroed: under everything that shares it. */
const copyLevelUnder = (out: number[], key: Uint8Array, i: number): void => {
	const at = levelStart(key, i);
	const width = levelWidth(key, i);
	for (let j = 0; j < width - JITTER; j++) out.push(key[at + j] ?? 0);
	for (let j = 0; j < JITTER; j++) out.push(0);
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
 * Throws `invalid-position` when `a` is not below `b`, or when the two leave no room that
 * this chooser can find, which only a position written by hand can arrange.
 *
 * `a` and `b` are positions this produced, or ones a replica of the same array produced. A
 * position written by hand is a valid slot key and is not a fraction this can subdivide, so
 * hand one to `insertAt` rather than expecting a neighbour to be chosen beside it.
 *
 * Example:
 *   between(null, null)  // a count of one, one digit, then three random bytes
 */
export const between = (a: Position | null, b: Position | null): Position => {
	// Checked here rather than discovered further down: every branch below assumes the two
	// bound a gap, and handed a pair that does not it would answer with a key outside it.
	if (a !== null && b !== null && compareBytes(a, b) >= 0) {
		throw codecError('invalid-position', 'a position must sit between two ordered positions',
			'Pass the lower position as a and the higher as b, or null for an open end.');
	}

	const out: number[] = [];
	let above: Uint8Array | null = b;

	const finish = (): Position => {
		const key = Uint8Array.from(out);
		if ((a !== null && compareBytes(a, key) >= 0) || (b !== null && compareBytes(key, b) >= 0)) {
			throw codecError('invalid-position', 'no position fits between these two',
				'Name the slot yourself with insertAt rather than asking for one between these.');
		}
		// The two rules this restates are what every level above was built to hold to, so the
		// mint is the check: the key leaves here as a position or it does not leave at all.
		return assertPosition(key);
	};

	// The integer part first. It is one level with its own arithmetic; the rules for where to
	// go when nothing fits are the same as for a fractional level.
	if (a !== null && above !== null && sameLevel(a, above, 0)) {
		copyLevel(out, a, 0);
	} else {
		const bytes = integerBetween(a, above);
		if (bytes !== null) {
			out.push(...bytes, ...jitter());
			return finish();
		}

		if (a !== null) {
			// Adjacent integers, or equal with different randomness: go under `a`.
			copyLevel(out, a, 0);
			above = null;
		} else if (zeroJitter(above!, 0)) {
			copyLevel(out, above!, 0);
		} else {
			// `b` is the integer zero: nothing counts below it, so sit under it.
			copyLevelUnder(out, above!, 0);
			above = null;
		}
	}

	for (let i = 1; ; i++) {
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
			return finish();
		}

		if (da !== undefined) {
			// The digits are adjacent, or equal with different randomness, so nothing fits beside
			// them. Go under `a`: every level added below it is above `a`, and `a` is not a prefix
			// of `b` in this branch, so it is still below `b`.
			copyLevel(out, a!, i);
			above = null;
			continue;
		}

		// `a` has run out and `b` sits on the floor, so no digit fits below it. Take `b`'s level
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
		copyLevelUnder(out, above!, i);
		above = null;
	}
};

/**
 * A run of positions after `a`, in order, each above the one before.
 *
 * Params:
 *   a: the position the run starts after, or null for an empty array
 *   count: how many positions to mint
 *
 * Returns: `count` valid positions. Every one is above `a` and above the one before it, and
 * each carries its own randomness, so two replicas appending at the same moment still name
 * different slots.
 *
 * Appending is counting up (design 082), so this is what `between(a, null)` does in a loop
 * with the decoding taken out: the integer part of `a` is read once and the run takes the next
 * integers from there, rather than taking apart the key it wrote a moment ago. The keys are
 * the ones the one-at-a-time path produced. Internal to core; nothing exports it.
 */
/**
 * The same run, one key at a time. Taken when the fast path's first key does not sort above
 * `a`, which an `a` nobody minted can produce: `between` is the one place that decides where to
 * go when nothing fits, and its refusal is the one the caller should see.
 */
const oneAtATime = (a: Position | null, count: number, out: Position[]): Position[] => {
	let previous = a;
	for (let i = 0; i < count; i++) {
		previous = between(previous, null);
		out[i] = previous;
	}
	return out;
};

export const run = (a: Position | null, count: number): Position[] => {
	const out: Position[] = new Array<Position>(count);
	if (count === 0) return out;

	// The tail of an array is the one shape where the answer is decided at level zero every
	// time: `between` with an open upper end takes the next integer and returns, whatever
	// fractional levels `a` carries below it.
	// `wide` is only ever true of a key, so there is a key to read here.
	if (wide(a)) {
		let value = wideIntegerOf(a)!;
		for (let i = 0; i < count; i++) {
			value += 1n;
			const key = Uint8Array.from([...wideIntegerBytes(value), ...jitter()]);
			if (i === 0 && a !== null && compareBytes(key, a) <= 0) return oneAtATime(a, count, out);
			out[i] = assertPosition(key);
		}
		return out;
	}

	// Six digits is 2.7e14 and a run adds one per value, so the count stays exact as a Number
	// however long the run is; a seventh digit only appears on the next call, which reads the
	// key it produced and takes the wide path above.
	//
	// The bytes go straight into the key. A run of ten thousand is the one place where the
	// lists `between` passes its bytes through cost more than the arithmetic does: writing
	// them in place took the run from 2.4 ms to 0.8 ms against 3.3 ms for the same ten
	// thousand keys one at a time.
	const digits: number[] = [];
	let value = integerOf(a) ?? FIRST - 1;
	for (let i = 0; i < count; i++) {
		value += 1;

		digits.length = 0;
		let rest = value;
		do {
			digits.push((rest % BASE) + 1);
			rest = Math.floor(rest / BASE);
		} while (rest > 0);

		const key = new Uint8Array(1 + digits.length + JITTER);
		key[0] = digits.length;
		// `digits` came out least significant first, and a key reads most significant first.
		for (let j = 0; j < digits.length; j++) key[1 + j] = digits[digits.length - 1 - j]!;

		const bytes = draw();
		// A position may not end in a zero byte, and the jitter is the end of this key.
		if (bytes[JITTER - 1] === 0) bytes[JITTER - 1] = 1;
		key.set(bytes, 1 + digits.length);

		// The run promises every key is above `a`, and only the first one can break it: a key
		// nobody minted, cut short or grown by hand, can read as an integer whose successor is
		// shorter than the key itself and so sorts below it. The whole run then goes back
		// through `between`, which is where that case is decided.
		if (i === 0 && a !== null && compareBytes(key, a) <= 0) return oneAtATime(a, count, out);

		out[i] = assertPosition(key);
	}
	return out;
};
