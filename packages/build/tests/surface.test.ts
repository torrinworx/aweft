// The public surface, by name. Written fromdesigns 088 to 097, never from
// the module, so an export that appears without being decided turns this red.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as build from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	assert.deepEqual(Object.keys(build).sort(), ['TransformError', 'aweft', 'mangle', 'transform']);
});

test('every export does the job it is for', () => {
	const source = "import { h } from '@aweftjs/dom';\nexport const a = h('p', { class: 'x' }, 'body');";

	const result = build.transform(source, { filename: 'a.ts' });
	assert.match(result.code, /_template/);
	assert.equal(result.map.version, 3);

	assert.equal(build.aweft().transform(source, 'a.ts')?.code, result.code);
	assert.ok(build.mangle.pattern.test('internal_'));
	assert.ok(new build.TransformError('m', 3) instanceof Error);
	assert.equal(new build.TransformError('m', 3).at, 3);
});
