// Deltas and commits: the shapes that cross every boundary, and their bytes.
//
// A commit is an unordered set of deltas, but bytes are ordered, so the encoder puts them in
// one stated order and the decoder refuses any other. That single rule does three jobs: two
// encoders agree byte for byte, duplicate slots become adjacent and get caught, and a
// re-encode of anything decoded reproduces the input exactly.

import {
	type WireValue, type Writer, codecError, createWriter, decodeValue, writeHead, writeValue,
	written,
} from './wire.ts';
import { compareBytes } from './bytes.ts';
import { assertId } from './id.ts';
import { assertPosition } from './position.ts';

/**
 * What a delta does to the slot it names.
 *
 * The same three words JSON Patch uses, deliberately: the format is specified for other
 * languages to implement, and an implementer reading `replace` already knows the semantics.
 * `add` needs the slot free, `replace` and `remove` need it taken. That rule binds whoever
 * applies the commit to a document: an applier refuses a commit that gets it wrong rather
 * than reconciling it. The encoder cannot check it, because it holds no state across
 * commits; the only slot rule enforced here is that one commit never targets a slot twice.
 */
export type DeltaType = 'add' | 'replace' | 'remove';

/** Which of the three kinds an observable is. It is fixed when the observable is made. */
export type ObservableKind = 'object' | 'array' | 'map';

/**
 * What a reference to an observable means.
 *
 * `attach` is where the observable lives, and it has exactly one. `alias` names it from
 * somewhere else and moves nothing.
 */
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

/**
 * Everything a slot can hold: a primitive, or the name of another observable.
 *
 * There is no structure here on purpose. A structure inlined into a slot would be state that
 * changes with no delta addressing it, and every change to state is a delta.
 */
export type Value = null | boolean | number | string | Uint8Array | Reference;

/** Which slot within an observable. The kind is carried, so a receiver that has never seen
 * the observable can still tell what it is being told about. */
export type Ref =
	| { readonly kind: 'object'; readonly key: string }
	| { readonly kind: 'array'; readonly key: Uint8Array }
	| { readonly kind: 'map'; readonly key: Uint8Array };

/**
 * One change to one slot.
 *
 * The target is `id` plus `ref` and never a path, so a delta means the same thing whatever
 * else moved in the same commit. `value` is absent exactly when the type is `remove`:
 * absent as in the key is omitted, not present holding undefined, and a decoded delta
 * reads the same way.
 */
export interface Delta {
	readonly type: DeltaType;
	readonly id: Uint8Array;
	readonly ref: Ref;
	readonly value?: Value;
}

/**
 * The unit that crosses every boundary.
 *
 * A commit applies whole or not at all, and it carries at least one delta. Its deltas are a
 * set, written in the canonical order of section 6.9, and a receiver replaying them one at a
 * time would pass through states the sender never had.
 *
 * `tag` is 4 to 32 bytes and is not a checksum of these bytes. It is a digest over the prior
 * values of the slots this commit addresses, computed by the sender against its own state
 * before the commit, and it answers whether the commit landed on the state the sender
 * expected. A receiver computing a different tag treats the replicas as diverged and
 * resynchronizes. The algorithm that fills it is still open, so nothing here computes one.
 */
export interface Commit {
	readonly deltas: readonly Delta[];
	readonly tag?: Uint8Array;
}

const DELTA_TYPES = ['add', 'replace', 'remove'] as const;
const KINDS = ['object', 'array', 'map'] as const;
const EDGES = ['attach', 'alias'] as const;

/** The narrowest and widest a commit tag may be. Section 3.3; the algorithm is open. */
export const MIN_TAG_BYTES = 4;
export const MAX_TAG_BYTES = 32;

/**
 * Is this value a reference to an observable rather than a primitive?
 *
 * Params:
 *   v: any value the format can carry
 *
 * Returns: true only for the three field shape a reference has. Narrowing on "an object that
 * is not bytes and not an array" would answer true for a plain object too, and the caller
 * then fails a step later complaining about the kind rather than about the structure it was
 * actually handed.
 *
 * Example:
 *   if (isReference(delta.value)) follow(delta.value.id);
 */
export const isReference = (v: Value): v is Reference =>
	typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && !Array.isArray(v)
	&& 'edge' in v && 'kind' in v && 'id' in v;

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

/**
 * Order two deltas the way section 6.9 orders them, without writing any bytes.
 *
 * Params:
 *   a, b: the deltas to compare
 *
 * Returns: -1, 0 or 1. Zero means they address the same slot, which a commit may not do.
 *
 * The rule is stated over the encoded form: the id, then the ref. This reads that order off
 * the values instead, which is the same order for a reason worth stating rather than trusting.
 * Ids are all one width, so their heads are equal and only the bytes decide. A ref's kind
 * encodes to one byte that grows with the kind. A string or byte string is written as a length
 * and then its contents, and every head grows with the length it holds, so a shorter key sorts
 * first whatever it contains. UTF-8 orders by code point, so text compares by code point.
 *
 * Example:
 *   [...deltas].sort(compareDeltas)
 */
