// The conformance runner.
//
// A fixture states bytes, what those bytes mean, and what a document looks like before and
// after they are applied. Running one checks four things, and the second is the one that
// makes the rest hold: the bytes decode to what the fixture says, re-encoding reproduces the
// bytes exactly, handing the deltas over in a different order still reproduces them, and
// applying the commits reaches the stated document whatever order the deltas go in.

import {
	type Commit, type Delta, type DeltaType, type ObservableKind, type Ref,
	bytesFromHex, bytesToHex, decodeCommit, encodeCommit, idFromText, idToText,
} from '@aweftjs/codec';

import { randomBelow, randomFrom } from './random.ts';

import {
	type DocumentJson, type ValueJson, applyCommit, canonicalJson, slotKey, valueFromJson,
	valueToJson,
} from './document.ts';

/** A ref as plain JSON. The key is text for an object, hex for an array, an id for a map. */
export interface RefJson {
	readonly kind: ObservableKind;
	readonly key: string;
}

/** A delta as plain JSON, with `value` absent exactly when the type is remove. */
export interface DeltaJson {
	readonly type: DeltaType;
	readonly id: string;
	readonly ref: RefJson;
	readonly value?: ValueJson;
}

/** A commit as plain JSON: its bytes in hex, the deltas they carry, and an optional tag. */
export interface CommitJson {
	readonly bytes: string;
	readonly deltas: readonly DeltaJson[];
	readonly tag?: string;
}

/**
 * One conformance case: bytes, what they mean, and the document they produce.
 *
 * This is the contract an implementation in another language reads. `initial` is the document
 * before, `commits` are applied in order, `final` is the document after, and every one of them
 * is stated as plain JSON so that nothing about this repo's types is needed to consume it.
 *
 * `initial` and `final` are written by hand rather than generated, which is the point: an
 * ending document produced by the implementation under test would only say the implementation
 * agrees with itself.
 */
export interface Fixture {
	readonly name: string;
	readonly description: string;
	readonly initial: DocumentJson;
	readonly commits: readonly CommitJson[];
	readonly final: DocumentJson;
}

/**
 * One case that must be refused, and the reason it must be refused for.
 *
 * `reason` is the contract, not the message. Two implementations that both reject an input
 * for different stated reasons have not agreed on the format, they have agreed on rejecting
 * one string. `stage` says where the refusal is due: `decode` for bytes that are not a commit,
 * `apply` for a commit that is well formed and cannot be applied, which is the only case that
 * needs `initial`.
 */
export interface InvalidFixture {
	readonly name: string;
	readonly description: string;
	readonly stage: 'decode' | 'apply';
	readonly reason: string;
	readonly bytes: string;
	readonly initial?: DocumentJson;
}

/** A ref in its JSON form, and back. The pair round trips, which the fixtures depend on. */
export const refToJson = (ref: Ref): RefJson => ({ kind: ref.kind, key: slotKey(ref) });

/** The ref a JSON one names. The inverse of refToJson, and the fixtures rely on it round tripping. */
export const refFromJson = (r: RefJson): Ref => {
	if (r.kind === 'object') return { kind: 'object', key: r.key };
	if (r.kind === 'array') return { kind: 'array', key: bytesFromHex(r.key) };
	return { kind: 'map', key: idFromText(r.key) };
};

/** A delta in its JSON form, as a fixture states it. */
export const deltaToJson = (d: Delta): DeltaJson => {
	const base = { type: d.type, id: idToText(d.id), ref: refToJson(d.ref) };
	return d.value === undefined ? base : { ...base, value: valueToJson(d.value) };
};

/**
 * The delta a JSON one names.
 *
 * This is the direction that makes a fixture's bytes checkable against something outside the
 * implementation: the JSON is written by hand, so encoding it and comparing to the stated
 * bytes asks a question the decoder's own output cannot answer.
 */
export const deltaFromJson = (d: DeltaJson): Delta => {
	const base = { type: d.type, id: idFromText(d.id), ref: refFromJson(d.ref) };
	return d.value === undefined ? base : { ...base, value: valueFromJson(d.value) };
};

/** A commit and its bytes in the shape a fixture states them, for comparing against one. */
export const commitToJson = (commit: Commit, bytes: Uint8Array): CommitJson => {
	const base = { bytes: bytesToHex(bytes), deltas: commit.deltas.map(deltaToJson) };
	return commit.tag === undefined ? base : { ...base, tag: bytesToHex(commit.tag) };
};

const withTag = (deltas: readonly Delta[], tag: Uint8Array | undefined): Commit =>
	tag === undefined ? { deltas } : { deltas, tag };

/**
 * One reading of the format, as a function.
 *
 * The suite is the same for every implementation, and there is more than one: a model that
 * stores plain data, and a real reactive tree. Both must reach the same document from the same
 * bytes, which is the point of running the fixtures twice.
 *
 * Params:
 *   initial: the document to start from
 *   commits: the commits to apply, in order, each whole
 *
 * Returns: the document reached. Throws with a stated `reason` when a commit is refused.
 */
export type Applier = (initial: DocumentJson, commits: readonly Commit[]) => DocumentJson;

/** The harness's own reading of the specification: plain data, no reactivity. */
export const modelApplier: Applier = (initial, commits) =>
	commits.reduce<DocumentJson>(applyCommit, initial);

