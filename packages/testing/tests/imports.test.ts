// Specifier extraction: every spelling an import statement has.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aweftPackageOf, moduleSpecifiers } from '../src/index.ts';

test('every literal spelling of an import is seen', () => {
	const spellings: Array<[string, string]> = [
		["import { a } from '@aweftjs/core';", 'single-quoted named'],
		['import { a } from "@aweftjs/core";', 'double-quoted named'],
		["import '@aweftjs/core';", 'bare side effect, single'],
		['import "@aweftjs/core";', 'bare side effect, double'],
		["import type { T } from '@aweftjs/core';", 'type only'],
		["import * as ns from '@aweftjs/core';", 'namespace'],
		["export * from '@aweftjs/core';", 're-export star'],
		["export { a } from '@aweftjs/core';", 're-export named'],
		["const p = import('@aweftjs/core');", 'dynamic, single'],
		['const p = import("@aweftjs/core");', 'dynamic, double'],
		['const p = import(`@aweftjs/core`);', 'dynamic, template'],
		["const c = require('@aweftjs/core');", 'require call'],
	];

	for (const [source, label] of spellings) {
		assert.deepEqual(moduleSpecifiers(source), ['@aweftjs/core'], label);
	}
});

test('a specifier in a comment or an ordinary string is not an import', () => {
	const source = [
		"// see '@aweftjs/core' in the docs",
		"/* import { a } from '@aweftjs/core'; */",
		"const doc = \"read about '@aweftjs/core' here\";",
		"const tpl = `mentions @aweftjs/core too`;",
	].join('\n');

	assert.deepEqual(moduleSpecifiers(source), []);
});

test('subpaths and digits resolve to their owning package', () => {
	assert.equal(aweftPackageOf('@aweftjs/dom/router'), 'dom');
	assert.equal(aweftPackageOf('@aweftjs/core'), 'core');
	assert.equal(aweftPackageOf('@aweftjs/ui2'), 'ui2');
	assert.equal(aweftPackageOf('@aweftjs/core/deep/er'), 'core');
	assert.equal(aweftPackageOf('node:fs'), undefined);
	assert.equal(aweftPackageOf('typescript'), undefined);
	assert.equal(aweftPackageOf('@other/scope'), undefined);
});

test('a specifier that is not a literal is honestly out of reach', () => {
	const source = [
		"const name = '@aweftjs/' + 'core';",
		'const p = import(name);',
	].join('\n');

	assert.deepEqual(moduleSpecifiers(source), []);
});
