// The behavioral corpus for `modules`: requirements this problem domain is known to need, each
// stated as something aweft must do. Append-only; removing a case needs a design note.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createObject } from '@aweftjs/core';

import { createLoader, fromBundle, fromDocument } from '../src/index.ts';
import type { Factory, ModuleExports, ModulesError } from '../src/index.ts';

const impl = (deps: readonly string[], make: Factory, extra: Partial<ModuleExports> = {}): ModuleExports =>
	({ deps, default: make, ...extra });

test('requirement: a diamond instantiates the shared dependency once and every path sees the same instance', async () => {
	let runs = 0;
	const loader = createLoader({
		sources: [fromBundle({
			base: impl([], () => ({ id: ++runs })),
			left: impl(['base'], ({ imports }) => imports.base),
			right: impl(['base'], ({ imports }) => imports.base),
			top: impl(['left', 'right'], ({ imports }) => [imports.left, imports.right]),
		})],
	});
	const { top } = await loader.load(['top']);
	assert.equal(runs, 1);
	const [l, r] = top as [unknown, unknown];
	assert.equal(l, r);
});

test('requirement: the load order is dependency order, and otherwise the order the sources listed the modules', async () => {
	const defs = {
		c: impl(['a'], () => ({})), a: impl([], () => ({})), b: impl(['a'], () => ({})), d: impl(['b', 'c'], () => ({})),
	};
	const forward = createLoader({ sources: [fromBundle(defs)] });
	const backward = createLoader({ sources: [fromBundle(Object.fromEntries(Object.entries(defs).reverse()))] });
	await forward.load(['a', 'b', 'c', 'd']);
	await backward.load(['a', 'b', 'c', 'd']);
	// The same sources in the same order give the same order, every time.
	assert.deepEqual(forward.loaded(), ['a', 'c', 'b', 'd']);
	assert.deepEqual(backward.loaded(), ['a', 'b', 'c', 'd']);
	// Nothing about a name decides it: `zeta` listed first loads first.
	const named = createLoader({ sources: [fromBundle({ zeta: impl([], () => ({})), alpha: impl([], () => ({})) })] });
	await named.load(['alpha', 'zeta']);
	assert.deepEqual(named.loaded(), ['zeta', 'alpha']);
});

test('requirement: across sources, a module loads in the place of the source that implements it, not of one that only configures it', async () => {
	const own = fromBundle({ 'static/Files': { config: { dir: 'x' } }, 'app/Board': impl([], () => ({})) });
	const uploads = fromBundle({ 'uploads/Serve': impl([], () => ({})) });
	const statics = fromBundle({ 'static/Files': impl([], ({ config }) => config) });
	const loader = createLoader({ sources: [own, uploads, statics] });
	await loader.load(['static/Files', 'app/Board', 'uploads/Serve']);
	assert.deepEqual(loader.loaded(), ['app/Board', 'uploads/Serve', 'static/Files']);
	assert.deepEqual(loader.get('static/Files'), { dir: 'x' });
});

test('requirement: a module loaded by name and again as somebody\'s dependency is the same module', async () => {
	let runs = 0;
	const loader = createLoader({
		sources: [fromBundle({
			base: impl([], () => ({ runs: ++runs })),
			top: impl(['base'], ({ imports }) => imports.base),
		})],
	});
	const { base } = await loader.load(['base']);
	const { top } = await loader.load(['top']);
	assert.equal(top, base);
	assert.equal(runs, 1);
});

test('requirement: a configuration array is replaced whole, never merged element by element', async () => {
	const loader = createLoader({
		sources: [
			fromBundle({ m: { config: { hosts: ['b'] } } }),
			fromBundle({ m: impl([], ({ config }) => config, { defaults: { hosts: ['a', 'a', 'a'] } }) }),
		],
	});
	assert.deepEqual((await loader.load(['m'])).m, { hosts: ['b'] });
});

test('requirement: an extension may spell a key as undefined without unsetting the default', async () => {
	const loader = createLoader({
		sources: [
			fromBundle({ m: { config: { port: undefined, host: 'x' } } }),
			fromBundle({ m: impl([], ({ config }) => config, { defaults: { port: 80, host: 'y' } }) }),
		],
	});
	assert.deepEqual((await loader.load(['m'])).m, { port: 80, host: 'x' });
});

test('requirement: a failed load can be retried after the cause is fixed, without unloading anything', async () => {
	let ready = false;
	const loader = createLoader({
		sources: [fromBundle({
			db: impl([], () => ({})),
			users: impl(['db'], () => { if (!ready) throw new Error('not yet'); return { ok: true }; }),
		})],
	});
	await assert.rejects(() => loader.load(['users']), (e: unknown) => (e as ModulesError).reason === 'failed');
	assert.deepEqual(loader.loaded(), ['db']);
	ready = true;
	assert.deepEqual((await loader.load(['users'])).users, { ok: true });
	assert.deepEqual(loader.loaded(), ['db', 'users']);
});

test('requirement: a load that fails half way does not leave the failed module marked as pending', async () => {
	let attempts = 0;
	const loader = createLoader({
		sources: [fromBundle({ m: impl([], () => { attempts++; throw new Error('always'); }) })],
	});
	await assert.rejects(() => loader.load(['m']));
	await assert.rejects(() => loader.load(['m']));
	assert.equal(attempts, 2, 'the second load tried again rather than waiting on the first');
});

test('requirement: a stop that throws still unloads the module, and the error reaches the caller', async () => {
	const loader = createLoader({
		sources: [fromBundle({ m: impl([], () => ({ stop: () => { throw new Error('could not close'); } })) })],
	});
	await loader.load(['m']);
	await assert.rejects(() => loader.unload('m'), /could not close/);
	assert.equal(loader.get('m'), undefined);
});

test('requirement: a document entry whose source is not a string is not a candidate, and a non-object entry is ignored', async () => {
	const doc = createObject<Record<string, unknown>>({
		a: createObject({ source: 42 }),
		b: createObject({ source: 'export default () => ({ b: true })' }),
		c: 'not an entry',
		d: null,
	});
	const loader = createLoader({ sources: [fromDocument(doc)] });
	assert.deepEqual((await fromDocument(doc).candidates()).map((c) => c.name), ['b']);
	await assert.rejects(() => loader.load(['a']), (e: unknown) => (e as ModulesError).reason === 'missing');
});

test('requirement: a module document and a bundle compose, and a document module may depend on a bundled one', async () => {
	const doc = createObject<Record<string, unknown>>({
		'plugin/Twice': createObject({ source: 'export const deps = ["lib/Num"]; export default ({ imports }) => imports.Num.n * 2' }),
	});
	const loader = createLoader({ sources: [fromBundle({ 'lib/Num': impl([], () => ({ n: 21 })) }), fromDocument(doc)] });
	assert.equal((await loader.load(['plugin/Twice']))['plugin/Twice'], 42);
});
