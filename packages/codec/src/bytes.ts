// Byte string comparison, used wherever the format needs a total order it can state in one
// sentence: array positions, and the canonical ordering of deltas within a commit.

import { codecError } from './error.ts';

/**
 * Order two byte strings.
 *
 * Params:
 *   a, b: the byte strings to compare
 *
 * Returns: -1, 0 or 1. Bytes are unsigned, and a string that is a prefix of another sorts
 * before it.
 *
 * Example:
 *   compareBytes(Uint8Array.of(1), Uint8Array.of(1, 0)) === -1
 */
export const compareBytes = (a: Uint8Array, b: Uint8Array): number => {
	const shared = Math.min(a.length, b.length);

	for (let i = 0; i < shared; i++) {
		const d = a[i]! - b[i]!;
		if (d !== 0) return d < 0 ? -1 : 1;
	}

	if (a.length === b.length) return 0;
	return a.length < b.length ? -1 : 1;
};

/**
 * Do two byte strings hold the same bytes?
 *
 * Params:
 *   a, b: any two byte strings
 *
 * Returns: true when they are the same length and every byte matches. Identity is not the
 * question: two arrays holding the same bytes are one value to this format.
 *
 * Example:
 *   if (equalBytes(idOfDelta, idOfNode)) apply(delta);
 */
export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => compareBytes(a, b) === 0;

const HEX = '0123456789abcdef';

/**
 * A byte string as lower case hex.
 *
 * Params:
 *   b: the bytes
 *
 * Returns: two characters per byte. Hex is used where bytes have to be a string that still
 * sorts the way the bytes do, which is what lets an array slot be keyed by its position.
 *
 * Example:
 *   slots.set(bytesToHex(position), cell);
 */
export const bytesToHex = (b: Uint8Array): string => {
	let out = '';
	for (const v of b) out += HEX[v >> 4]! + HEX[v & 15]!;
	return out;
};

/**
 * The bytes behind a hex string.
 *
 * Params:
 *   hex: an even number of hex characters
 *
 * Returns: the bytes it spells.
 *
 * Throws: when the length is odd or a character is not hex, rather than guessing at what was
 * meant.
 *
 * Example:
 *   const position = bytesFromHex(slot);
 */
export const bytesFromHex = (hex: string): Uint8Array => {
	if (hex.length % 2 !== 0) throw codecError('invalid-hex', `hex string has an odd length: ${hex.length}`);

	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		const v = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(v)) throw codecError('invalid-hex', `"${hex.slice(i * 2, i * 2 + 2)}" is not a hex byte`);
		out[i] = v;
	}
	return out;
};
