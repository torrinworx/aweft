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
 * A key is non-empty and does not end in a zero byte. Both rules exist so that a key can
 * always be produced between any two distinct keys: with a trailing zero allowed, nothing
 * fits between K and K followed by a zero, and an array would run out of room to grow.
 */
export const isValidPosition = (p: Uint8Array): boolean =>
	p instanceof Uint8Array && p.length > 0 && p[p.length - 1] !== 0;

export const assertPosition = (p: Uint8Array): Uint8Array => {
	if (!isValidPosition(p)) {
		throw codecError('invalid-position', 'a position is non-empty and does not end in a zero byte');
	}
	return p;
};
