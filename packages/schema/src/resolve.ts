// The document a commit leaves, read without applying it.
//
// A delta names an observable by id and says nothing about where it sits, so answering "what
// does the shape say here" starts with a walk to the root. Both ends of that walk have to give
// one answer whether the commit has already landed or not, because `check` is called at a
// boundary before anything applies and from inside a guard after everything has. So the
// commit is laid over what the document says now: the edges it adds, the edges it takes away,
// and the values it writes. Laying a commit over a document that already has it is the same
// document, which is what makes the two calls agree.
//
// The document is read through core's `byId` and `pathOf`, one observable at a time and only
// the ones the commit touches, so a check costs the commit and never the document.

import {
	type Commit, type EdgeKind, type ObservableKind,
	bytesToHex, idToText, isReference, slotKeyOf,
} from '@aweftjs/codec';
import { byId, isObservable, kindOf, parentOf, pathOf, positionsOf, textIdOf } from '@aweftjs/core';
import type { ObservableMap, Primitive } from '@aweftjs/core';

/** A slot holding another observable: which one, and whether this slot is where it lives. */
export interface Named {
	readonly id: string;
	readonly kind: ObservableKind;
	readonly edge: EdgeKind;
}

/** What a slot holds: a value, or the name of another observable. */
export type Held = Primitive | Named;

/** A slot that is not a primitive names an observable. */
export const isNamed = (held: Held): held is Named =>
	held !== null && typeof held === 'object' && !(held instanceof Uint8Array);

/** What the document says once the commit has landed. */
export interface Landing {
	/** The path from the root, or undefined when nothing attaches this observable any more. */
	path(id: string): readonly string[] | undefined;
	/** Which of the three kinds an observable is, as far as the document and commit say. */
	kind(id: string): ObservableKind | undefined;
	/** What one slot holds. */
	held(id: string, slot: string): Held | undefined;
	/** Every slot an observable holds, in no particular order. */
	slots(id: string): readonly string[];
}

const REMOVED = Symbol('removed');

/** What a live slot holds, named the way a delta would name it. */
const heldOf = (holder: object, slot: string, value: unknown): Held => {
	if (!isObservable(value)) return value as Primitive;
	const child = value as object;
	// The one attach edge is the slot the child's own path ends at, in this holder. Anything
	// else that points at the child is an alias.
	const attached = parentOf(child) === holder && pathOf(child)?.at(-1) === slot;
	return { id: textIdOf(child), kind: kindOf(child), edge: attached ? 'attach' : 'alias' };
};

/** Every slot of a live observable, spelled the way the format spells it. */
const rowsOf = (observable: object): Map<string, Held> => {
	const rows = new Map<string, Held>();
	const kind = kindOf(observable);

	if (kind === 'object') {
		const record = observable as Record<string, unknown>;
		for (const key of Object.keys(record)) rows.set(key, heldOf(observable, key, record[key]));
	} else if (kind === 'array') {
		const list = observable as unknown[];
		positionsOf(observable).forEach((position, i) => {
			const slot = bytesToHex(position);
			rows.set(slot, heldOf(observable, slot, list[i]));
		});
	} else {
		for (const [key, value] of (observable as ObservableMap<unknown>).entries()) {
			rows.set(key, heldOf(observable, key, value));
		}
	}
	return rows;
};

export const landing = (document: unknown, commit: Commit): Landing => {
	const kinds = new Map<string, ObservableKind>();
	/** Where the commit attaches an observable: the edge it will have once landed. */
	const attaches = new Map<string, { readonly holder: string; readonly slot: string }>();
	const written = new Map<string, Map<string, Held | typeof REMOVED>>();

	for (const delta of commit.deltas) {
		const id = idToText(delta.id);
		const slot = slotKeyOf(delta.ref);
		if (!kinds.has(id)) kinds.set(id, delta.ref.kind);

		const value = delta.value;
		const held: Held | typeof REMOVED = value === undefined || delta.type === 'remove'
			? REMOVED
			: isReference(value)
				? { id: idToText(value.id), kind: value.kind, edge: value.edge }
				: value;

		const rows = written.get(id);
		if (rows === undefined) written.set(id, new Map([[slot, held]]));
		else rows.set(slot, held);

		if (held !== REMOVED && isNamed(held) && held.edge === 'attach') {
			kinds.set(held.id, held.kind);
			attaches.set(held.id, { holder: id, slot });
		}
	}

	const live = new Map<string, object | undefined>();
	const find = (id: string): object | undefined => {
		if (!live.has(id)) live.set(id, byId(document, id));
		return live.get(id);
	};

	const rows = new Map<string, Map<string, Held>>();
	const rowsFor = (id: string): Map<string, Held> => {
		let known = rows.get(id);
		if (known === undefined) {
			const observable = find(id);
			known = observable === undefined ? new Map() : rowsOf(observable);
			rows.set(id, known);
		}
		return known;
	};

	const paths = new Map<string, readonly string[] | undefined>();

	const path = (id: string): readonly string[] | undefined => {
		if (paths.has(id)) return paths.get(id);
		// Recorded before the walk up, so a ring of attach edges answers undefined instead of
		// running until the stack does.
		paths.set(id, undefined);

		let answer: readonly string[] | undefined;
		const home = attaches.get(id);
		if (home !== undefined) {
			const above = path(home.holder);
			answer = above === undefined ? undefined : [...above, home.slot];
		} else {
			answer = livePath(id);
		}

		paths.set(id, answer);
		return answer;
	};

	/** The path the document gives an observable the commit does not attach, minus any edge the commit takes away. */
	const livePath = (id: string): readonly string[] | undefined => {
		const observable = find(id);
		if (observable === undefined) return undefined;

		const holder = parentOf(observable);
		if (holder === undefined) return pathOf(observable)?.length === 0 ? [] : undefined;

		const holderId = textIdOf(holder);
		const slot = pathOf(observable)?.at(-1);
		// Whatever the commit wrote over this slot, the edge that was here is gone.
		if (slot === undefined || written.get(holderId)?.has(slot)) return undefined;

		const above = path(holderId);
		return above === undefined ? undefined : [...above, slot];
	};

	return {
		path,
		kind: (id) => {
			const known = kinds.get(id);
			if (known !== undefined) return known;
			const observable = find(id);
			return observable === undefined ? undefined : kindOf(observable);
		},
		held: (id, slot) => {
			const wrote = written.get(id)?.get(slot);
			if (wrote === REMOVED) return undefined;
			if (wrote !== undefined) return wrote;
			return rowsFor(id).get(slot);
		},
		slots: (id) => {
			const out = new Set(rowsFor(id).keys());
			for (const [slot, value] of written.get(id) ?? []) {
				if (value === REMOVED) out.delete(slot);
				else out.add(slot);
			}
			return [...out];
		},
	};
};
