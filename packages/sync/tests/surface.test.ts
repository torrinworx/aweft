// The public surface, by name.
//
// Written by hand from the README and the design notes, never from the module, so an
// export that appears without being decided turns this red.
//
// Three layers, and the list says which is which: `track` on its own, the frame codec on its
// own, and the engine that needs both. A transport is not a layer: it is four functions a
// caller writes, and the three shipped here are conveniences over the same seam.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as sync from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = [
		// The commits of one document, in and out. The smallest thing that is useful alone.
		'track',
		// The protocol as bytes, so a transport nobody has written yet is a small job.
		'decodeFrame', 'encodeFrame',
		// The channels that ship. Everything else is written against the same four functions.
		'fromMessagePort', 'fromWebSocket', 'inProcess',
		// Saying a document, and moving one to what another says.
		'asCommit', 'reconcile', 'rootFrom',
		// The engine.
		'connect', 'serve', 'mirror',
	];

	assert.deepEqual(Object.keys(sync).sort(), [...decided].sort());
});

test('a channel is four functions, and that is the whole of a transport', () => {
	const [a] = sync.inProcess();
	assert.deepEqual(Object.keys(a).sort(), ['close', 'closed', 'receive', 'send']);
});

test('every shipped channel answers the same four functions', () => {
	const port = sync.fromMessagePort({
		postMessage: () => {}, addEventListener: () => {}, close: () => {},
	});
	const socket = sync.fromWebSocket({
		binaryType: '', readyState: 1, send: () => {}, close: () => {}, addEventListener: () => {},
	});
	for (const channel of [port, socket]) {
		assert.deepEqual(Object.keys(channel).sort(), ['close', 'closed', 'receive', 'send']);
	}
});
