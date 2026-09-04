// Only data crosses the boundary (design 068).
//
// The walk that refuses anything else is the same walk that makes the text, so there is one
// definition of "plain data" and it is the one the wire carries.

import { isObservable } from '@aweftjs/core';

import { sandboxError } from './contract.ts';

const isPlainObject = (value: object): boolean => {
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === null || proto === Object.prototype;
};

/**
 * Refuse anything that is not plain data, naming where it is.
 *
 * Params:
 *   value: what is about to cross
 *   path: where it sits, for the error; `args[0]`, `result`, `props.db`
 *
 * Plain data is what `JSON.parse(JSON.stringify(x))` gives back unchanged: null, booleans,
 * finite numbers, strings, arrays of it and plain objects of it. A function, a symbol, an
 * observable, a `Uint8Array`, a `Map`, a class instance, `undefined` inside an array, or
 * a cycle is refused as `not-data`.
 */
export const assertData = (value: unknown, path: string): void => {
	const seen = new Set<object>();
	const walk = (v: unknown, at: string): void => {
		if (v === null || typeof v === 'boolean' || typeof v === 'string') return;
		if (typeof v === 'number') {
			if (Number.isFinite(v)) return;
			throw sandboxError('not-data', `${at} is ${String(v)}, which JSON cannot carry`, at);
		}
		// A function, a symbol or a bigint: named by its typeof, which also narrows v to an
		// object for the checks below. A class instance or a Map falls through to the else.
		if (typeof v !== 'object') throw sandboxError('not-data', `${at} is a ${typeof v}, and only data crosses the boundary`, at);
		if (isObservable(v)) throw sandboxError('not-data', `${at} is an observable, and only data crosses the boundary`, at);
		if (seen.has(v)) throw sandboxError('not-data', `${at} refers back to something above it`, at);
		seen.add(v);
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				if (v[i] === undefined) throw sandboxError('not-data', `${at}[${i}] is undefined, which JSON turns into null`, `${at}[${i}]`);
				walk(v[i], `${at}[${i}]`);
			}
		} else if (isPlainObject(v)) {
			for (const [key, item] of Object.entries(v)) {
				if (item === undefined) continue;
				walk(item, `${at}.${key}`);
			}
		} else {
			throw sandboxError('not-data', `${at} is a ${v.constructor?.name ?? 'non-plain object'}, and only data crosses the boundary`, at);
		}
		seen.delete(v);
	};
	if (value === undefined) return;
	walk(value, path);
};

/** Data to text, after `assertData`. */
export const encode = (value: unknown, path: string): string => {
	assertData(value, path);
	return JSON.stringify(value === undefined ? null : value);
};

/** Text back to data. Text the other end wrote that is not JSON is `malformed`. */
export const decode = (text: unknown, what: string): unknown => {
	if (typeof text !== 'string') throw sandboxError('malformed', `${what} is not text`);
	try {
		return JSON.parse(text);
	} catch {
		throw sandboxError('malformed', `${what} is not JSON`);
	}
};
