// What may go in a slot, and how a written value becomes one.
//
// The format allows a primitive or a reference to another observable, and nothing else
// (design 007). So this is where a plain object handed to a slot is refused rather than
// quietly copied: a copy would look like it worked, and then never report a change.

import { codecError } from '@aweftjs/codec';

import type { Cell, Node } from './types.ts';

const nodes = new WeakMap<object, Node>();

/** Tie a proxy to the node behind it. The proxy is the only handle a user ever holds. */
export const register = (proxy: object, node: Node): void => {
	node.proxy = proxy;
	nodes.set(proxy, node);
};

export const nodeOf = (value: unknown): Node | undefined =>
	typeof value === 'object' && value !== null ? nodes.get(value) : undefined;

/**
 * Is this an observable?
 *
 * Params:
 *   value: anything
 *
 * Returns: true for an object, array or map made by this library.
 */
export const isObservable = (value: unknown): boolean => nodeOf(value) !== undefined;

const ALIAS = Symbol('aweft.alias');

interface Alias {
	readonly [ALIAS]: Node;
}

/**
 * Name an observable without giving it a home.
 *
 * Params:
 *   observable: the observable to name
 *
 * Returns: a marker to assign. The slot then holds an alias edge, which grants nothing and
 * revokes nothing. Every observable lives at exactly one attach edge, and an alias is not it.
 *
 * Example:
 *   post.author = alias(users.get(id));
 */
export const alias = (observable: object): object => {
	const node = nodeOf(observable);
	if (node === undefined) throw codecError('not-observable', 'an alias names an observable');
	return { [ALIAS]: node };
};

const aliased = (value: object): Node | undefined => (value as Partial<Alias>)[ALIAS];

/**
 * Turn a written value into a cell, refusing anything the format cannot carry.
 *
 * A plain object or array is refused rather than converted. Converting would hand back a copy
 * that looks live and reports nothing, and finding that out costs far more than being told
 * here to write `createObject`.
 */
export const toCell = (value: unknown): Cell => {
	if (value === null) return { kind: 'value', value };

	switch (typeof value) {
		case 'boolean':
		case 'string':
			return { kind: 'value', value };
		case 'number':
			if (!Number.isFinite(value)) {
				throw codecError('invalid-number', `${String(value)} has no encoding in this format`);
			}
			return { kind: 'value', value };
		case 'undefined':
			throw codecError('invalid-value', 'a slot holds a value or does not exist; delete it instead');
		case 'object':
			break;
		default:
			throw codecError('invalid-value', `a ${typeof value} cannot be stored`);
	}

	const object = value as object;
	if (object instanceof Uint8Array) return { kind: 'value', value: object };

	const named = aliased(object);
	if (named !== undefined) return { kind: 'ref', node: named, edge: 'alias' };

	const node = nodes.get(object);
	if (node !== undefined) return { kind: 'ref', node, edge: 'attach' };

	throw codecError(
		'inline-container',
		'a slot holds a primitive or an observable; wrap it with createObject, createArray or createMap',
	);
};
