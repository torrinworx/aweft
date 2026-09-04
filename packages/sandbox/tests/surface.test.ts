// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as sandbox from '../src/index.ts';
import * as inside from '../src/inside.ts';
import * as node from '../src/node.ts';

test('the main entry hands out exactly what the calls decided', () => {
	assert.deepEqual(Object.keys(sandbox).sort(), ['createSandbox', 'iframe', 'inProcess']);
});

test('the inside subpath is the far end, over a channel or a port', () => {
	assert.deepEqual(Object.keys(inside).sort(), ['inside', 'insidePort']);
});

test('the node subpath hands out the child runner and nothing else', () => {
	assert.deepEqual(Object.keys(node), ['child']);
});
