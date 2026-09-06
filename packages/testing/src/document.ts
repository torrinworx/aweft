// A model of a document, and the one way to apply a commit to it.
//
// This is the harness's own reading of the specification, deliberately simple and slow: a
// flat map from id to observable, with no reactivity and nothing clever. It exists so a
// fixture can state a starting document and an ending one in a form a person can read and a
// port to another language can reproduce.

import {
	type Commit, type EdgeKind, type ObservableKind, type Ref, type Value,
	bytesFromHex, bytesToHex, codecError, idFromText, idToText, isReference, slotKeyOf,
} from '@aweftjs/codec';

/** A value as plain JSON: a primitive, `{ bytes }` for a byte string, or a reference. */
export type ValueJson =
	| null
	| boolean
	| number
	| string
	| { readonly bytes: string }
	| { readonly ref: string; readonly kind: ObservableKind; readonly edge: EdgeKind };

/** One observable as plain JSON: its kind, and its slots by key. */
export interface ObservableJson {
	readonly kind: ObservableKind;
	readonly slots: Readonly<Record<string, ValueJson>>;
}

/**
 * A whole document as plain JSON.
 *
 * Flat, keyed by id in text form, with the root named separately. Flat rather than nested
 * because an observable can be named from more than one place, and a nested spelling would
 * have to pick one of them and quietly lose the others.
 */
export interface DocumentJson {
	readonly root: string;
	readonly observables: Readonly<Record<string, ObservableJson>>;
}

/** A value in its JSON form, and back. Both directions are used, so both are exercised. */
export const valueToJson = (v: Value): ValueJson => {
	if (v instanceof Uint8Array) return { bytes: bytesToHex(v) };
	if (isReference(v)) return { ref: idToText(v.id), kind: v.kind, edge: v.edge };
	return v;
};

/** The value a JSON one names. The inverse of valueToJson. */
export const valueFromJson = (v: ValueJson): Value => {
	if (v === null || typeof v !== 'object') return v;
	if ('bytes' in v) return bytesFromHex(v.bytes);
	return { edge: v.edge, kind: v.kind, id: idFromText(v.ref) };
};

const asReference = (v: ValueJson | undefined): { ref: string; edge: EdgeKind } | null =>
	v !== null && typeof v === 'object' && 'ref' in v ? v : null;

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
			throw codecError('kind-conflict', `${id} is ${seen} but ${where} calls it ${kind}`,
				'State one kind for this id in every delta of the commit.');
		}
	};

	for (const d of commit.deltas) {
		claim(idToText(d.id), d.ref.kind, 'a delta');
		if (d.value !== undefined && isReference(d.value)) {
			claim(idToText(d.value.id), d.value.kind, 'a reference');
		}
	}

	// An observable has exactly one attach edge, which is where it lives. Counting rather
	// than checking each delta in turn keeps this independent of the order deltas arrive in,
	// which matters because a commit is a set.
	const attached = new Map<string, number>();
	const bump = (id: string, by: number): void => {
		attached.set(id, (attached.get(id) ?? 0) + by);
	};

	for (const o of Object.values(doc.observables)) {
		for (const value of Object.values(o.slots)) {
			const r = asReference(value);
			if (r && r.edge === 'attach') bump(r.ref, 1);
		}
	}

	const newEdges: Array<[string, string]> = [];

	for (const d of commit.deltas) {
		const holder = doc.observables[idToText(d.id)];
		const displaced = asReference(holder?.slots[slotKeyOf(d.ref)]);
		if (d.type !== 'add' && displaced && displaced.edge === 'attach') bump(displaced.ref, -1);

		if (d.value !== undefined && isReference(d.value) && d.value.edge === 'attach') {
			const target = idToText(d.value.id);
			bump(target, 1);
			newEdges.push([idToText(d.id), target]);
		}
	}

	for (const [id, count] of attached) {
		if (count > 1) {
			throw codecError(
				'multiple-attach',
				`${id} would have ${count} attach edges, and an observable lives in one place`,
				'Remove the other attach edge in the same commit, or point at it with a reference.',
			);
		}
	}

	// Reachability walks attach edges only, and counts the ones this commit adds. Edges the
	// commit removes are not counted, so a commit may write into a subtree in the same breath
	// as it detaches it.
	const edges = new Map<string, string[]>();
	const link = (from: string, to: string): void => {
		let list = edges.get(from);
		if (!list) edges.set(from, list = []);
		list.push(to);
	};

	for (const [id, o] of Object.entries(doc.observables)) {
		for (const value of Object.values(o.slots)) {
			const r = asReference(value);
			if (r && r.edge === 'attach') link(id, r.ref);
		}
	}
	for (const [from, to] of newEdges) link(from, to);

	const reachable = new Set([doc.root]);
	const queue = [doc.root];
	for (let head = 0; head < queue.length; head++) {
		for (const to of edges.get(queue[head]!) ?? []) {
			if (reachable.has(to)) continue;
			reachable.add(to);
			queue.push(to);
		}
	}

	for (const d of commit.deltas) {
		const id = idToText(d.id);
		if (!reachable.has(id)) {
			throw codecError('unreachable', `${id} has no attach path from the root`,
				'Attach it under the root in the same commit that writes into it.');
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
		const key = slotKeyOf(d.ref);
		const present = Object.hasOwn(target.slots, key);

		if (d.type === 'add' && present) {
			throw codecError('slot-exists', `${idToText(d.id)} already holds ${key}`,
				'Send a replace delta to overwrite the slot, or add under a free key.');
		}
		if (d.type !== 'add' && !present) {
			throw codecError('slot-missing', `${idToText(d.id)} does not hold ${key}`,
				'Send an add delta first, so the slot exists before it is replaced or removed.');
		}
	}

	for (const d of commit.deltas) {
		const target = observables[idToText(d.id)]!;
		const key = slotKeyOf(d.ref);

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
