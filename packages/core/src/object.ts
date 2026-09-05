// The object observable: string keys, no order.
//
// Every property belongs to the user. There is no method, no reserved key and no escape
// hatch on the proxy, because a document with a field called `watch` is ordinary and the
// framework taking that name would break it (design 013). Everything core offers is a free
// function that takes the observable.

import { codecError } from '@aweftjs/codec';

import { createNode, plantCell, userValue } from './node.ts';
import type { Node } from './types.ts';
import { write } from './transaction.ts';
import { register, toCell } from './value.ts';

const reject = (key: symbol): never => {
	throw codecError('invalid-key', `a slot is named by a string, and ${String(key)} is a symbol`);
};

// The node rides on the proxy's own target, so every object in a document shares one handler
// instead of allocating seven closures of its own. The target is otherwise unused: a trap
// never falls through to it.
const NODE = Symbol('aweft.node');

interface Target { readonly [NODE]: Node }

const handler: ProxyHandler<Target> = {
	get: (target, key) => (typeof key === 'symbol' ? undefined : userValue(target[NODE].slots.get(key))),

	set: (target, key, value) => {
		if (typeof key === 'symbol') reject(key);
		write(target[NODE], key as string, toCell(value));
		return true;
	},

	deleteProperty: (target, key) => {
		if (typeof key === 'symbol') reject(key);
		write(target[NODE], key as string, undefined);
		return true;
	},

	has: (target, key) => typeof key !== 'symbol' && target[NODE].slots.has(key),

	ownKeys: (target) => [...target[NODE].slots.keys()],

	getOwnPropertyDescriptor: (target, key) => {
		if (typeof key === 'symbol' || !target[NODE].slots.has(key)) return undefined;
		return {
			value: userValue(target[NODE].slots.get(key)),
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
 * Construction is not a commit: the slots in `init` exist before anything can watch, so a
 * replica wired afterwards never hears about them. A document that will replicate starts
 * empty and assigns its slots once the watcher is wired, or hands the receiver
 * `fromSnapshot(snapshot(doc))` as its starting point.
 *
 * Once it is attached, taking it back out leaves it readable but no longer writable: a write
 * to a detached observable throws `unreachable`, because a receiver refuses the same delta.
 * `isReachable` asks before writing, rather than finding out from the throw. It also leaves
 * the document, so `byId` stops answering for it; attaching it somewhere again re-sends
 * everything it holds (design 084).
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
	const proxy = new Proxy({ [NODE]: node }, handler) as unknown as T;

	register(proxy, node);

	if (init !== undefined) {
		const slots = init as Readonly<Record<string, unknown>>;
		for (const key of Object.keys(slots)) plantCell(node, key, toCell(slots[key]));
	}

	return proxy;
};
