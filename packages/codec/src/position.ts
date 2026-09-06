// Array positions.
//
// An array slot is addressed by a position key, not an index. An index shifts when anything
// before it is inserted or removed, which would make two deltas in one commit depend on the
// order they are applied in, and the format requires that they do not.
//
// Position keys are byte strings ordered as byte strings, so an implementation can order an
// array without asking any other observable anything.
//
// This package judges positions and never mints one: there is no function here that chooses
// a key between two others. Choosing belongs to whatever owns the array being edited, and a
// receiver never regenerates a key it was sent.

import { codecError } from './wire.ts';

import { compareBytes } from './bytes.ts';

// Ambient, so it erases with the types and adds no runtime declaration. See id.ts.
declare const positionBrand: unique symbol;

/**
 * Bytes that have been checked to be a position key.
 *
 * The same bytes a `Uint8Array` holds, and the same bytes on the wire. The brand is a property
 * that exists only while the compiler is looking, so an id or an integrity tag cannot stand in
 * for a position in a signature that asks for one (design 104).
 *
 * `assertPosition` is the only thing that produces one, because this package judges positions
 * and never mints one.
 *
 * Example:
 *   const ref = { kind: 'array', key: assertPosition(bytes) };
 */
export type Position = Uint8Array & { readonly [positionBrand]: true };

/**
 * Order two position keys.
 *
 * Params:
 *   a, b: position keys
 *
 * Returns: negative, zero or positive, ordering the keys as their bytes order, which is the
 * one array order every implementation agrees on.
 *
 * Example:
 *   positions.sort(comparePositions);
 */
export const comparePositions = (a: Position, b: Position): number => compareBytes(a, b);

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
 * Returns: the same bytes as a Position, so it can wrap a value on its way into a ref. This is
 * where raw bytes become a position: the check and the type say the same thing here.
 *
 * Throws: when it is empty or ends in a zero byte. Both are refused here rather than at the
 * far end, because a key that breaks either rule leaves an array with a place it can never
 * grow into and nothing downstream can tell why.
 *
 * Example:
 *   const ref = { kind: 'array', key: assertPosition(position) };
 */
export const assertPosition = (p: Uint8Array): Position => {
	if (!isValidPosition(p)) {
		throw codecError('invalid-position', 'a position is non-empty and does not end in a zero byte',
			'Drop the trailing zero bytes from the key, and never pass an empty one.');
	}
	return p as Position;
};
