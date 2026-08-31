// Choosing an array position.
//
// The format specifies how positions compare and refuses one that is empty or ends in a zero
// byte. It deliberately does not say how a position between two others is chosen, because a
// receiver orders by comparing and never by regenerating. This is core's choice.
//
// Positions are read as fractions in base 256: the digits after an implied point, with no
// trailing zero, exactly as a decimal fraction has none. Between any two there is always
// room, which is the property the two rules in the format exist to protect.

import { codecError } from '@aweftjs/codec';

/** The smallest-effort position strictly after `a`, or the first one when there is no `a`. */
const after = (a: Uint8Array | null): Uint8Array => {
	if (a === null || a.length === 0) return Uint8Array.of(0x80);

	const last = a[a.length - 1]!;
	if (last < 0xff) {
		const out = Uint8Array.from(a);
		out[out.length - 1] = last + 1;
		return out;
	}

	// Nothing is left in the last digit, so go one digit deeper. Appending anything non-zero
	// sorts after the string it extends.
	const out = new Uint8Array(a.length + 1);
	out.set(a);
	out[a.length] = 0x80;
	return out;
};

/** The smallest-effort position strictly before `b`. */
const before = (b: Uint8Array): Uint8Array => {
	const first = b[0]!;
	if (first >= 2) return Uint8Array.of(first - 1);
	if (first === 1) return Uint8Array.of(0, 0x80);

	// A leading zero has nothing below it, so keep it and place the answer under the rest.
	const tail = before(b.subarray(1));
	const out = new Uint8Array(tail.length + 1);
	out.set(tail, 1);
	return out;
};

/**
 * A position strictly between two others.
 *
 * Params:
 *   a: the position before, or null for the start of the array
 *   b: the position after, or null for the end
 *
 * Returns: a valid position, non-empty and not ending in a zero byte.
 *
 * Example:
 *   between(Uint8Array.of(0x80), null)  // 0x81
 *   between(null, Uint8Array.of(0x80))  // 0x7f
 */
export const between = (a: Uint8Array | null, b: Uint8Array | null): Uint8Array => {
	if (b === null) return after(a);
	if (a === null) return before(b);

	const out: number[] = [];

	for (let i = 0; ; i++) {
		if (i >= b.length) {
			throw codecError('invalid-position', 'a position must sit between two ordered positions');
		}

		const x = i < a.length ? a[i]! : 0;
		const y = b[i]!;

		if (y - x >= 2) {
			out.push(x + ((y - x) >> 1));
			return Uint8Array.from(out);
		}

		if (x === y) {
			out.push(x);
			continue;
		}

		// One apart, so nothing fits at this digit. Take the lower one, which already puts the
		// answer under b, and everything left to do is to clear a.
		out.push(x);
		const rest = i + 1 < a.length ? a.subarray(i + 1) : null;
		const tail = after(rest);

		const result = new Uint8Array(out.length + tail.length);
		result.set(out);
		result.set(tail, out.length);
		return result;
	}
};
