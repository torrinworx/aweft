// Building commits by hand, so a test states what it means rather than deriving it.
//
// Ids are counted rather than generated: a failure prints `AAAAAAAAAAAAAAAB` and a reader can
// find which observable that was.

import {
	type Commit, type Delta, type DeltaType, type ObservableKind, type Value,
	idToText,
} from '@aweftjs/codec';
import { type DocumentJson, idFromText, refFromJson, valueFromJson } from '@aweftjs/testing';

/** The nth id, counting from one, in the same shape the fixtures use. */
export const id = (n: number): Uint8Array => {
	const bytes = new Uint8Array(12);
	new DataView(bytes.buffer).setUint32(8, n);
	return bytes;
};

/** The nth id in text form, which is how a path step names a map slot. */
export const key = (n: number): string => idToText(id(n));

/** A reference to the nth observable: where it lives, or just a name for it. */
export const ref = (n: number, kind: ObservableKind = 'object', edge: 'attach' | 'alias' = 'attach'): Value =>
	({ edge, kind, id: id(n) });

/** A change to an object slot. */
export const slot = (holder: number, name: string, value?: Value, type: DeltaType = 'add'): Delta =>
	value === undefined
		? { type: 'remove', id: id(holder), ref: { kind: 'object', key: name } }
		: { type, id: id(holder), ref: { kind: 'object', key: name }, value };

/** A change to a map slot, named by the identity it is filed under. */
export const entry = (holder: number, at: number, value?: Value, type: DeltaType = 'add'): Delta =>
	value === undefined
		? { type: 'remove', id: id(holder), ref: { kind: 'map', key: id(at) } }
		: { type, id: id(holder), ref: { kind: 'map', key: id(at) }, value };

/** A change to an array slot at a stated position. */
export const at = (holder: number, position: number[], value?: Value, type: DeltaType = 'add'): Delta =>
	value === undefined
		? { type: 'remove', id: id(holder), ref: { kind: 'array', key: new Uint8Array(position) } }
		: { type, id: id(holder), ref: { kind: 'array', key: new Uint8Array(position) }, value };

export const commit = (...deltas: Delta[]): Commit => ({ deltas });

/**
 * One commit that builds a whole document, for seeding an index from a starting state.
 *
 * An index is fed commits (design 034), so a document that did not arrive as commits is
 * seeded by saying it as one. This is what a caller holding a stored document does, and doing
 * it here rather than adding an entry point keeps the claim honest.
 */
export const commitFor = (document: DocumentJson): Commit => {
	const deltas: Delta[] = [];

	for (const [holder, observable] of Object.entries(document.observables)) {
		for (const [name, value] of Object.entries(observable.slots)) {
			deltas.push({
				type: 'add',
				id: idFromText(holder),
				ref: refFromJson({ kind: observable.kind, key: name }),
				value: valueFromJson(value),
			});
		}
	}

	return { deltas };
};