export const compareDeltas = (a: Delta, b: Delta): number => {
	const byId = compareBytes(assertId(a.id), assertId(b.id));
	if (byId !== 0) return byId;

	const kindA = KINDS.indexOf(a.ref.kind);
	const kindB = KINDS.indexOf(b.ref.kind);
	if (kindA !== kindB) return kindA < kindB ? -1 : 1;

	if (a.ref.kind === 'object') return compareText(a.ref.key, (b.ref as { key: string }).key);

	const x = a.ref.key;
	const y = (b.ref as { key: Uint8Array }).key;
	if (x.length !== y.length) return x.length < y.length ? -1 : 1;
	return compareBytes(x, y);
};

/** How many bytes this string takes as UTF-8, counted rather than encoded. */
const utf8Length = (text: string): number => {
	let bytes = 0;

	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x80) bytes += 1;
		else if (code < 0x800) bytes += 2;
		else if (code >= 0xd800 && code < 0xdc00) { bytes += 4; i++; }
		else bytes += 3;
	}
	return bytes;
};

/** Text in the order its UTF-8 sorts: by length, then by code point. */
const compareText = (a: string, b: string): number => {
	const lengthA = utf8Length(a);
	const lengthB = utf8Length(b);
	if (lengthA !== lengthB) return lengthA < lengthB ? -1 : 1;

	// Code point, not code unit. A surrogate pair is one character above every unpaired one, and
	// comparing the string with < would put it below anything from U+E000 up.
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const x = a.codePointAt(i)!;
		const y = b.codePointAt(j)!;
		if (x !== y) return x < y ? -1 : 1;
		i += x > 0xffff ? 2 : 1;
		j += y > 0xffff ? 2 : 1;
	}
	return 0;
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
	// The type is checked as well as the length: every other field asserts at the edge, and
	// without this an encoder could write bytes its own decoder refuses.
	if (tag !== undefined && (!(tag instanceof Uint8Array)
		|| tag.length < MIN_TAG_BYTES || tag.length > MAX_TAG_BYTES)) {
		throw codecError('invalid-tag', `a tag is ${MIN_TAG_BYTES} to ${MAX_TAG_BYTES} bytes`);
	}

	const ordered = [...deltas].sort(compareDeltas);

	for (let i = 1; i < ordered.length; i++) {
		if (compareDeltas(ordered[i - 1]!, ordered[i]!) === 0) {
			throw codecError('duplicate-slot', 'two deltas in one commit address the same slot');
		}
	}

	const w = createWriter();
	writeHead(w, 4, tag === undefined ? 1 : 2);
	writeHead(w, 4, ordered.length);
	for (const d of ordered) writeDelta(w, d);
	if (tag !== undefined) writeValue(w, tag);
	return written(w);
};

// --- reading ---------------------------------------------------------------------------

const readRef = (raw: WireValue | undefined): Ref => {
	if (!Array.isArray(raw) || raw.length !== 2) {
		throw codecError('invalid-ref', 'a ref is a kind and a key');
	}

	const items = raw as readonly WireValue[];
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

const readFieldValue = (raw: WireValue | undefined): Value => {
	if (Array.isArray(raw)) {
		const items = raw as readonly WireValue[];
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

const readDelta = (raw: WireValue | undefined): Delta => {
	if (!Array.isArray(raw)) throw codecError('invalid-delta', 'a delta is an array');

	const items = raw as readonly WireValue[];
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

	const parts = top as readonly WireValue[];
	if (parts.length < 1 || parts.length > 2) {
		throw codecError('invalid-commit', 'a commit is its deltas and an optional tag');
	}

	const rawDeltas = parts[0];
	if (!Array.isArray(rawDeltas)) throw codecError('invalid-commit', 'the deltas are an array');

	const list = rawDeltas as readonly WireValue[];
	if (list.length === 0) throw codecError('empty-commit', 'a commit carries at least one delta');

	const deltas = list.map(readDelta);

	for (let i = 1; i < deltas.length; i++) {
		const order = compareDeltas(deltas[i - 1]!, deltas[i]!);
		if (order === 0) {
			throw codecError('duplicate-slot', 'two deltas in one commit address the same slot');
		}
		if (order > 0) {
			throw codecError('deltas-out-of-order', 'deltas are written smallest id and ref first');
		}
	}

	if (parts.length === 1) return { deltas };

	const tag = parts[1];
	if (!(tag instanceof Uint8Array)) throw codecError('invalid-tag', 'a tag is a byte string');
	if (tag.length < MIN_TAG_BYTES || tag.length > MAX_TAG_BYTES) {
		throw codecError('invalid-tag', `a tag is ${MIN_TAG_BYTES} to ${MAX_TAG_BYTES} bytes, got ${tag.length}`);
	}
	return { deltas, tag };
};
