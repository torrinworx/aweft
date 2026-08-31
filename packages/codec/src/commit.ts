// Deltas and commits: the shapes that cross every boundary, and their bytes.
//
// A commit is an unordered set of deltas, but bytes are ordered, so the encoder puts them in
// one stated order and the decoder refuses any other. That single rule does three jobs: two
// encoders agree byte for byte, duplicate slots become adjacent and get caught, and a
// re-encode of anything decoded reproduces the input exactly.

import {
	type CborValue, type Writer, codecError, createWriter, decodeValue, writeHead, writeValue,
	written,
} from './cbor.ts';
import { compareBytes } from './bytes.ts';
import { assertId } from './id.ts';
import { assertPosition } from './position.ts';

export type DeltaType = 'add' | 'replace' | 'remove';
export type ObservableKind = 'object' | 'array' | 'map';
export type EdgeKind = 'attach' | 'alias';

/**
 * A value that is another observable is named, never inlined.
 *
 * The edge says what this reference means. An observable has exactly one attach edge, which
 * is where it lives; every other reference to it is an alias. Aliases keep state a graph
 * without giving an observable a second home, which is what makes a single walk up the attach
 * edges the whole answer to where something sits.
 */
export interface Reference {
	readonly edge: EdgeKind;
	readonly kind: ObservableKind;
	readonly id: Uint8Array;
}

export type Value = null | boolean | number | string | Uint8Array | Reference;

/** Which slot within an observable. The kind is carried, so a receiver that has never seen
 * the observable can still tell what it is being told about. */
export type Ref =
	| { readonly kind: 'object'; readonly key: string }
	| { readonly kind: 'array'; readonly key: Uint8Array }
	| { readonly kind: 'map'; readonly key: Uint8Array };

export interface Delta {
	readonly type: DeltaType;
	readonly id: Uint8Array;
	readonly ref: Ref;
	readonly value?: Value;
}

export interface Commit {
	readonly deltas: readonly Delta[];
	readonly tag?: Uint8Array;
}

const DELTA_TYPES = ['add', 'replace', 'remove'] as const;
const KINDS = ['object', 'array', 'map'] as const;
const EDGES = ['attach', 'alias'] as const;

export const MIN_TAG_BYTES = 4;
export const MAX_TAG_BYTES = 32;

export const isReference = (v: Value): v is Reference =>
	typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && !Array.isArray(v);

// --- writing ---------------------------------------------------------------------------

const writeRef = (w: Writer, ref: Ref): void => {
	const kind = KINDS.indexOf(ref.kind);
	if (kind < 0) throw codecError('unknown-ref-kind', `${String(ref.kind)} is not an observable kind`);

	writeHead(w, 4, 2);
	writeValue(w, kind);

	if (ref.kind === 'object') {
		if (typeof ref.key !== 'string') {
			throw codecError('invalid-ref', 'an object slot is named by a string');
		}
		writeValue(w, ref.key);
		return;
	}

	if (!(ref.key instanceof Uint8Array)) {
		throw codecError('invalid-ref', `a ${ref.kind} slot is named by a byte string`);
	}
	writeValue(w, ref.kind === 'array' ? assertPosition(ref.key) : assertId(ref.key));
};

const writeFieldValue = (w: Writer, v: Value): void => {
	if (
		v === null || typeof v === 'boolean' || typeof v === 'number' ||
		typeof v === 'string' || v instanceof Uint8Array
	) {
		writeValue(w, v);
		return;
	}

	if (!isReference(v)) {
		throw codecError('inline-container', 'a value is a primitive or a reference, never a structure');
	}

	const kind = KINDS.indexOf(v.kind);
	if (kind < 0) throw codecError('unknown-ref-kind', `${String(v.kind)} is not an observable kind`);

	const edge = EDGES.indexOf(v.edge);
	if (edge < 0) throw codecError('unknown-edge-kind', `${String(v.edge)} is not an edge kind`);

	writeHead(w, 4, 3);
	writeValue(w, edge);
	writeValue(w, kind);
	writeValue(w, assertId(v.id));
};

