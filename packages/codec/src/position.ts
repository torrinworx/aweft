// Array positions.
//
// An array slot is addressed by a position key, not an index. An index shifts when anything
// before it is inserted or removed, which would make two deltas in one commit depend on the
// order they are applied in, and the format requires that they do not.
//
// Position keys are byte strings ordered as byte strings, so an implementation can order an
// array without asking any other observable anything.

import { codecError } from './cbor.ts';

export { compareBytes as comparePositions } from './bytes.ts';

/**
 * Is this a well formed position key?
 *
 * Params:
 *   p: the bytes to judge
 *
 * Returns: true when the key is non-empty and does not end in a zero byte. Both rules exist
 * so that a key can always be produced between any two distinct keys: with a trailing zero
 * allowed, nothing fits between K and K followed by a zero, and an array would run out of
 * room to grow.
 *
 * Example:
 *   isValidPosition(Uint8Array.of(0x80, 0x00));  // false
 */
export const isValidPosition = (p: Uint8Array): boolean =>
	p instanceof Uint8Array && p.length > 0 && p[p.length - 1] !== 0;

/**
 * Check that this is a well formed position, and hand it back.
 *
 * Params:
 *   p: the position key
 *
 * Returns: the same bytes, so it can wrap a value on its way into a ref.
 *
 * Throws: when it is empty or ends in a zero byte. Both are refused here rather than at the
 * far end, because a key that breaks either rule leaves an array with a place it can never
 * grow into and nothing downstream can tell why.
 *
 * Example:
 *   const ref = { kind: 'array', key: assertPosition(position) };
 */
export const assertPosition = (p: Uint8Array): Uint8Array => {
	if (!isValidPosition(p)) {
		throw codecError('invalid-position', 'a position is non-empty and does not end in a zero byte');
	}
	return p;
};