/** A seed derived from the fixture name, so a failing shuffle is the same one next run. */
export const seedFrom = (text: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h || 1;
};

/**
 * Reorder deterministically, from a seed.
 *
 * Params:
 *   items: what to reorder
 *   seed: the same seed always gives the same order
 *
 * Returns: a new array. Used to check that the order deltas arrive in changes nothing, so it
 * has to be repeatable: a failure that cannot be run again is a rumour.
 *
 * A shuffle can legitimately come back in the order it went in, so it is never the only
 * reordering a check tries.
 */
export const shuffle = <T>(items: readonly T[], seed: number): T[] => {
	const random = randomFrom(seed);
	const out = [...items];

	for (let i = out.length - 1; i > 0; i--) {
		const j = randomBelow(random, i + 1);
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
};

const fail = (name: string, check: string, actual: unknown, expected: unknown): never => {
	throw new Error(
		`${name}: ${check}\n  actual   ${canonicalJson(actual)}\n  expected ${canonicalJson(expected)}`,
	);
};

/**
 * Run one fixture.
 *
 * Params:
 *   f: the fixture, already parsed
 *
 * Throws: an Error naming the fixture and the check that failed. Returns nothing on success.
 */
export const checkFixture = (f: Fixture, applier: Applier = modelApplier): void => {
	const seed = seedFrom(f.name);

	// One shuffle is not a reordering test. Seeded from the fixture name it is the identity
	// permutation for 7 of the 17 commits in the suite, and for those the check silently
	// repeated the plain re-encode above it. Reversed is a real reorder for anything longer
	// than one delta, so the same three orders drive the encode check and the apply check.
	const orders: ReadonlyArray<readonly [string, (d: readonly Delta[]) => readonly Delta[]]> = [
		['as generated', (d) => d],
		['shuffled', (d) => shuffle(d, seed)],
		['reversed', (d) => [...d].reverse()],
	];

	for (const c of f.commits) {
		const bytes = bytesFromHex(c.bytes);
		const decoded = decodeCommit(bytes);

		const stated: CommitJson = c.tag === undefined
			? { bytes: c.bytes, deltas: c.deltas }
			: { bytes: c.bytes, deltas: c.deltas, tag: c.tag };
		const actual = commitToJson(decoded, bytes);

		if (canonicalJson(actual) !== canonicalJson(stated)) {
			fail(f.name, 'the bytes do not mean what the fixture says', actual, stated);
		}

		const again = bytesToHex(encodeCommit(decoded));
		if (again !== c.bytes) fail(f.name, 're-encoding is not byte equal', again, c.bytes);

		// The other direction, and the one that is not circular. Above, the deltas came out of
		// the decoder, so re-encoding them asks the package whether it agrees with itself.
		// These are built from the JSON the fixture states, which a person wrote and can edit,
		// so the bytes are checked against something outside the implementation.
		const fromStated = withTag(c.deltas.map(deltaFromJson), c.tag === undefined ? undefined : bytesFromHex(c.tag));
		const encoded = bytesToHex(encodeCommit(fromStated));
		if (encoded !== c.bytes) {
			fail(f.name, 'the stated deltas do not encode to the stated bytes', encoded, c.bytes);
		}

		for (const [label, reorder] of orders) {
			const reordered = bytesToHex(encodeCommit(withTag(reorder(decoded.deltas), decoded.tag)));
			if (reordered !== c.bytes) {
				fail(f.name, `handing the deltas over ${label} changed the bytes`, reordered, c.bytes);
			}
		}
	}

	for (const [label, reorder] of orders) {
		const commits = f.commits.map((c) => {
			const decoded = decodeCommit(bytesFromHex(c.bytes));
			return withTag(reorder(decoded.deltas), decoded.tag);
		});

		const reached = applier(f.initial, commits);
		if (canonicalJson(reached) !== canonicalJson(f.final)) {
			fail(f.name, `applying the deltas ${label} did not reach the stated document`, reached, f.final);
		}
	}
};

/**
 * Run one rejection fixture.
 *
 * Params:
 *   f: the fixture. `stage` says whether the bytes must be refused when decoded, or decode
 *      cleanly and be refused when applied to `initial`.
 *
 * Throws: an Error if the input was accepted, or refused for a different stated reason than
 * the fixture names. Rejecting for the wrong reason counts as a failure: a format whose
 * implementations disagree about why something is invalid has not been specified.
 */
export const checkInvalidFixture = (f: InvalidFixture, applier: Applier = modelApplier): void => {
	const attempt = (): void => {
		const commit = decodeCommit(bytesFromHex(f.bytes));
		if (f.stage === 'decode') return;
		if (f.initial === undefined) {
			throw new Error(`${f.name}: an apply-stage fixture must state an initial document`);
		}
		applier(f.initial, [commit]);
	};

	let error: { reason?: string; message?: string } | undefined;
	try {
		attempt();
	} catch (e) {
		error = e as { reason?: string; message?: string };
	}

	if (error === undefined) {
		throw new Error(`${f.name}: accepted, but must be refused as ${f.reason}`);
	}
	if (error.reason !== f.reason) {
		throw new Error(
			`${f.name}: refused as ${String(error.reason)}, expected ${f.reason}\n  ${String(error.message)}`,
		);
	}
};
