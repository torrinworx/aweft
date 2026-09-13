// The first bytes of the types the battery can tell apart (design 262).
//
// The declared type is the sender's word; the bytes are what a browser will draw. A type in this
// table must match its bytes, and a type outside it is kept as declared, because `nosniff` and
// the `sandbox` policy on the way out are what keep a mistyped file from becoming a script.

type Matcher = (head: Uint8Array) => boolean;

const ascii = (head: Uint8Array, at: number, text: string): boolean => {
	if (head.byteLength < at + text.length) return false;
	for (let i = 0; i < text.length; i += 1) if (head[at + i] !== text.charCodeAt(i)) return false;
	return true;
};

const bytes = (head: Uint8Array, at: number, ...expected: number[]): boolean => {
	if (head.byteLength < at + expected.length) return false;
	return expected.every((byte, i) => head[at + i] === byte);
};

const riff = (tag: string): Matcher => (head) => ascii(head, 0, 'RIFF') && ascii(head, 8, tag);
const ftyp: Matcher = (head) => ascii(head, 4, 'ftyp');
const ebml: Matcher = (head) => bytes(head, 0, 0x1a, 0x45, 0xdf, 0xa3);
const ogg: Matcher = (head) => ascii(head, 0, 'OggS');
// An ID3 tag, or a frame sync (eleven set bits) with an MPEG-1 or MPEG-2 layer that is not reserved.
const mpeg: Matcher = (head) => ascii(head, 0, 'ID3')
	|| (head.byteLength >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && (head[1]! & 0x06) !== 0);

const TABLE: Readonly<Record<string, Matcher>> = {
	'image/png': (head) => bytes(head, 0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
	'image/jpeg': (head) => bytes(head, 0, 0xff, 0xd8, 0xff),
	'image/gif': (head) => ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a'),
	'image/webp': riff('WEBP'),
	'application/pdf': (head) => ascii(head, 0, '%PDF'),
	'video/mp4': ftyp,
	'audio/mp4': ftyp,
	'video/quicktime': ftyp,
	'video/webm': ebml,
	'audio/webm': ebml,
	'video/ogg': ogg,
	'audio/ogg': ogg,
	'audio/mpeg': mpeg,
	'audio/wav': riff('WAVE'),
	'audio/x-wav': riff('WAVE'),
	'audio/wave': riff('WAVE'),
	'audio/flac': (head) => ascii(head, 0, 'fLaC'),
};

/** How many leading bytes a match needs at most. */
export const SNIFF_BYTES = 12;

/**
 * Whether these first bytes can be the declared type.
 *
 * Params:
 *   type: the declared type, parameters already dropped
 *   head: the first bytes, `SNIFF_BYTES` of them or fewer when the file is shorter
 *
 * Returns: false only when the table knows the type and the bytes are not it. A type the table
 * does not know is true.
 *
 * Example:
 *   matches('image/png', head);   // false for an HTML file declared as a png
 */
export const matches = (type: string, head: Uint8Array): boolean => {
	const matcher = TABLE[type];
	return matcher === undefined ? true : matcher(head);
};
