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

import {
	type DocumentJson, type ValueJson, applyCommit, canonicalJson, slotKey, valueFromJson,
	valueToJson,
} from './document.ts';

export interface RefJson {
	readonly kind: ObservableKind;
	readonly key: string;
}

export interface DeltaJson {
	readonly type: DeltaType;
	readonly id: string;
	readonly ref: RefJson;
	readonly value?: ValueJson;
}

export interface CommitJson {
	readonly bytes: string;
	readonly deltas: readonly DeltaJson[];
	readonly tag?: string;
}

export interface Fixture {
	readonly name: string;
	readonly description: string;
	readonly initial: DocumentJson;
	readonly commits: readonly CommitJson[];
	readonly final: DocumentJson;
}

export interface InvalidFixture {
	readonly name: string;
	readonly description: string;
	readonly stage: 'decode' | 'apply';
	readonly reason: string;
	readonly bytes: string;
	readonly initial?: DocumentJson;
}

export const refToJson = (ref: Ref): RefJson => ({ kind: ref.kind, key: slotKey(ref) });

export const refFromJson = (r: RefJson): Ref => {
	if (r.kind === 'object') return { kind: 'object', key: r.key };
	if (r.kind === 'array') return { kind: 'array', key: bytesFromHex(r.key) };
	return { kind: 'map', key: idFromText(r.key) };
};

export const deltaToJson = (d: Delta): DeltaJson => {
	const base = { type: d.type, id: idToText(d.id), ref: refToJson(d.ref) };
	return d.value === undefined ? base : { ...base, value: valueToJson(d.value) };
};

export const deltaFromJson = (d: DeltaJson): Delta => {
	const base = { type: d.type, id: idFromText(d.id), ref: refFromJson(d.ref) };
	return d.value === undefined ? base : { ...base, value: valueFromJson(d.value) };
};

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

export const shuffle = <T>(items: readonly T[], seed: number): T[] => {
	let s = seed;
	const out = [...items];

	for (let i = out.length - 1; i > 0; i--) {
		s ^= s << 13; s >>>= 0;
		s ^= s >> 17;
		s ^= s << 5; s >>>= 0;
		const j = s % (i + 1);
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

		const reordered = bytesToHex(encodeCommit(withTag(shuffle(decoded.deltas, seed), decoded.tag)));
		if (reordered !== c.bytes) fail(f.name, 'the order deltas arrive in changed the bytes', reordered, c.bytes);
	}

	const orders: ReadonlyArray<readonly [string, (d: readonly Delta[]) => readonly Delta[]]> = [
		['as generated', (d) => d],
		['shuffled', (d) => shuffle(d, seed)],
		['reversed', (d) => [...d].reverse()],
	];

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
