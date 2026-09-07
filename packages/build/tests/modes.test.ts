// The two modes emit the same bytes.
//
// A module validated under one transform and executed under another validates, is stored, and
// breaks at render. So the bundler plugin and the function a browser calls are one implementation
// and this is the fixture suite that says so: every equivalence fixture goes through both, and
// the code and the map have to match byte for byte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { aweft, transform } from '../src/index.ts';
import { fixtures } from './fixtures.ts';

const sources = [
	...fixtures.flatMap((fixture) => [
		{ name: fixture.name, source: fixture.source, filename: 'case.ts' },
		...(fixture.jsx === undefined ? [] : [{ name: `${fixture.name} (JSX)`, source: fixture.jsx, filename: 'case.tsx' }]),
	]),
	// A file with asserts in it, so the two modes are compared on the pass that a release build
	// turns on as well as on the passes that always run.
	{
		name: 'a file with asserts',
		filename: 'guarded.ts',
		source: "import { h } from '@aweftjs/dom';\nimport { assert } from './assert.ts';\n"
			+ "export const a = (x) => { assert(x, 'needs x'); return h('p', { class: 'g' }, x); };",
	},
];

for (const release of [false, true]) {
	test(`the plugin and the function emit the same bytes, release ${release}`, () => {
		const plugin = aweft({ release });
		for (const entry of sources) {
			const direct = transform(entry.source, { filename: entry.filename, release });
			const through = plugin.transform(entry.source, entry.filename);
			assert.notEqual(through, null, `${entry.name}: the plugin skipped a file it handles`);
			assert.equal(through!.code, direct.code, `${entry.name}: the code differs`);
			assert.equal(through!.map, direct.map.toString(), `${entry.name}: the map differs`);
		}
	});
}

test('the plugin handles the four extensions and leaves everything else alone', () => {
	const plugin = aweft();
	const source = "import { h } from '@aweftjs/dom';\nexport const a = h('p', {}, 'x');";
	for (const id of ['a.js', 'a.jsx', 'a.ts', 'a.tsx']) {
		assert.notEqual(plugin.transform(source, id), null, `${id} should be handled`);
	}
	for (const id of ['a.css', 'a.json', 'a.svg', 'a']) {
		assert.equal(plugin.transform(source, id), null, `${id} should be left alone`);
	}
});

test('the plugin strips a query off the id before deciding, as a bundler appends one', () => {
	const plugin = aweft();
	const source = 'export const a = <p>x</p>;';
	const withQuery = plugin.transform(source, 'a.tsx?used&lang.tsx');
	assert.notEqual(withQuery, null);
	assert.equal(withQuery!.code, transform(source, { filename: 'a.tsx' }).code);
});

test('the plugin names itself and runs before the rest of the pipeline', () => {
	const plugin = aweft();
	assert.equal(plugin.name, 'aweft');
	assert.equal(plugin.enforce, 'pre');
});

test('the plugin claims an icon import and generates its module', async () => {
	// One plugin is the whole registration: the same object that compiles a page answers the
	// imports that compiling it wrote (design 141).
	const plugin = aweft();
	const importer = join(import.meta.dirname, 'page.tsx');

	const id = await plugin.resolveId('@aweftjs/icons/lucide/check', importer);
	assert.ok(id !== null && id.startsWith('\0'), 'a generated module is nobody\'s file');

	const source = await plugin.load(id);
	assert.match(source ?? '', /^export default \{/);
	assert.match(source ?? '', /"width":24/, 'the set\'s root size is on the icon');
});

test('the plugin leaves alone what is not a generated icon module', async () => {
	const plugin = aweft();
	const importer = join(import.meta.dirname, 'page.tsx');

	assert.equal(await plugin.resolveId('@aweftjs/icons', importer), null, 'the root entry is a file');
	assert.equal(await plugin.resolveId('@aweftjs/icons/node', importer), null, 'and so is the generator');
	assert.equal(await plugin.resolveId('@aweftjs/icons/node/x', importer), null,
		'so a set named node could never be reached, and none is published');
	assert.equal(await plugin.resolveId('@aweftjs/ui', importer), null);
	assert.equal(await plugin.resolveId('@aweftjs/icons/lucide/check', undefined), null,
		'with no importer there is no directory to resolve the set from');

	// A specifier that is not a request the generator answers is left to ordinary resolution,
	// so a path out of the sets never becomes a module (design 141).
	for (const source of ['@aweftjs/icons/..', '@aweftjs/icons/../x', '@aweftjs/icons/lucide/Check']) {
		assert.equal(await plugin.resolveId(source, importer), null, `${source} is not an icon import`);
	}
	assert.equal(await plugin.load('/some/page.tsx'), null);
});

test('the plugin refuses a set nobody installed, naming the install', async () => {
	const plugin = aweft();
	const id = await plugin.resolveId('@aweftjs/icons/nosuchset/home', join(import.meta.dirname, 'page.tsx'));
	await assert.rejects(async () => plugin.load(id!), /npm install @iconify-json\/nosuchset/);
});