/** The bytes a delta is ordered by: its id followed by its ref, exactly as they are written. */
const sortKey = (d: Delta): Uint8Array => {
	const w = createWriter();
	writeValue(w, assertId(d.id));
	writeRef(w, d.ref);
	return written(w);
};

const writeDelta = (w: Writer, d: Delta): void => {
	const type = DELTA_TYPES.indexOf(d.type);
	if (type < 0) throw codecError('unknown-delta-type', `${String(d.type)} is not a delta type`);

	if (d.type === 'remove') {
		if (d.value !== undefined) throw codecError('unexpected-value', 'a remove carries no value');
		writeHead(w, 4, 3);
	} else {
		if (d.value === undefined) throw codecError('missing-value', `an ${d.type} carries a value`);
		writeHead(w, 4, 4);
	}

	writeValue(w, type);
	writeValue(w, assertId(d.id));
	writeRef(w, d.ref);
	if (d.value !== undefined) writeFieldValue(w, d.value);
};

/**
 * Encode a commit.
 *
 * Params:
 *   commit: its deltas in any order, and an optional integrity tag
 *
 * Returns: the canonical bytes. Deltas are sorted here, so the same commit given in any
 * order produces the same bytes.
 *
 * Throws: a CodecError naming the rule broken, for an empty commit, a duplicated slot, a
 * malformed id, position or value, or a remove carrying a value.
 */
export const encodeCommit = (commit: Commit): Uint8Array => {
	const { deltas, tag } = commit;

	if (deltas.length === 0) throw codecError('empty-commit', 'a commit carries at least one delta');
	if (tag !== undefined && (tag.length < MIN_TAG_BYTES || tag.length > MAX_TAG_BYTES)) {
		throw codecError('invalid-tag', `a tag is ${MIN_TAG_BYTES} to ${MAX_TAG_BYTES} bytes, got ${tag.length}`);
	}

	const ordered = deltas
		.map((d) => ({ d, key: sortKey(d) }))
		.sort((a, b) => compareBytes(a.key, b.key));

	for (let i = 1; i < ordered.length; i++) {
		if (compareBytes(ordered[i - 1]!.key, ordered[i]!.key) === 0) {
			throw codecError('duplicate-slot', 'two deltas in one commit address the same slot');
		}
	}

	const w = createWriter();
	writeHead(w, 4, tag === undefined ? 1 : 2);
	writeHead(w, 4, ordered.length);
	for (const { d } of ordered) writeDelta(w, d);
	if (tag !== undefined) writeValue(w, tag);
	return written(w);
};

// --- reading ---------------------------------------------------------------------------

const readRef = (raw: CborValue | undefined): Ref => {
	if (!Array.isArray(raw) || raw.length !== 2) {
		throw codecError('invalid-ref', 'a ref is a kind and a key');
	}

	const items = raw as readonly CborValue[];
	const kindIndex = items[0];
	if (typeof kindIndex !== 'number' || KINDS[kindIndex] === undefined) {
		throw codecError('unknown-ref-kind', `${String(kindIndex)} is not an observable kind`);
	}

	const kind = KINDS[kindIndex]!;
	const key = items[1];

	if (kind === 'object') {
		if (typeof key !== 'string') throw codecError('invalid-ref', 'an object slot is named by a string');
		return { kind, key };
	}

	if (!(key instanceof Uint8Array)) {
		throw codecError('invalid-ref', `a ${kind} slot is named by a byte string`);
	}
	if (kind === 'array') return { kind, key: assertPosition(key) };
	return { kind, key: assertId(key) };
};

