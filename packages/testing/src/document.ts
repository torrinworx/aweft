// A model of a document, and the one way to apply a commit to it.
//
// This is the harness's own reading of the specification, deliberately simple and slow: a
// flat map from id to observable, with no reactivity and nothing clever. It exists so a
// fixture can state a starting document and an ending one in a form a person can read and a
// port to another language can reproduce.

import {
	type Commit, type ObservableKind, type Ref, type Value,
	bytesFromHex, bytesToHex, codecError, idFromText, idToText, isReference,
} from '@aweftjs/codec';

export type ValueJson =
	| null
	| boolean
	| number
	| string
	| { readonly bytes: string }
	| { readonly ref: string; readonly kind: ObservableKind };

export interface ObservableJson {
	readonly kind: ObservableKind;
	readonly slots: Readonly<Record<string, ValueJson>>;
}

export interface DocumentJson {
	readonly root: string;
	readonly observables: Readonly<Record<string, ObservableJson>>;
}

export const valueToJson = (v: Value): ValueJson => {
	if (v instanceof Uint8Array) return { bytes: bytesToHex(v) };
	if (isReference(v)) return { ref: idToText(v.id), kind: v.kind };
	return v;
};

export const valueFromJson = (v: ValueJson): Value => {
	if (v === null || typeof v !== 'object') return v;
	if ('bytes' in v) return bytesFromHex(v.bytes);
	return { kind: v.kind, id: idFromText(v.ref) };
};

/**
 * The string a slot is filed under in the model.
 *
 * Object slots keep their key, array slots use the position in hex, and map slots use the
 * textual form of the identity. The observable's kind says which reading applies, so the
 * three never collide in practice.
 */
export const slotKey = (ref: Ref): string => {
	if (ref.kind === 'object') return ref.key;
	if (ref.kind === 'array') return bytesToHex(ref.key);
	return idToText(ref.key);
};

/**
 * Apply one commit to a document.
 *
 * Params:
 *   doc: the document before
 *   commit: the commit to apply, its deltas in any order
 *
 * Returns: a new document. The input is not modified.
 *
 * Throws: a CodecError naming the rule broken.
 *
 * Every delta is checked before any is applied, which is what makes a commit atomic: a
 * commit that would break a rule leaves the document exactly as it was, so no observer ever
 * sees the halfway state.
 */
export const applyCommit = (doc: DocumentJson, commit: Commit): DocumentJson => {
	// An observable is created by being mentioned, and every mention states its kind. That
	// is what lets the deltas of one commit be applied in any order: a delta naming a slot
	// inside an observable no one has seen yet does not have to wait for its parent.
	const kinds = new Map<string, ObservableKind>();
	for (const [id, o] of Object.entries(doc.observables)) kinds.set(id, o.kind);

	const claim = (id: string, kind: ObservableKind, where: string): void => {
		const seen = kinds.get(id);
		if (seen === undefined) {
			kinds.set(id, kind);
			return;
		}
		if (seen !== kind) {
			throw codecError('kind-conflict', `${id} is ${seen} but ${where} calls it ${kind}`);
		}
	};

	for (const d of commit.deltas) {
		claim(idToText(d.id), d.ref.kind, 'a delta');
		if (d.value !== undefined && isReference(d.value)) {
			claim(idToText(d.value.id), d.value.kind, 'a reference');
		}
	}

	const observables: Record<string, { kind: ObservableKind; slots: Record<string, ValueJson> }> = {};
	for (const [id, o] of Object.entries(doc.observables)) {
		observables[id] = { kind: o.kind, slots: { ...o.slots } };
	}
	for (const [id, kind] of kinds) {
		if (observables[id] === undefined) observables[id] = { kind, slots: {} };
	}

	for (const d of commit.deltas) {
		const target = observables[idToText(d.id)]!;
		const key = slotKey(d.ref);
		const present = Object.hasOwn(target.slots, key);

		if (d.type === 'add' && present) {
			throw codecError('slot-exists', `${idToText(d.id)} already holds ${key}`);
		}
		if (d.type !== 'add' && !present) {
			throw codecError('slot-missing', `${idToText(d.id)} does not hold ${key}`);
		}
	}

	for (const d of commit.deltas) {
		const target = observables[idToText(d.id)]!;
		const key = slotKey(d.ref);

		if (d.type === 'remove') delete target.slots[key];
		else target.slots[key] = valueToJson(d.value!);
	}

	return { root: doc.root, observables };
};

/**
 * A document as one string, with every key in a stated order.
 *
 * Two documents are the same document when these strings match. Comparing the objects
 * directly would make the order keys happen to be inserted in part of the answer, and
 * applying the same commit in two orders inserts them in two orders.
 */
export const canonicalJson = (value: unknown): string => {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
};
