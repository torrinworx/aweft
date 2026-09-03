// The directory source: what it lists, what it names, and what it leaves alone.

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { createLoader } from '../src/index.ts';
import type { ModulesError } from '../src/index.ts';
import { fromDirectory } from '../src/node.ts';

const fixture = (dir: string): string => fileURLToPath(new URL(`./fixtures/${dir}/`, import.meta.url));

test('a directory lists every module file by its relative path, sorted, and nothing else', async () => {
	const names = (await fromDirectory(fixture('app')).candidates()).map((c) => c.name);
	// notes.d.ts and data.json are in the directory and are not modules.
	assert.deepEqual(names, ['greet/Format', 'greet/Say', 'lib/Log']);
});

test('two files that would share one name in one directory are refused by the loader, not shadowed', async () => {
	// fixtures/dup holds thing.js beside thing.ts. Listing shows both; loading refuses.
	assert.deepEqual((await fromDirectory(fixture('dup')).candidates()).map((c) => c.name), ['thing', 'thing']);
	const loader = createLoader({ sources: [fromDirectory(fixture('dup'))] });
	await assert.rejects(() => loader.load(['thing']), (e: unknown) => (e as ModulesError).reason === 'duplicate');
});

test('listing a directory evaluates no file', async () => {
	// A candidate whose exports were evaluated would be a module namespace; one that was not is
	// just a name and a function. The only way to know is to load, so this checks the shape.
	const [first] = await fromDirectory(fixture('app')).candidates();
	assert.equal(typeof first!.exports, 'function');
	assert.deepEqual(Object.keys(first!), ['name', 'exports']);
});

test('two directories compose: the earlier wins an implementation, and its configuration reaches a later one', async () => {
	const loader = createLoader({ sources: [fromDirectory(fixture('app')), fromDirectory(fixture('lib'))] });
	const out = await loader.load(['greet/Say', 'lib/Log']);

	// greet/Format exists in both; the app's ('.') wins over the library's ('!').
	assert.equal((out['greet/Say'] as { say(n: string): string }).say('ada'), 'hello ada.');
	// lib/Log is implemented only in the library; the app's same-named file carries only config.
	const log = out['lib/Log'] as { prefix: string; level: string };
	assert.equal(log.prefix, '[app]');
	assert.equal(log.level, 'info');
	assert.deepEqual(loader.loaded(), ['greet/Format', 'greet/Say', 'lib/Log']);
});
