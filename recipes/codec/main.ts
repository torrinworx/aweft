// A validator for a stored commit log, built on the encoding package alone.
//
// The job is a real one: something wrote a log of commits to disk or to a socket, and before
// trusting it you want to know that every frame in it is a commit this format could have
// produced, that reading it back gives exactly what was written, and that a log which has been
// damaged says so rather than decoding into a plausible lie.
//
// The last part is the point. Section 6 of the format says a decoder must refuse any input an
// encoder would not have produced. That is a claim about every byte string, not only the ones
// a test happens to think of, so this walks a real log byte by byte, flips each one, and holds
// the decoder to it: refuse the frame, or accept it and re-encode to exactly the bytes it was
// handed. Anything else is a second spelling for one value, and byte equality is how two
// implementations of this format agree at all.

import {
	type Commit, type Delta, type Id, type Position, type Tag, type Value,
	assertId, assertPosition, bytesFromHex, bytesToHex, compareDeltas, createId, decodeCommit,
	encodeCommit,
} from '@aweftjs/codec';
import { randomFrom } from '@aweftjs/testing';

let checks = 0;

const check = (ok: boolean, what: string): void => {
	checks += 1;
	if (!ok) {
		console.error(`FAIL: ${what}`);
		process.exit(1);
	}
};

// --- a stream to validate ----------------------------------------------------------------

// Deterministic, so a failure names a seed somebody can rerun rather than a mood. The
// generator is the shared one: a private copy here drifted from it within an hour of being
// written, and a seed that reproduces a failure under one copy reproduces nothing under
// another.
const SEED = 20260901;
const random = randomFrom(SEED);

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

/** Ids from the same seeded source, so the whole log is reproducible from the seed alone. */
const seededId = (): Id => {
	const bytes = new Uint8Array(12);
	for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
	return assertId(bytes);
};

/**
 * A tag from the same seeded source.
 *
 * Nothing in the stack mints one: the algorithm that fills a tag is open, so the width the
 * encoder enforces is the whole of what makes these bytes a tag.
 */
const seededTag = (): Tag => {
	const bytes = new Uint8Array(12);
	for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256);
	return bytes as Tag;
};

const doc = seededId();
const page = seededId();
const author = seededId();

// The real generator is not used to build the log, because a log that cannot be rebuilt from
// its seed makes a failure unreproducible. It is still what production mints ids with, so the
// two properties this program depends on are checked here rather than assumed.
const minted = createId();
check(minted.length === 12, 'a minted id is not twelve bytes');
check(bytesToHex(minted) !== bytesToHex(createId()), 'two minted ids came back the same');

const words = ['the', 'quick', 'observable', 'commits', 'a', 'delta', 'over', 'the', 'wire'];

/** A position key: non-empty, never ending in a zero byte, as section 6.6 requires. */
const position = (n: number): Position => {
	const bytes = [0x80 + (n & 0x3f)];
	if (n > 0x3f) bytes.push(0x80 + ((n >> 6) & 0x3f));
	return assertPosition(Uint8Array.from(bytes));
};

const value = (): Value => {
	const roll = random();
	if (roll < 0.4) return `${pick(words)} ${pick(words)}`;
	if (roll < 0.55) return Math.floor(random() * 2 ** 40);
	if (roll < 0.65) return random() * 1e6;
	if (roll < 0.72) return random() < 0.5;
	if (roll < 0.78) return null;
	if (roll < 0.86) return bytesFromHex('cafe' + Math.floor(random() * 0xffff).toString(16).padStart(4, '0'));
	return { edge: random() < 0.8 ? 'attach' : 'alias', kind: pick(['object', 'array', 'map'] as const), id: author };
};

const delta = (): Delta => {
	const roll = random();
	const id = pick([doc, page, author]);

	if (roll < 0.25) {
		return { type: 'remove', id, ref: { kind: 'array', key: position(Math.floor(random() * 400)) } };
	}
	if (roll < 0.5) {
		return {
			type: pick(['add', 'replace'] as const),
			id,
			ref: { kind: 'array', key: position(Math.floor(random() * 400)) },
			value: value(),
		};
	}
	if (roll < 0.75) {
		return {
			type: pick(['add', 'replace'] as const),
			id,
			ref: { kind: 'object', key: pick(words) + Math.floor(random() * 30) },
			value: value(),
		};
	}
	return {
		type: pick(['add', 'replace'] as const),
		id,
		ref: { kind: 'map', key: pick([doc, page, author]) },
		value: value(),
	};
};

