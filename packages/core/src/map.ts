// The map observable: keyed by identity, no order.
//
// A map slot is named by an id, which is what makes it the collection to reach for when what
// matters is which thing an entry is about rather than where it sits. Ids cannot collide with
// a method name, so unlike an object this one carries methods.

import { codecError, idFromText, idToText } from '@aweftjs/codec';

import type { Node } from './types.ts';
import { createNode, plantCell, userValue } from './node.ts';
import { write } from './transaction.ts';
import { nodeOf, register, toCell } from './value.ts';

/** A map key in its text form, whether it arrived as bytes, as text, or as an observable. */
const keyOf = (key: unknown): string => {
	if (key instanceof Uint8Array) return idToText(key);

	if (typeof key === 'string') {
		idFromText(key);
		return key;
	}

	const node = nodeOf(key);
	if (node !== undefined) return node.key;

	throw codecError('invalid-key', 'a map slot is named by an id');
};

/**
 * Make a map observable.
 *
 * Params:
 *   entries: the entries it starts with, as pairs of id and value
 *   id: its id, when it has to be a particular one. Minted otherwise
 *
 * Returns: a map of ids to values. `add` files an observable under its own id, which is the
 * common case; `set` names the id itself.
 *
 * Example:
 *   const presence = createMap();
 *   presence.add(createObject({ cursor: 42 }));
 */
export const createMap = (entries?: Iterable<readonly [unknown, unknown]>, id?: Uint8Array) => {
	const node: Node = createNode('map', id);

	const map = {
		get: (key: unknown): unknown => userValue(node.slots.get(keyOf(key))),

		has: (key: unknown): boolean => node.slots.has(keyOf(key)),

		set: (key: unknown, value: unknown): void => {
			write(node, keyOf(key), toCell(value));
		},

		/** File an observable under its own id. */
		add: (observable: object): void => {
			const held = nodeOf(observable);
			if (held === undefined) throw codecError('not-observable', 'add takes an observable');
			write(node, held.key, toCell(observable));
		},

		delete: (key: unknown): boolean => {
			const slot = keyOf(key);
			if (!node.slots.has(slot)) return false;
			write(node, slot, undefined);
			return true;
		},

		get size(): number {
			return node.slots.size;
		},

		keys: (): string[] => [...node.slots.keys()],

		values: (): unknown[] => [...node.slots.values()].map(userValue),

		entries: function* (): Generator<[string, unknown]> {
			for (const [slot, cell] of node.slots) yield [slot, userValue(cell)];
		},

		[Symbol.iterator]: function* (): Generator<[string, unknown]> {
			for (const [slot, cell] of node.slots) yield [slot, userValue(cell)];
		},
	};

	register(map, node);

	if (entries !== undefined) {
		for (const [key, value] of entries) plantCell(node, keyOf(key), toCell(value));
	}

	return map;
};
