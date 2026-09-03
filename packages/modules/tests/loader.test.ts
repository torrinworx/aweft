// The loader's tools, through the public surface, over a bundle source.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLoader, fromBundle } from '../src/index.ts';
import type { Factory, ModuleExports, ModulesError } from '../src/index.ts';

const impl = (deps: readonly string[], make: Factory, extra: Partial<ModuleExports> = {}): ModuleExports =>
	({ deps, default: make, ...extra });

const reasonOf = (error: unknown): string => (error as ModulesError).reason;
const moduleOf = (error: unknown): string => (error as ModulesError).module;

test('dependencies load first and are injected under the last segment of their name', async () => {
	const trace: string[] = [];
	const loader = createLoader({
		sources: [fromBundle({
			'a/Config': impl([], () => { trace.push('Config'); return { value: 7 }; }),
			'a/Reader': impl(['a/Config'], ({ imports }) => {
				trace.push('Reader');
				return { read: () => (imports.Config as { value: number }).value };
			}),
		})],
	});

	const out = await loader.load(['a/Reader']);
	assert.deepEqual(trace, ['Config', 'Reader']);
	assert.equal((out['a/Reader'] as { read(): number }).read(), 7);
	assert.deepEqual(Object.keys(out), ['a/Reader'], 'only what was asked for is handed back');
	assert.deepEqual(loader.loaded(), ['a/Config', 'a/Reader']);
});

test('a loaded module is handed back as it is, and its factory does not run again', async () => {
	let runs = 0;
	const loader = createLoader({ sources: [fromBundle({ m: impl([], () => ({ n: ++runs })) })] });
	const first = (await loader.load(['m'])).m;
	const second = (await loader.load(['m'])).m;
	assert.equal(first, second);
	assert.equal(runs, 1);
	assert.equal(loader.get('m'), first);
});

test('the loader props reach every factory, and the three named fields win over them', async () => {
	let seen: Record<string, unknown> = {};
	const loader = createLoader({
		sources: [fromBundle({ m: impl([], (props) => { seen = { ...props }; return {}; }) })],
		props: { log: 'a logger', config: 'not the config', imports: 'not the imports' },
	});
	await loader.load(['m']);
	assert.equal(seen.log, 'a logger');
	assert.deepEqual(seen.config, {});
	assert.deepEqual(seen.imports, {});
	assert.deepEqual(seen.extensions, {});
});

test('configuration is defaults, then every source\'s config, the earliest source winning', async () => {
	const loader = createLoader({
		sources: [
			fromBundle({ m: { config: { depth: { a: 1 }, list: [1] } } }),
			fromBundle({ m: impl([], ({ config }) => config, { defaults: { depth: { a: 0, b: 0 }, list: [0, 0], keep: true } }) }),
			fromBundle({ m: { config: { depth: { b: 5, c: 9 }, list: [2, 2, 2] } } }),
		],
	});
	const { m } = await loader.load(['m']);
	assert.deepEqual(m, { depth: { a: 1, b: 5, c: 9 }, list: [1], keep: true });
});

test('the earliest implementation wins, and extensions from every source still contribute', async () => {
	const loader = createLoader({
		sources: [
			fromBundle({ m: impl([], ({ config, extensions }) => ({ who: 'first', config, extensions }), { defaults: { size: 1 } }) }),
			fromBundle({ m: impl([], () => ({ who: 'second' }), { defaults: { size: 2 }, config: { colour: 'red' }, extensions: { after: 'x' } }) }),
		],
	});
	const m = (await loader.load(['m'])).m as { who: string; config: unknown; extensions: unknown };
	assert.equal(m.who, 'first');
	assert.deepEqual(m.config, { size: 1, colour: 'red' }, 'the losing implementation\'s defaults do not apply, its config does');
	assert.deepEqual(m.extensions, { after: 'x' });
});

