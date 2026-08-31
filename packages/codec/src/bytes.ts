// Byte string comparison, used wherever the format needs a total order it can state in one
// sentence: array positions, and the canonical ordering of deltas within a commit.

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

export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => compareBytes(a, b) === 0;

const HEX = '0123456789abcdef';

export const bytesToHex = (b: Uint8Array): string => {
	let out = '';
	for (const v of b) out += HEX[v >> 4]! + HEX[v & 15]!;
	return out;
};

export const bytesFromHex = (hex: string): Uint8Array => {
	if (hex.length % 2 !== 0) throw new Error(`hex string has an odd length: ${hex.length}`);

	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		const v = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(v)) throw new Error(`"${hex.slice(i * 2, i * 2 + 2)}" is not a hex byte`);
		out[i] = v;
	}
	return out;
};
