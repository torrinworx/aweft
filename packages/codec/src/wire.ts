// The byte layer: one encoding per value, and a decoder that proves it.
//
// The type set is deliberately small. Null, booleans, integers, float64, byte strings, text
// strings and arrays. Nothing else is representable, so there is no dialect to negotiate and
// no second way to write anything.
//
// Every rule below serves one property: for any input the decoder accepts, re-encoding what
// it produced reproduces the original bytes. That is stronger than round-tripping values,
// and it is what conformance rests on, because it makes the decoder reject anything the
// encoder would not have written: an integer padded into a wider form, a float holding a
// whole number, a length prefix with room to spare.

import { codecError } from './error.ts';
export { codecError } from './error.ts';
export type { CodecError } from './error.ts';

/** How deeply arrays may nest. Values nest two deep at most, so this is a bomb guard. */
// Stated in spec/format.md 6.1: nothing this format writes nests past four levels, and a
// decoder refuses past eight, so a malicious length cannot recurse a reader to death while
// honest growth still has room.
const MAX_DEPTH = 8;

/**
 * Integers are exact in this range and are written as integers. Outside it, as float64.
 *
 * The bound is exact representability, which is what section 6.2 states, and not the safe
 * integer range: a double holds 2^53 exactly and 2^53 + 1 not at all. Reaching for
 * `MAX_SAFE_INTEGER` here stops one short on the positive side and leaves the range lopsided,
 * so a whole number another implementation wrote as an integer, reading the same prose, comes
 * back refused.
 */
export const MAX_INT = 2 ** 53;
export const MIN_INT = -(2 ** 53);

/**
 * Everything the encoding can carry, at the level below deltas and commits.
 *
 * The type set is small on purpose, and there are no maps and no tagged values. A commit is
 * built out of these and nothing else, which is what keeps one spelling per value.
 */
export type WireValue = null | boolean | number | string | Uint8Array | readonly WireValue[];

// --- writing ---------------------------------------------------------------------------

export interface Writer {
	bytes: Uint8Array;
	length: number;
}

export const createWriter = (): Writer => ({ bytes: new Uint8Array(256), length: 0 });

/** The bytes written so far, copied out. */
export const written = (w: Writer): Uint8Array => w.bytes.slice(0, w.length);

const reserve = (w: Writer, n: number): void => {
	const needed = w.length + n;
	if (needed <= w.bytes.length) return;

	let size = w.bytes.length;
	while (size < needed) size *= 2;

	const grown = new Uint8Array(size);
	grown.set(w.bytes.subarray(0, w.length));
	w.bytes = grown;
};

const byte = (w: Writer, b: number): void => {
	reserve(w, 1);
	w.bytes[w.length++] = b;
};

const raw = (w: Writer, b: Uint8Array): void => {
	reserve(w, b.length);
	w.bytes.set(b, w.length);
	w.length += b.length;
};

/**
 * Write a major type and its argument in the shortest form that holds it.
 *
 * Shortest-form is the whole of canonical encoding at this layer: it is why two encoders
 * agree byte for byte, and why the decoder can tell a canonical input from a padded one.
 */
export const writeHead = (w: Writer, major: number, arg: number): void => {
	const m = major << 5;

	if (arg < 24) {
		byte(w, m | arg);
	} else if (arg < 0x100) {
		reserve(w, 2);
		w.bytes[w.length++] = m | 24;
		w.bytes[w.length++] = arg;
	} else if (arg < 0x10000) {
		reserve(w, 3);
		w.bytes[w.length++] = m | 25;
		w.bytes[w.length++] = arg >>> 8;
		w.bytes[w.length++] = arg & 0xff;
	} else if (arg < 0x100000000) {
		reserve(w, 5);
		w.bytes[w.length++] = m | 26;
		w.bytes[w.length++] = (arg / 0x1000000) & 0xff;
		w.bytes[w.length++] = (arg / 0x10000) & 0xff;
		w.bytes[w.length++] = (arg / 0x100) & 0xff;
		w.bytes[w.length++] = arg & 0xff;
	} else {
		const hi = Math.floor(arg / 0x100000000);
		const lo = arg - hi * 0x100000000;
		reserve(w, 9);
		w.bytes[w.length++] = m | 27;
		w.bytes[w.length++] = (hi / 0x1000000) & 0xff;
		w.bytes[w.length++] = (hi / 0x10000) & 0xff;
		w.bytes[w.length++] = (hi / 0x100) & 0xff;
		w.bytes[w.length++] = hi & 0xff;
		w.bytes[w.length++] = (lo / 0x1000000) & 0xff;
		w.bytes[w.length++] = (lo / 0x10000) & 0xff;
		w.bytes[w.length++] = (lo / 0x100) & 0xff;
		w.bytes[w.length++] = lo & 0xff;
	}
};

const textEncoder = new TextEncoder();