test('a name in no source is refused, naming it', async () => {
	const loader = createLoader({ sources: [fromBundle({})] });
	await assert.rejects(() => loader.load(['nope']), (e: unknown) => reasonOf(e) === 'missing' && moduleOf(e) === 'nope');
	await assert.rejects(
		() => createLoader({ sources: [fromBundle({ m: impl(['gone'], () => ({})) })] }).load(['m']),
		(e: unknown) => reasonOf(e) === 'missing' && moduleOf(e) === 'gone',
		'a missing dependency names the dependency',
	);
});

test('a name with only configuration is refused, not silently skipped', async () => {
	const loader = createLoader({ sources: [fromBundle({ m: { config: { a: 1 } } })] });
	await assert.rejects(() => loader.load(['m']), (e: unknown) => reasonOf(e) === 'no-implementation');
});

test('a cycle is refused naming the modules in it, and nothing is instantiated', async () => {
	let ran = 0;
	const loader = createLoader({
		sources: [fromBundle({
			a: impl(['b'], () => ++ran),
			b: impl(['c'], () => ++ran),
			c: impl(['a'], () => ++ran),
		})],
	});
	await assert.rejects(() => loader.load(['a']), (e: unknown) =>
		reasonOf(e) === 'cycle' && /a -> b -> c -> a/.test((e as Error).message));
	assert.equal(ran, 0);
	assert.deepEqual(loader.loaded(), []);
});

test('two dependencies sharing a last segment are refused rather than one overwriting the other', async () => {
	const loader = createLoader({
		sources: [fromBundle({
			'x/Log': impl([], () => 'x'),
			'y/Log': impl([], () => 'y'),
			m: impl(['x/Log', 'y/Log'], ({ imports }) => imports),
		})],
	});
	await assert.rejects(() => loader.load(['m']), (e: unknown) => reasonOf(e) === 'ambiguous-import' && moduleOf(e) === 'm');
});

test('a factory that throws names its module and carries the cause; what loaded before it stays loaded', async () => {
	const boom = new Error('no database');
	const loader = createLoader({
		sources: [fromBundle({
			'a/Db': impl([], () => ({ db: true })),
			'a/Users': impl(['a/Db'], () => { throw boom; }),
		})],
	});
	await assert.rejects(() => loader.load(['a/Users']), (e: unknown) =>
		reasonOf(e) === 'failed' && moduleOf(e) === 'a/Users' && (e as Error).cause === boom);
	assert.deepEqual(loader.loaded(), ['a/Db']);
	assert.equal(loader.get('a/Users'), undefined);
});

test('an asynchronous factory is awaited', async () => {
	const loader = createLoader({ sources: [fromBundle({ m: impl([], async () => { await Promise.resolve(); return { ready: true }; }) })] });
	assert.deepEqual((await loader.load(['m'])).m, { ready: true });
});

test('unload calls and awaits stop, drops the instance, and says whether there was one', async () => {
	const events: string[] = [];
	const loader = createLoader({
		sources: [fromBundle({
			m: impl([], () => ({ stop: async () => { await Promise.resolve(); events.push('stopped'); } })),
			plain: impl([], () => ({ nothing: 'to stop' })),
			number: impl([], () => 42),
		})],
	});
	await loader.load(['m', 'plain', 'number']);
	assert.equal(loader.get('number'), 42);

	assert.equal(await loader.unload('m'), true);
	assert.deepEqual(events, ['stopped'], 'stop ran to completion before unload returned');
	assert.equal(loader.get('m'), undefined);
	assert.equal(await loader.unload('m'), false);
	assert.equal(await loader.unload('plain'), true);
	assert.equal(await loader.unload('number'), true);
	assert.equal(await loader.unload('never loaded'), false);
	assert.deepEqual(loader.loaded(), []);
});

