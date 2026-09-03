// White-box: the pure graph and the merge, without a loader around them.

import test from 'node:test';
import assert from 'node:assert/strict';

import { type Definition, order, resolve } from '../src/graph.ts';
import { isPlainObject, merge } from '../src/merge.ts';
import type { Candidate, ModuleExports } from '../src/contract.ts';

const def = (name: string, deps: string[]): Definition =>
	({ name, deps, factory: () => ({}), config: {}, extensions: {} });

const candidate = (name: string, exports: ModuleExports): Candidate => ({ name, exports: async () => exports });

test('order puts every module after its dependencies and is the same whatever the insertion order', () => {
	const a = new Map([['top', def('top', ['mid'])], ['mid', def('mid', ['base'])], ['base', def('base', [])]]);
	const b = new Map([...a.entries()].reverse());
	assert.deepEqual(order(a), ['base', 'mid', 'top']);
	assert.deepEqual(order(b), ['base', 'mid', 'top']);
});

test('order treats a dependency outside the set as already satisfied', () => {
	assert.deepEqual(order(new Map([['x', def('x', ['elsewhere'])]])), ['x']);
});

test('order names a cycle from its first repeated member', () => {
	const defs = new Map([['a', def('a', ['b'])], ['b', def('b', ['c'])], ['c', def('c', ['b'])]]);
	assert.throws(() => order(defs), (e: Error & { reason?: string }) => e.reason === 'cycle' && /b -> c -> b/.test(e.message));
});

test('resolve takes the first factory, its deps and defaults, and every candidate\'s config, earliest winning', async () => {
	const d = await resolve('m', [
		candidate('m', { config: { a: 1 } }),
		candidate('m', { deps: ['x'], defaults: { a: 0, b: 0, c: 0 }, default: () => 'first', config: { b: 2 } }),
		candidate('m', { deps: ['ignored'], defaults: { z: 9 }, default: () => 'second', config: { c: 3 }, extensions: { e: 1 } }),
	]);
	assert.equal(d.factory({ imports: {}, config: {}, extensions: {} }), 'first');
	assert.deepEqual(d.deps, ['x']);
	assert.deepEqual(d.config, { a: 1, b: 2, c: 3 });
	assert.deepEqual(d.extensions, { e: 1 });
});

test('resolve ignores a deps that is not an array and a defaults that is not a plain object', async () => {
	const d = await resolve('m', [candidate('m', { deps: 'x' as never, defaults: 5 as never, default: () => 1 })]);
	assert.deepEqual(d.deps, []);
	assert.deepEqual(d.config, {});
});

test('resolve refuses no candidates and no implementation, each by reason', async () => {
	await assert.rejects(() => resolve('m', []), (e: Error & { reason?: string }) => e.reason === 'missing');
	await assert.rejects(() => resolve('m', [candidate('m', { config: {} })]), (e: Error & { reason?: string }) => e.reason === 'no-implementation');
});

test('merge: plain objects merge, everything else replaces, undefined leaves the other side', () => {
	assert.deepEqual(merge({ a: { b: 1, c: 1 }, list: [1], keep: 1 }, { a: { c: 2 }, list: [2, 2], gone: undefined }),
		{ a: { b: 1, c: 2 }, list: [2, 2], keep: 1 });
	class Thing { x = 1; }
	assert.equal(isPlainObject(new Thing()), false);
	assert.equal(isPlainObject(Object.create(null)), true);
	assert.equal(isPlainObject([]), false);
	assert.equal(isPlainObject(null), false);
	const thing = new Thing();
	assert.equal(merge({ a: { x: 0 } }, { a: thing }).a, thing, 'a class instance replaces rather than merges');
});
