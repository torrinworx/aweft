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
		'checkEdge', 'checkFixture', 'checkGraph', 'checkInvalidFixture', 'checkManifests',
		'checkPublishing', 'securityChecks',
		'commitToJson', 'deltaFromJson', 'deltaToJson',
	'adapterChecks', 'driverChecks',
		'errorLines', 'errorsOf',
		'idFromText', 'idToText',
		'listenerChecks',
		'loadFixtures', 'loadInvalidFixtures', 'loadModule', 'loadServer',
		'modelApplier', 'moduleSpecifiers',
		'randomBelow', 'randomFrom', 'recordingDocument',
		'refFromJson', 'refToJson', 'roomChecks',
		'seedFrom', 'settle', 'shuffle', 'slotKeyOf', 'socketPair',
		'surfaceOf', 'surfaceProgram',
		'checkTheme', 'themeTokens', 'checkWords', 'wordRules',
		'valueFromJson', 'valueToJson',
	];

	assert.deepEqual(Object.keys(testing).sort(), [...decided].sort());
});
