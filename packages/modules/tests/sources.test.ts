// The bundle and document sources, and the default compile.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createArray, createObject } from '@aweftjs/core';

import { compile, createLoader, fromBundle, fromDocument } from '../src/index.ts';
import type { ModuleExports, ModulesError } from '../src/index.ts';

const names = async (source: { candidates(): Promise<readonly { name: string }[]> }): Promise<string[]> =>
	(await source.candidates()).map((c) => c.name);

test('a bundle key becomes a name without its prefix or its extension', async () => {
	const exports: ModuleExports = { default: () => ({}) };
	assert.deepEqual(
		await names(fromBundle({
			'./modules/auth/Session.js': exports,
			'./modules/posts/Create.ts': exports,
			'./other/Thing.mjs': exports,
		}, { prefix: './modules/' })),
		['auth/Session', 'posts/Create', 'other/Thing'],
	);
	assert.deepEqual(
		await names(fromBundle({ './a/B.jsx': exports, 'c/D.mts': exports, 'e/F.cjs': exports })),
		['a/B', 'c/D', 'e/F'],
	);
});

test('a lazy bundle entry is called when its exports are asked for, not when the bundle is listed', async () => {
	let calls = 0;
	const source = fromBundle({ m: async () => { calls++; return { default: () => ({ n: 1 }) }; } });
	const [candidate] = await source.candidates();
	assert.equal(calls, 0);
	assert.equal(typeof (await candidate!.exports()).default, 'function');
	assert.equal(calls, 1);
});

test('a document lists the entries that carry a source, keyed by module name', async () => {
	const doc = createObject<Record<string, unknown>>({
		'plugin/A': createObject({ source: 'export default () => ({ a: 1 })', author: 'someone', versions: createArray() }),
		'plugin/B': createObject({ source: 'export default () => ({ b: 2 })' }),
		'plugin/Draft': createObject({ note: 'no source yet' }),
		count: 2,
	});
	assert.deepEqual(await names(fromDocument(doc)), ['plugin/A', 'plugin/B']);
});

test('a document lists sorted, whatever order its keys were written in, because a listing is a load order (design 263)', async () => {
	const doc = createObject<Record<string, unknown>>({
		'plugin/Zeta': createObject({ source: 'export default () => ({})' }),
		'plugin/Mid': createObject({ source: 'export default () => ({})' }),
		'plugin/Alpha': createObject({ source: 'export default () => ({})' }),
	});
	assert.deepEqual(await names(fromDocument(doc)), ['plugin/Alpha', 'plugin/Mid', 'plugin/Zeta']);
});

test('a document module compiles through the default compile and runs with its dependencies', async () => {
	const doc = createObject<Record<string, unknown>>({
		'p/Base': createObject({ source: 'export default () => ({ v: 3 })' }),
		'p/Top': createObject({ source: 'export const deps = ["p/Base"]; export default ({ imports }) => ({ v: imports.Base.v * 2 })' }),
	});
	const loader = createLoader({ sources: [fromDocument(doc)] });
	const { 'p/Top': top } = await loader.load(['p/Top']);
	assert.deepEqual(top, { v: 6 });
});

test('a document source takes the compile it is given, and hands it the text as it is now', async () => {
	const seen: string[] = [];
	const doc = createObject<Record<string, unknown>>({ m: createObject({ source: 'one' }) });
	const source = fromDocument(doc, { compile: async (text) => { seen.push(text); return { default: () => ({ text }) }; } });
	const [candidate] = await source.candidates();
	(doc.m as { source: string }).source = 'two';
	const exports = await candidate!.exports();
	assert.deepEqual(exports.default!({ imports: {}, config: {}, extensions: {} }), { text: 'two' });
	assert.deepEqual(seen, ['two'], 'the source is read when exports are asked for, not when listed');
});

test('an entry removed between listing and evaluating is refused rather than compiled from nothing', async () => {
	const doc = createObject<Record<string, unknown>>({ m: createObject({ source: 'export default () => 1' }) });
	const [candidate] = await fromDocument(doc).candidates();
	delete doc.m;
	await assert.rejects(() => candidate!.exports(), (e: unknown) =>
		(e as ModulesError).reason === 'missing' && (e as ModulesError).module === 'm');
});

test('a bundle key that leaves no name is refused at once, by reason', () => {
	assert.throws(() => fromBundle({ './.ts': { default: () => 'nameless' } }), (e: unknown) =>
		(e as ModulesError).reason === 'invalid-name');
	assert.throws(() => fromBundle({ './modules/': { default: () => 'nameless' } }, { prefix: './modules/' }), (e: unknown) =>
		(e as ModulesError).reason === 'invalid-name');
});

test('a bundle key and a directory file that name the same module spell the name the same way', async () => {
	// `.json` is not a module file in a directory and would keep no extension in a bundle either:
	// one rule, the last extension goes, whatever it is.
	assert.deepEqual(await names(fromBundle({ './a/B.json': { default: () => 1 }, './c/D.config.ts': { default: () => 1 } })), ['a/B', 'c/D.config']);
});

test('compile turns module text into exports with no dependency, and refuses text that is not a module', async () => {
	const exports = await compile('export const deps = ["a/B"]; export const defaults = { n: 1 }; export default ({ config }) => config.n');
	assert.deepEqual(exports.deps, ['a/B']);
	assert.deepEqual(exports.defaults, { n: 1 });
	assert.equal(exports.default!({ imports: {}, config: { n: 5 }, extensions: {} }), 5);
	await assert.rejects(() => compile('export default ({'), SyntaxError);
});
