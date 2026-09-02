// The public surface, by name.
//
// The exports map decides what exists outside this package, and design 030 says the
// delivery plumbing never does. This list is written by hand from the README and the
// design notes, never from the module, so an export that appears without being decided
// turns this red.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = [
		'alias', 'all', 'apply', 'atomic',
		'createArray', 'createMap', 'createObject',
		'fromEvent', 'fromSnapshot',
		'idOf', 'immutable', 'insertAt', 'isObservable', 'isReachable',
		'kindOf', 'mutable', 'observer', 'parentOf', 'positionsOf',
		'slotKeyOf',
	'snapshot', 'textIdOf', 'timer',
	];

	assert.deepEqual(Object.keys(core).sort(), decided);
});