/**
 * Refuse a string the format cannot carry.
 *
 * Params:
 *   s: the string to check
 *
 * Returns: nothing. It throws or it does not.
 *
 * Throws: a CodecError with reason `lone-surrogate` for an unpaired surrogate.
 *
 * A surrogate without its pair has no UTF-8 spelling. TextEncoder substitutes U+FFFD instead
 * of failing, which would let a value change on its way through the encoder and still decode
 * cleanly. Refuse it where the caller can still see what it was. Callers that hold a string
 * before it reaches the encoder use this, so the format's rule has one implementation.
 *
 * Example:
 *   assertText('hello \u{1F600}');
 */
export const assertText = (s: string): void => {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
			if (next < 0xdc00 || next > 0xdfff) {
				throw codecError('lone-surrogate', `unpaired high surrogate at index ${i}`);
			}
			i++;
		} else if (c >= 0xdc00 && c <= 0xdfff) {
			throw codecError('lone-surrogate', `unpaired low surrogate at index ${i}`);
		}
	}
};

export const writeText = (w: Writer, s: string): void => {
	assertText(s);

	const bytes = textEncoder.encode(s);
	writeHead(w, 3, bytes.length);
	raw(w, bytes);
};

export const writeNumber = (w: Writer, n: number): void => {
	// Negative zero is not a distinct state anywhere in the model, so it is normalized here
	// rather than given an encoding that only some languages can tell apart.
	const v = Object.is(n, -0) ? 0 : n;

	if (Number.isInteger(v) && v >= MIN_INT && v <= MAX_INT) {
		if (v >= 0) writeHead(w, 0, v);
		else writeHead(w, 1, -1 - v);
		return;
	}

	if (!Number.isFinite(v)) {
		throw codecError('non-finite-float', `${String(v)} has no encoding`);
	}

	reserve(w, 9);
	w.bytes[w.length++] = 0xfb;
	const view = new DataView(w.bytes.buffer, w.bytes.byteOffset + w.length, 8);
	view.setFloat64(0, v, false);
	w.length += 8;
};

export const writeValue = (w: Writer, v: WireValue): void => {
	if (v === null) {
		byte(w, 0xf6);
		return;
	}

	switch (typeof v) {
		case 'boolean':
			byte(w, v ? 0xf5 : 0xf4);
			return;
		case 'number':
			writeNumber(w, v);
			return;
		case 'string':
			writeText(w, v);
			return;
	}

	if (v instanceof Uint8Array) {
		writeHead(w, 2, v.length);
		raw(w, v);
		return;
	}

	if (Array.isArray(v)) {
		writeHead(w, 4, v.length);
		for (const item of v) writeValue(w, item);
		return;
	}

	throw codecError('unsupported-value', `${Object.prototype.toString.call(v)} has no encoding`);
};

/**
 * Encode one value, below the level of deltas and commits.
 *
 * Params:
 *   v: anything WireValue allows
 *
 * Returns: the canonical bytes. There is one encoding per value, so two encoders that agree
 * on the format produce the same bytes for the same value.
 *
 * Throws: a CodecError for a value the format cannot carry, including undefined, a plain
 * object, a Map, a bigint and a lone surrogate in a string.
 *
 * Example:
 *   encodeValue([1, 'two', null]);
 */
export const encodeValue = (v: WireValue): Uint8Array => {
	const w = createWriter();
	writeValue(w, v);
	return written(w);
};

// --- reading ---------------------------------------------------------------------------

export interface Reader {
	readonly bytes: Uint8Array;
	offset: number;
}

export const createReader = (bytes: Uint8Array): Reader => ({ bytes, offset: 0 });

const need = (r: Reader, n: number): void => {
	if (r.offset + n > r.bytes.length) {
		throw codecError('truncated', `wanted ${n} bytes at offset ${r.offset}`);
	}
};

/**
 * Read a head argument, rejecting any form wider than the value needs.
 *
 * Params:
 *   r: the reader, positioned just past the initial byte
 *   info: the low five bits of the initial byte
 *
 * Returns: the argument, guaranteed to be an exact integer.
 */
