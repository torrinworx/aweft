// The public surface, by name.
//
// The exports map decides what exists outside this package. This list is written by hand
// from the README and the architecture doc, never from the module, so an export that
// appears or disappears without being decided turns this red rather than passing silently.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as testing from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = [
		'applyCommit', 'aweftPackageOf', 'canonicalJson',
		'checkDecisionHeader',
		'checkEdge', 'checkFixture', 'checkGraph', 'checkInvalidFixture', 'checkManifests',
		'commitToJson', 'deltaFromJson', 'deltaToJson',
	'driverChecks',
		'errorLines', 'errorsOf',
		'idFromText', 'idToText',
		'listenerChecks',
		'loadFixtures', 'loadInvalidFixtures', 'loadModule',
		'modelApplier', 'moduleSpecifiers',
		'randomBelow', 'randomFrom', 'recordingDocument',
		'refFromJson', 'refToJson', 'roomChecks',
		'seedFrom', 'shuffle', 'slotKeyOf',
		'surfaceOf', 'surfaceProgram',
		'valueFromJson', 'valueToJson',
	];

	assert.deepEqual(Object.keys(testing).sort(), decided);
});
