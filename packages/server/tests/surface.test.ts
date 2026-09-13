// What the package hands out, and nothing more. A new export lands here in the same change as
// the design note that describes it.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as server from '../src/index.ts';
import * as node from '../src/node.ts';

test('the main entry hands out exactly what the calls decided', () => {
	assert.deepEqual(Object.keys(server).sort(), ['createServer', 'open', 'sliding']);
});

test('the node subpath hands out the listener and nothing else', () => {
	assert.deepEqual(Object.keys(node), ['node']);
});

test('open is a gate and share handlers at once, and nothing else', () => {
	assert.deepEqual(Object.keys(server.open).sort(), ['accept', 'access', 'identify']);
});