export const readArg = (r: Reader, info: number): number => {
	if (info < 24) return info;

	if (info === 24) {
		need(r, 1);
		const v = r.bytes[r.offset++]!;
		if (v < 24) throw codecError('non-canonical-integer', `${v} fits in the initial byte`);
		return v;
	}

	if (info === 25) {
		need(r, 2);
		const v = r.bytes[r.offset]! * 0x100 + r.bytes[r.offset + 1]!;
		r.offset += 2;
		if (v < 0x100) throw codecError('non-canonical-integer', `${v} fits in one byte`);
		return v;
	}

	if (info === 26) {
		need(r, 4);
		const v =
			r.bytes[r.offset]! * 0x1000000 +
			r.bytes[r.offset + 1]! * 0x10000 +
			r.bytes[r.offset + 2]! * 0x100 +
			r.bytes[r.offset + 3]!;
		r.offset += 4;
		if (v < 0x10000) throw codecError('non-canonical-integer', `${v} fits in two bytes`);
		return v;
	}

	if (info === 27) {
		need(r, 8);
		const hi =
			r.bytes[r.offset]! * 0x1000000 +
			r.bytes[r.offset + 1]! * 0x10000 +
			r.bytes[r.offset + 2]! * 0x100 +
			r.bytes[r.offset + 3]!;
		const lo =
			r.bytes[r.offset + 4]! * 0x1000000 +
			r.bytes[r.offset + 5]! * 0x10000 +
			r.bytes[r.offset + 6]! * 0x100 +
			r.bytes[r.offset + 7]!;
		r.offset += 8;
		// Range is judged on the halves, before they are combined. Adding them first rounds an
		// argument past 2^53 down into the range and the check then passes it, so the decoder
		// would answer with a number the bytes did not say. 0x200000 is 2^53 divided by 2^32.
		if (hi > 0x200000 || (hi === 0x200000 && lo !== 0)) {
			throw codecError('integer-out-of-range', 'this is not exact and must be a float');
		}

		const v = hi * 0x100000000 + lo;
		if (v < 0x100000000) throw codecError('non-canonical-integer', `${v} fits in four bytes`);
		return v;
	}

	if (info === 31) throw codecError('indefinite-length', 'lengths are always stated');

	throw codecError('malformed-head', `additional information ${info} is reserved`);
};

const textDecoder = new TextDecoder('utf-8', { fatal: true });

export const readValue = (r: Reader, depth = 0): WireValue => {
	if (depth >= MAX_DEPTH) throw codecError('nesting-too-deep', `past ${MAX_DEPTH} levels`);

	need(r, 1);
	const initial = r.bytes[r.offset++]!;
	const major = initial >> 5;
	const info = initial & 0x1f;

	if (major === 0) return readArg(r, info);
	if (major === 1) {
		// The head carries the argument and the value is one less than its negation, so the
		// bound belongs on the argument. Building the value first rounds -(2^53 + 1) up onto
		// MIN_INT, and a check on the value then sees a number that is in range.
		const arg = readArg(r, info);
		if (arg >= MAX_INT) {
			throw codecError('integer-out-of-range', 'this is not exact and must be a float');
		}
		return -1 - arg;
	}

	if (major === 2 || major === 3) {
		const n = readArg(r, info);
		need(r, n);
		const slice = r.bytes.subarray(r.offset, r.offset + n);
		r.offset += n;

		if (major === 2) return slice.slice();

		try {
			return textDecoder.decode(slice);
		} catch {
			throw codecError('invalid-utf8', `${n} bytes do not decode`);
		}
	}

	if (major === 4) {
		const n = readArg(r, info);
		// Every item costs at least one byte, so a length beyond what is left is a lie and
		// there is no reason to allocate for it.
		if (n > r.bytes.length - r.offset) {
			throw codecError('truncated', `an array of ${n} cannot fit in the remaining bytes`);
		}

		const items: WireValue[] = [];
		for (let i = 0; i < n; i++) items.push(readValue(r, depth + 1));
		return items;
	}

	if (major === 5) throw codecError('unsupported-major', 'maps are not part of the format');
	if (major === 6) throw codecError('unsupported-major', 'tags are not part of the format');

	if (info === 20) return false;
	if (info === 21) return true;
	if (info === 22) return null;

	if (info === 27) {
		need(r, 8);
		const view = new DataView(r.bytes.buffer, r.bytes.byteOffset + r.offset, 8);
		const v = view.getFloat64(0, false);
		r.offset += 8;

		if (!Number.isFinite(v)) throw codecError('non-finite-float', `${String(v)} is not a value`);
		if (Number.isInteger(v) && v >= MIN_INT && v <= MAX_INT) {
			throw codecError('non-canonical-float', `${v} is a whole number and belongs in an integer`);
		}
		return v;
	}

	throw codecError('unsupported-simple', `simple value ${info} is not part of the format`);
};

/**
 * Decode one value, rejecting anything the encoder would not have written.
 *
 * Params:
 *   bytes: exactly one value, with nothing before or after it
 *
 * Returns: the value. Re-encoding it reproduces the bytes it was read from, for every input
 * this accepts.
 *
 * Throws: a CodecError naming the rule broken. An integer padded into a wider form, a whole
 * number written as a float, an indefinite length and a trailing byte are all refused, not
 * because they are ambiguous but because accepting them would give one value two spellings.
 *
 * Example:
 *   decodeValue(encodeValue('hi')) === 'hi';
 */
export const decodeValue = (bytes: Uint8Array): WireValue => {
	const r = createReader(bytes);
	const v = readValue(r);
	if (r.offset !== bytes.length) {
		throw codecError('trailing-bytes', `${bytes.length - r.offset} bytes follow the value`);
	}
	return v;
};