/** A commit's deltas are a set, so duplicates by (id, ref) are dropped rather than ordered. */
const commit = (): Commit => {
	const deltas: Delta[] = [];
	const seen = new Set<string>();

	for (let i = 0; i < 1 + Math.floor(random() * 6); i++) {
		const d = delta();
		const key = `${bytesToHex(d.id)} ${d.ref.kind} ${typeof d.ref.key === 'string' ? d.ref.key : bytesToHex(d.ref.key)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deltas.push(d);
	}

	const out: Commit = { deltas };
	return random() < 0.3 ? { ...out, tag: seededTag() } : out;
};

// --- write the log -----------------------------------------------------------------------

const frames: Uint8Array[] = [];
for (let i = 0; i < 250; i++) frames.push(encodeCommit(commit()));

const framed: number[] = [];
for (const frame of frames) {
	// Length first, four bytes, most significant first. The commit itself says how long it is,
	// but a log wants to skip a frame it cannot read rather than lose everything after it.
	framed.push((frame.length >>> 24) & 0xff, (frame.length >>> 16) & 0xff, (frame.length >>> 8) & 0xff, frame.length & 0xff);
	for (const b of frame) framed.push(b);
}
const log = Uint8Array.from(framed);

// --- read it back ------------------------------------------------------------------------

const read = (bytes: Uint8Array): Uint8Array[] => {
	const out: Uint8Array[] = [];
	let at = 0;

	while (at < bytes.length) {
		if (at + 4 > bytes.length) throw new Error('a length ran off the end of the log');
		const n = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
		at += 4;
		if (n < 0 || at + n > bytes.length) throw new Error('a frame ran off the end of the log');
		out.push(bytes.subarray(at, at + n));
		at += n;
	}
	return out;
};

const back = read(log);
check(back.length === frames.length, `read ${back.length} frames of ${frames.length}`);

let deltaCount = 0;

for (let i = 0; i < back.length; i++) {
	const decoded = decodeCommit(back[i]!);
	deltaCount += decoded.deltas.length;

	check(bytesToHex(encodeCommit(decoded)) === bytesToHex(frames[i]!),
		`frame ${i} does not re-encode to the bytes it was read from`);

	for (let j = 1; j < decoded.deltas.length; j++) {
		check(compareDeltas(decoded.deltas[j - 1]!, decoded.deltas[j]!) < 0,
			`frame ${i} came back with its deltas out of canonical order`);
	}
}

// --- damage it ---------------------------------------------------------------------------

// Every single byte flip in the first frames, and a sample beyond them so the whole log is
// represented without the run taking longer than a proof should.
let refused = 0;
let canonical = 0;

const holdToTheRule = (frame: Uint8Array, at: number, bit: number): void => {
	const damaged = Uint8Array.from(frame);
	damaged[at] = damaged[at]! ^ bit;
	if (bytesToHex(damaged) === bytesToHex(frame)) return;

	let decoded: Commit;
	try {
		decoded = decodeCommit(damaged);
	} catch {
		refused += 1;
		return;
	}

	// Accepted. Then it has to be the one spelling of what it decoded to, or two byte strings
	// mean one commit and re-encoding cannot reproduce its own input.
	check(bytesToHex(encodeCommit(decoded)) === bytesToHex(damaged),
		`a damaged frame was accepted but is not what an encoder would have written: ${bytesToHex(damaged)}`);
	canonical += 1;
};

for (let i = 0; i < frames.length; i++) {
	const frame = frames[i]!;
	const every = i < 20;

	for (let at = 0; at < frame.length; at++) {
		if (!every && random() > 0.05) continue;
		for (const bit of [0x01, 0x20, 0x80]) holdToTheRule(frame, at, bit);
	}
}

check(refused > 0, 'no damaged frame was refused, so the checks are not running');
check(canonical > 0, 'no damaged frame was accepted, so the harder half of the rule is untested');

// --- truncation --------------------------------------------------------------------------

for (const frame of frames.slice(0, 40)) {
	for (let keep = 0; keep < frame.length; keep++) {
		let accepted = false;
		try {
			decodeCommit(frame.subarray(0, keep));
			accepted = true;
		} catch {
			// Expected: a commit states its own lengths, so a short read cannot satisfy them.
		}
		check(!accepted, `a truncated frame of ${keep} bytes was accepted as a whole commit`);
	}
}

// Trailing bytes are the same rule from the other side.
for (const frame of frames.slice(0, 40)) {
	const extended = new Uint8Array(frame.length + 1);
	extended.set(frame);
	let accepted = false;
	try {
		decodeCommit(extended);
		accepted = true;
	} catch {
		// Expected.
	}
	check(!accepted, 'a frame with a byte after the end was accepted');
}

// --- how much damage goes unnoticed ------------------------------------------------------

// The rule above says a damaged frame is refused or is canonical. It does not say a damaged
// frame is noticed, and those are not the same claim. A reader who takes the first for the
// second builds a log they believe is tamper evident. So the proof states the real number:
// flip every bit of three small commits and count how many still decode. The commits use
// fixed ids rather than the seeded stream, so the census is the same on every run and the
// README can quote it.

const A = assertId(bytesFromHex('000102030405060708090a0b'));
const B = assertId(bytesFromHex('0b0a09080706050403020100'));

const census: Commit[] = [
	{ deltas: [{ type: 'add', id: A, ref: { kind: 'object', key: 'title' }, value: 'plan' }] },
	{ deltas: [
		{ type: 'add', id: A, ref: { kind: 'object', key: 'n' }, value: 42 },
		{ type: 'add', id: A, ref: { kind: 'object', key: 'kids' }, value: { edge: 'attach', kind: 'array', id: B } },
	] },
	{ deltas: [{ type: 'replace', id: B, ref: { kind: 'array', key: assertPosition(Uint8Array.of(0x80)) }, value: 3.5 }] },
];

let unnoticed = 0;
let caught = 0;

for (const c of census) {
	const bytes = encodeCommit(c);
	for (let at = 0; at < bytes.length; at++) {
		for (let bit = 0; bit < 8; bit++) {
			const damaged = Uint8Array.from(bytes);
			damaged[at] = damaged[at]! ^ (1 << bit);
			try {
				decodeCommit(damaged);
				unnoticed += 1;
			} catch {
				caught += 1;
			}
		}
	}
}

// Exact, because the README quotes these two numbers. A change to the encoding that moves
// them is a change to what the package can and cannot promise, and it should fail here
// rather than leave the README saying something that stopped being true.
check(caught === 406 && unnoticed === 562,
	`the damage census moved: ${caught} refused and ${unnoticed} accepted, was 406 and 562`);

console.log(
	`codec proof: ${checks} checks, seed ${SEED}, ${frames.length} commits, ${deltaCount} deltas, `
	+ `${log.length} bytes of log, ${refused} damaged frames refused and ${canonical} accepted as canonical, `
	+ `${unnoticed} of ${caught + unnoticed} single-bit flips unnoticed`,
);