test('unload touches exactly the named module; a dependent keeps what it was handed', async () => {
	const loader = createLoader({
		sources: [fromBundle({
			base: impl([], () => ({ v: 1 })),
			top: impl(['base'], ({ imports }) => ({ base: imports.base })),
		})],
	});
	const { top } = await loader.load(['top']);
	await loader.unload('base');
	assert.deepEqual(loader.loaded(), ['top']);
	assert.deepEqual((top as { base: unknown }).base, { v: 1 });
});

test('the loaded graph is readable: dependencies, dependents, get, loaded', async () => {
	const loader = createLoader({
		sources: [fromBundle({
			base: impl([], () => ({})),
			left: impl(['base'], () => ({})),
			right: impl(['base'], () => ({})),
			top: impl(['left', 'right'], () => ({})),
		})],
	});
	await loader.load(['top']);
	assert.deepEqual(loader.dependencies('top'), ['left', 'right']);
	assert.deepEqual(loader.dependents('base'), ['left', 'right']);
	assert.deepEqual(loader.dependents('top'), []);
	assert.equal(loader.dependencies('nope'), undefined);
	assert.equal(loader.get('nope'), undefined);
	assert.deepEqual(loader.loaded(), ['base', 'left', 'right', 'top']);
});

test('two loads racing for one module build it once', async () => {
	let runs = 0;
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const loader = createLoader({ sources: [fromBundle({ m: impl([], async () => { runs++; await gate; return { runs }; }) })] });

	const both = Promise.all([loader.load(['m']), loader.load(['m'])]);
	release();
	const [a, b] = await both;
	assert.equal(runs, 1);
	assert.equal(a.m, b.m);
});

test('two loaders share nothing', async () => {
	const map = { m: impl([], () => ({})) };
	const one = createLoader({ sources: [fromBundle(map)] });
	const two = createLoader({ sources: [fromBundle(map)] });
	await one.load(['m']);
	assert.deepEqual(one.loaded(), ['m']);
	assert.deepEqual(two.loaded(), []);
	assert.notEqual((await two.load(['m'])).m, one.get('m'));
});

test('listing evaluates nothing, and loading evaluates only what is needed', async () => {
	const evaluated: string[] = [];
	const lazy = (name: string, exports: ModuleExports) => async () => { evaluated.push(name); return exports; };
	const loader = createLoader({
		sources: [fromBundle({
			wanted: lazy('wanted', impl(['needed'], () => ({}))),
			needed: lazy('needed', impl([], () => ({}))),
			unrelated: lazy('unrelated', impl([], () => { throw new Error('never'); })),
		})],
	});
	assert.deepEqual(evaluated, []);
	await loader.load(['wanted']);
	assert.deepEqual(evaluated.sort(), ['needed', 'wanted']);
});

test('a factory that unloads a sibling named in the same load gets a ModulesError, not a crash', async () => {
	let loaderRef: ReturnType<typeof createLoader> | undefined;
	const loader = createLoader({
		sources: [fromBundle({
			a: impl([], () => ({ a: true })),
			b: impl(['a'], async () => { await loaderRef!.unload('a'); return { b: true }; }),
		})],
	});
	loaderRef = loader;
	await assert.rejects(() => loader.load(['a', 'b']), (e: unknown) =>
		reasonOf(e) === 'missing' && moduleOf(e) === 'a' && /unloaded while it was being loaded/.test((e as Error).message));
	assert.deepEqual(loader.loaded(), ['b']);
});

test('one source listing a name twice is refused rather than one candidate shadowing the other', async () => {
	const twice = {
		candidates: async () => [
			{ name: 'm', exports: async () => impl([], () => 'first') },
			{ name: 'm', exports: async () => impl([], () => 'second') },
		],
	};
	const loader = createLoader({ sources: [twice] });
	await assert.rejects(() => loader.load(['m']), (e: unknown) => reasonOf(e) === 'duplicate' && moduleOf(e) === 'm');
	assert.deepEqual(loader.loaded(), []);
});
