// The public surface, by name.
//
// Written by hand from the README and the decision records, never from the module, so an
// export that appears without being decided turns this red. The matcher and the pattern
// checker are deliberately absent: a policy is checked with checkPolicy and decided with
// validate, and there is no second way to ask what a rule covers.

import test from 'node:test';
import assert from 'node:assert/strict';

import * as schema from '../src/index.ts';

test('the entry file exports exactly what was decided', () => {
	const decided = [
		'ANY', 'REST', 'SELF',
		'checkPolicy', 'createIndex', 'pathOf', 'record', 'validate',
	];

	assert.deepEqual(Object.keys(schema).sort(), decided);
});

test('the wildcards are the plain data design 032 says they are', () => {
	assert.deepEqual(JSON.parse(JSON.stringify([schema.ANY, schema.REST, schema.SELF])), [
		{ any: true }, { rest: true }, { self: true },
	]);
});
