// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as modules from '../src/index.ts';
import * as node from '../src/node.ts';

test('the main entry hands out exactly what the calls decided', () => {
	assert.deepEqual(Object.keys(modules).sort(), [
		'compile', 'createLoader', 'follow', 'fromBundle', 'fromDocument',
	]);
});

test('the node subpath hands out the directory source and nothing else', () => {
	assert.deepEqual(Object.keys(node), ['fromDirectory']);
});
