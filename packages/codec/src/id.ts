// Observable ids: what two replicas agree on when they cannot agree on a position in a tree.

import { codecError } from './cbor.ts';

/** 96 bits. Twelve bytes encode to exactly sixteen base64url characters with no padding. */
export const ID_BYTES = 12;
/** How many characters the text form of an id is. Sixteen base64url characters, no padding. */
export const ID_TEXT_LENGTH = 16;

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
export const createId = (): Uint8Array => crypto.getRandomValues(new Uint8Array(ID_BYTES));

/**
 * Check that this is an id, and hand it back.
 *
 * Params:
 *   id: the bytes to check
 *
 * Returns: the same bytes, so it can wrap a value on its way into a structure.
 *
 * Throws: when it is not exactly ID_BYTES long. An id of the wrong width is refused at the
 * edge rather than stored and found later, because by then nothing can say what it was.
 *
 * Example:
 *   const delta = { type: 'add', id: assertId(bytes), ref, value };
 */
export const assertId = (id: Uint8Array): Uint8Array => {
	if (!(id instanceof Uint8Array) || id.length !== ID_BYTES) {
		throw codecError('invalid-id', `an id is ${ID_BYTES} bytes, got ${(id as Uint8Array)?.length}`);
	}
	return id;
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const REVERSE = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) REVERSE[ALPHABET.charCodeAt(i)] = i;

/**
 * The textual form of an id: sixteen base64url characters.
 *
 * Params:
 *   id: ID_BYTES of id
 *
 * Returns: the text form, safe in a URL, a log line, or a JSON object key.
 */
export const idToText = (id: Uint8Array): string => {
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
 * Returns: the 12 bytes.
 *
 * Throws: when the length or the alphabet is wrong. Round tripping through text is lossless,
 * so anything that does not round trip was never one of these ids.
 *
 * Example:
 *   const id = idFromText(slotKey);
 */
export const idFromText = (text: string): Uint8Array => {
	if (text.length !== ID_TEXT_LENGTH) {
		throw codecError('invalid-id', `an id is ${ID_TEXT_LENGTH} characters, got ${text.length}`);
	}

	const out = new Uint8Array(ID_BYTES);
	for (let i = 0, j = 0; i < ID_TEXT_LENGTH; i += 4, j += 3) {
		let n = 0;
		for (let k = 0; k < 4; k++) {
			const code = text.charCodeAt(i + k);
			const v = code < 128 ? REVERSE[code]! : -1;
			if (v < 0) throw codecError('invalid-id', `"${text[i + k]}" is not a base64url character`);
			n = (n << 6) | v;
		}
		out[j] = (n >> 16) & 0xff;
		out[j + 1] = (n >> 8) & 0xff;
		out[j + 2] = n & 0xff;
	}
	return out;
};
