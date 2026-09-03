// What may go in a slot, and how a written value becomes one.
//
// The format allows a primitive or a reference to another observable, and nothing else
// (design 007). So this is where a plain object handed to a slot is refused rather than
// quietly copied: a copy would look like it worked, and then never report a change.

import { assertValue, codecError } from '@aweftjs/codec';

import type { Cell, Node } from './types.ts';
import { sourceOf } from './derived.ts';

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
 *
 * Example:
 *   const doc = isObservable(input) ? input : createObject(input);
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
		case 'number':
			// The format's rule, not a copy of it: a value core accepts and the encoder then
			// refuses is a document that cannot be sent anywhere.
			assertValue(value);
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

	// A cell or a derived value is interface state (design 024). Refusing it here is what
	// keeps "does this replicate" answerable from the type of the thing being written.
	if (sourceOf(object) !== undefined) {
		throw codecError(
			'cell-in-document',
			'a cell or derived value does not replicate; store a primitive or an observable, or its get()',
		);
	}

	const named = aliased(object);
	if (named !== undefined) return { kind: 'ref', node: named, edge: 'alias' };

	const node = nodes.get(object);
	if (node !== undefined) return { kind: 'ref', node, edge: 'attach' };

	throw codecError(
		'inline-container',
		'a slot holds a primitive or an observable; wrap it with createObject, createArray or createMap',
	);
};
