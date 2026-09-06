// Observable ids: what two replicas agree on when they cannot agree on a position in a tree.

import { codecError } from './wire.ts';

// The brand lives in the type system and nowhere else. `declare const` is ambient, so it
// erases with the types and adds no runtime declaration, which `erasableSyntaxOnly` forbids.
declare const idBrand: unique symbol;

/**
 * Bytes that have been checked to be an id.
 *
 * The same twelve bytes a `Uint8Array` holds, and the same bytes on the wire. The brand is a
 * property that exists only while the compiler is looking, so a position or an integrity tag
 * cannot stand in for an id in a signature that asks for one (design 104).
 *
 * `createId` and `assertId` are the only things that produce one. Bytes from anywhere else
 * reach an id by going through `assertId`, which is the width check they needed anyway.
 *
 * Example:
 *   const id: Id = assertId(bytes);
 */
export type Id = Uint8Array & { readonly [idBrand]: true };

/** 96 bits. Twelve bytes encode to exactly sixteen base64url characters with no padding. */
export const ID_BYTES = 12;
/** How many characters the text form of an id is. Sixteen base64url characters, no padding. */
export const ID_TEXT_LENGTH = 16;

// Drawn from a pool filled in one call, as array position jitter is: the call itself was 59%
// of the cost of making ten thousand observables, and the bytes are the same bytes either way
// (design 086). 341 ids, so the buffer divides evenly and stays under a page.
const POOL = ID_BYTES * 341;
let pool = new Uint8Array(0);
let drawn = 0;

/**
 * Mint an id.
 *
 * Returns: ID_BYTES of cryptographically secure randomness.
 *
 * There is no seed, no injectable generator, and no fallback. A generator that can be
 * replaced at runtime exists so tests can be deterministic, and its effect is that tests
 * observe randomness production never sees, so no test can catch a weak source. Code that
 * needs deterministic ids takes them as input instead.
 */
export const createId = (): Id => {
	if (drawn + ID_BYTES > pool.length) {
		pool = crypto.getRandomValues(new Uint8Array(POOL));
		drawn = 0;
	}
	// A copy, not a view: an id outlives the draw and two ids must never share a buffer.
	const id = pool.slice(drawn, drawn + ID_BYTES);
	drawn += ID_BYTES;
	// A mint site: the width comes from the slice above, so this names what was already true.
	return id as Id;
};

/**
 * Check that this is an id, and hand it back.
 *
 * Params:
 *   id: the bytes to check
 *
 * Returns: the same bytes as an Id, so it can wrap a value on its way into a structure. This
 * is where raw bytes become an id: the check and the type say the same thing here, and every
 * signature downstream can then ask for an id and get one.
 *
 * Throws: when it is not exactly ID_BYTES long. An id of the wrong width is refused at the
 * edge rather than stored and found later, because by then nothing can say what it was.
 *
 * Example:
 *   const delta = { type: 'add', id: assertId(bytes), ref, value };
 */
export const assertId = (id: Uint8Array): Id => {
	if (!(id instanceof Uint8Array) || id.length !== ID_BYTES) {
		throw codecError('invalid-id', `an id is ${ID_BYTES} bytes, got ${(id as Uint8Array)?.length}`,
			'Mint ids with createId, which always returns bytes of the right width.');
	}
	return id as Id;
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const REVERSE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET.charCodeAt(i)] = i;

/**
 * The textual form of an id: sixteen base64url characters.
 *
 * Params:
 *   id: an id. Raw bytes reach one through assertId
 *
 * Returns: the text form, safe in a URL, a log line, or a JSON object key.
 *
 * Throws: a CodecError with reason `invalid-id` when the bytes are not ID_BYTES long.
 */
export const idToText = (id: Id): string => {
	assertId(id);

	let out = '';
	for (let i = 0; i < ID_BYTES; i += 3) {
		const n = (id[i]! << 16) | (id[i + 1]! << 8) | id[i + 2]!;
		out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
		out += ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
	}
	return out;
};

/**
 * The id behind its text form.
 *
 * Params:
 *   text: sixteen base64url characters, as idToText writes them
 *
 * Returns: the 12 bytes, as an id.
 *
 * Throws: when the length or the alphabet is wrong. Round tripping through text is lossless,
 * so anything that does not round trip was never one of these ids.
 *
 * Example:
 *   const id = idFromText(slotKey);
 */
export const idFromText = (text: string): Id => {
	if (text.length !== ID_TEXT_LENGTH) {
		throw codecError('invalid-id', `an id is ${ID_TEXT_LENGTH} characters, got ${text.length}`,
			'Pass text that idToText wrote, not a shortened or padded copy of it.');
	}

	const out = new Uint8Array(ID_BYTES);
	for (let i = 0, j = 0; i < ID_TEXT_LENGTH; i += 4, j += 3) {
		let n = 0;
		for (let k = 0; k < 4; k++) {
			const code = text.charCodeAt(i + k);
			const v = code < 128 ? REVERSE[code]! : -1;
			if (v < 0) {
				throw codecError('invalid-id', `"${text[i + k]}" is not a base64url character`,
					'Pass text that idToText wrote, using A to Z, a to z, 0 to 9, - and _.');
			}
			n = (n << 6) | v;
		}
		out[j] = (n >> 16) & 0xff;
		out[j + 1] = (n >> 8) & 0xff;
		out[j + 2] = n & 0xff;
	}
	// A mint site: `out` is ID_BYTES wide by construction and the alphabet was checked above.
	return out as Id;
};