const readFieldValue = (raw: CborValue | undefined): Value => {
	if (Array.isArray(raw)) {
		const items = raw as readonly CborValue[];
		if (items.length !== 3) {
			throw codecError('invalid-reference', 'a reference is an edge, a kind and an id');
		}

		const edgeIndex = items[0];
		if (typeof edgeIndex !== 'number' || EDGES[edgeIndex] === undefined) {
			throw codecError('unknown-edge-kind', `${String(edgeIndex)} is not an edge kind`);
		}

		const kindIndex = items[1];
		if (typeof kindIndex !== 'number' || KINDS[kindIndex] === undefined) {
			throw codecError('unknown-ref-kind', `${String(kindIndex)} is not an observable kind`);
		}

		const id = items[2];
		if (!(id instanceof Uint8Array)) throw codecError('invalid-reference', 'a reference names an id');
		return { edge: EDGES[edgeIndex]!, kind: KINDS[kindIndex]!, id: assertId(id) };
	}

	if (raw === undefined) throw codecError('missing-value', 'the value is absent');
	return raw as Value;
};

const readDelta = (raw: CborValue | undefined): Delta => {
	if (!Array.isArray(raw)) throw codecError('invalid-delta', 'a delta is an array');

	const items = raw as readonly CborValue[];
	if (items.length < 3 || items.length > 4) {
		throw codecError('invalid-delta', 'a delta is a type, an id, a ref, and a value unless it removes');
	}

	const typeIndex = items[0];
	if (typeof typeIndex !== 'number' || DELTA_TYPES[typeIndex] === undefined) {
		throw codecError('unknown-delta-type', `${String(typeIndex)} is not a delta type`);
	}
	const type = DELTA_TYPES[typeIndex]!;

	const id = items[1];
	if (!(id instanceof Uint8Array)) throw codecError('invalid-id', 'an id is a byte string');
	assertId(id);

	const ref = readRef(items[2]);

	if (type === 'remove') {
		if (items.length !== 3) throw codecError('unexpected-value', 'a remove carries no value');
		return { type, id, ref };
	}

	if (items.length !== 4) throw codecError('missing-value', `an ${type} carries a value`);
	return { type, id, ref, value: readFieldValue(items[3]) };
};

/**
 * Decode a commit, rejecting anything the encoder would not have produced.
 *
 * Params:
 *   bytes: one commit, with nothing before or after it
 *
 * Returns: the commit, its deltas in canonical order.
 *
 * Throws: a CodecError naming the rule broken. Deltas out of canonical order are rejected
 * rather than sorted, because accepting them would mean two byte strings decode to one
 * commit and re-encoding could not reproduce the input.
 */
export const decodeCommit = (bytes: Uint8Array): Commit => {
	const top = decodeValue(bytes);
	if (!Array.isArray(top)) throw codecError('invalid-commit', 'a commit is an array');

	const parts = top as readonly CborValue[];
	if (parts.length < 1 || parts.length > 2) {
		throw codecError('invalid-commit', 'a commit is its deltas and an optional tag');
	}

	const rawDeltas = parts[0];
	if (!Array.isArray(rawDeltas)) throw codecError('invalid-commit', 'the deltas are an array');

	const list = rawDeltas as readonly CborValue[];
	if (list.length === 0) throw codecError('empty-commit', 'a commit carries at least one delta');

	const deltas = list.map(readDelta);

	let previous: Uint8Array | null = null;
	for (const d of deltas) {
		const key = sortKey(d);
		if (previous !== null) {
			const order = compareBytes(previous, key);
			if (order === 0) {
				throw codecError('duplicate-slot', 'two deltas in one commit address the same slot');
			}
			if (order > 0) {
				throw codecError('deltas-out-of-order', 'deltas are written smallest id and ref first');
			}
		}
		previous = key;
	}

	if (parts.length === 1) return { deltas };

	const tag = parts[1];
	if (!(tag instanceof Uint8Array)) throw codecError('invalid-tag', 'a tag is a byte string');
	if (tag.length < MIN_TAG_BYTES || tag.length > MAX_TAG_BYTES) {
		throw codecError('invalid-tag', `a tag is ${MIN_TAG_BYTES} to ${MAX_TAG_BYTES} bytes, got ${tag.length}`);
	}
	return { deltas, tag };
};
