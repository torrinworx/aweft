// The object observable: string keys, no order.
//
// Every property belongs to the user. There is no method, no reserved key and no escape
// hatch on the proxy, because a document with a field called `watch` is ordinary and the
// framework taking that name would break it (design 013). Everything core offers is a free
// function that takes the observable.

import { codecError } from '@aweftjs/codec';

import { createNode, plantCell, userValue } from './node.ts';
import { write } from './transaction.ts';
import { register, toCell } from './value.ts';

const reject = (key: symbol): never => {
	throw codecError('invalid-key', `a slot is named by a string, and ${String(key)} is a symbol`);
};

/**
 * Make an object observable.
 *
 * Params:
 *   init: the slots it starts with. Values are primitives or other observables; a plain
 *         object is refused rather than copied
 *   id: its id, when it has to be a particular one. Minted otherwise. The one common case
 *       is a replica, which starts from the source root's id: see `apply`
 *
 * Returns: a proxy whose properties are its slots. Assigning one is a commit; so is deleting
 * one. Reading gives the primitive, or the observable the slot names.
 *
 * Example:
 *   const doc = createObject({ title: 'notes', blocks: createArray([]) });
 *   doc.title = 'aweft';
 */
export const createObject = <T extends object = Record<string, unknown>>(
	init?: Readonly<Partial<T>>,
	id?: Uint8Array,
): T => {
	const node = createNode('object', id);

	const proxy = new Proxy({} as T, {
		get: (_target, key) => (typeof key === 'symbol' ? undefined : userValue(node.slots.get(key))),

		set: (_target, key, value) => {
			if (typeof key === 'symbol') reject(key);
			write(node, key as string, toCell(value));
			return true;
		},

		deleteProperty: (_target, key) => {
			if (typeof key === 'symbol') reject(key);
			write(node, key as string, undefined);
			return true;
		},

		has: (_target, key) => typeof key !== 'symbol' && node.slots.has(key),

		ownKeys: () => [...node.slots.keys()],

		getOwnPropertyDescriptor: (_target, key) => {
			if (typeof key === 'symbol' || !node.slots.has(key)) return undefined;
			return {
				value: userValue(node.slots.get(key)),
				writable: true,
				enumerable: true,
				configurable: true,
			};
		},

		defineProperty: (_target, key) => {
			throw codecError(
				'invalid-write',
				`assign ${String(key)} rather than defining it, so the change becomes a delta`,
			);
		},
	});

	register(proxy, node);

	if (init !== undefined) {
		const slots = Object.entries(init as Readonly<Record<string, unknown>>);
		for (const [key, value] of slots) plantCell(node, key, toCell(value));
	}

	return proxy;
};
