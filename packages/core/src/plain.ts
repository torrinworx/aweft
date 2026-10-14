// Plain data in and out of a document (design 311).
//
// A slot refuses a plain object or array (`inline-container`), so data from a request, a file
// or an import is converted on the way in. The way out is a copy, never the live tree.

import { codecError } from '@aweftjs/codec';

import { createArray } from './array.ts';
import { kindOf } from './identity.ts';
import type { ObservableMap } from './map.ts';
import { createObject } from './object.ts';
import { aliased, isObservable } from './value.ts';

const isPlainObject = (value: object): boolean => {
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

const describe = (value: unknown): string => {
	if (typeof value !== 'object' || value === null) return `a ${typeof value}`;
	// A cell's class is internal, so it is named by what it is rather than what it is called.
	if (typeof (value as { effect?: unknown }).effect === 'function' && typeof (value as { get?: unknown }).get === 'function') return 'a cell';
	const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
	return typeof name === 'string' && name !== '' ? `a ${name}` : 'an object that is not plain';
};

const notPlain = (value: unknown, at: readonly string[]): Error => codecError(
	'invalid-value',
	`${at.length === 0 ? 'the value' : at.join('.')} is ${describe(value)}, which is not plain data`,
	'Convert it to plain data first, such as a Date to its ISO string.',
);

const loop = (at: readonly string[]): Error => codecError(
	'cycle',
	`${at.length === 0 ? 'the value' : at.join('.')} holds itself, through an alias or a reference`,
	'Copy the part inside the loop on its own, or remove the alias that closes it.',
);

// Each level is a frame, so a tree nested deeper than the stack runs out of room. That is said
// in the stack's own shape rather than as a bare RangeError.
const bounded = <T>(convert: () => T): T => {
	try {
		return convert();
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		throw codecError('too-deep', 'the value nests deeper than this runtime\'s stack allows',
			'Flatten the data, or convert it one subtree at a time.');
	}
};

const convertIn = (value: unknown, at: readonly string[], within: Set<object>): unknown => {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value !== 'object') throw notPlain(value, at);
	// An `alias` marker goes in as itself, so the slot holds an alias edge as `createObject` makes it.
	if (value instanceof Uint8Array || isObservable(value) || aliased(value) !== undefined) return value;
	if (!Array.isArray(value) && !isPlainObject(value)) throw notPlain(value, at);
	if (within.has(value)) throw loop(at);
	within.add(value);
	try {
		// What JSON.stringify writes for an `undefined` in a list, and for a hole in one, so the
		// two agree. `Array.from` visits a hole where `map` skips it.
		if (Array.isArray(value)) return createArray(Array.from(value, (item: unknown, index) => convertIn(item, [...at, String(index)], within) ?? null));
		// Built from entries, because an assignment to a key `__proto__`, which `JSON.parse` makes
		// an own key, would set the copy's prototype and lose the slot.
		return createObject(Object.fromEntries(Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.map(([key, item]) => [key, convertIn(item, [...at, key], within)])));
	} finally {
		within.delete(value);
	}
};

/**
 * The observable tree a document holds, built from plain data.
 *
 * Params:
 *   value: plain data, as JSON holds it: objects, arrays, strings, numbers, booleans and null,
 *          and bytes as a Uint8Array
 *
 * Returns: a plain object as `createObject`, an array as `createArray`, each value inside
 * converted the same way. A key holding `undefined` is dropped and an `undefined` or a hole in an
 * array is `null`, as `JSON.stringify` writes them. A key named `__proto__` is a slot like any
 * other. A primitive, bytes, an observable and an `alias` marker come back as they are, so part of
 * a tree that is already observable keeps its identity and an alias stays an alias.
 *
 * Throws: `invalid-value` for anything that is not plain data, a `Date`, a `Map`, a class
 * instance, a function, naming where in the value it was. `cycle` for a value that holds itself,
 * and `too-deep` for one nested deeper than the runtime's stack.
 *
 * Example:
 *   const doc = await store.open('import:1');
 *   doc.root.rows = fromPlain(JSON.parse(text).rows);
 */
export const fromPlain = <T>(value: T): T => bounded(() => convertIn(value, [], new Set()) as T);

const convertOut = (value: unknown, at: readonly string[], within: Set<object>): unknown => {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value !== 'object') throw notPlain(value, at);
	if (value instanceof Uint8Array) return value.slice();
	// An `alias` marker in plain data is the observable it names, copied out like any other.
	const target = aliased(value)?.proxy;
	if (target !== undefined) return convertOut(target, at, within);
	const observable = isObservable(value);
	if (!observable && !Array.isArray(value) && !isPlainObject(value)) throw notPlain(value, at);
	if (within.has(value)) throw loop(at);
	within.add(value);
	try {
		if (Array.isArray(value)) return Array.from(value, (item: unknown, index) => convertOut(item, [...at, String(index)], within) ?? null);
		const entries: Iterable<[string, unknown]> = observable && kindOf(value) === 'map'
			? (value as ObservableMap<unknown>).entries()
			: Object.entries(value);
		const out: [string, unknown][] = [];
		for (const [key, item] of entries) {
			const copied = convertOut(item, [...at, key], within);
			if (copied !== undefined) out.push([key, copied]);
		}
		return Object.fromEntries(out);
	} finally {
		within.delete(value);
	}
};

/**
 * A plain copy of a document, or of any part of one.
 *
 * Params:
 *   value: an observable, or plain data that may hold observables
 *
 * Returns: an object or a map as a plain object, an array as a plain array, bytes as a copy of the
 * bytes, every slot included. An observable a document reaches twice, through an alias, is copied
 * at each place. Nothing in the copy is live: writing it changes nothing.
 *
 * Throws: `cycle` when a value is reached again inside itself, which an alias to an ancestor
 * does. `invalid-value` for anything that is not plain data, naming where it was, and `too-deep`
 * for a value nested deeper than the runtime's stack.
 *
 * Example:
 *   const saved = JSON.stringify(toPlain(doc.root));
 *   const board = toPlain<Board>(handle.root);
 */
export const toPlain = <T = unknown>(value: unknown): T => bounded(() => convertOut(value, [], new Set()) as T);
