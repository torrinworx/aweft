// The release mangle pattern (design 091).
//
// The two underscore meanings must never be conflated: a leading underscore is a behavioral rule
// a wildcard observer reads, a trailing one is a build rule. The names below are written from
// that rule, not from the pattern.

import test from 'node:test';
import assert from 'node:assert/strict';

import { mangle } from '../src/index.ts';

test('a name that ends in exactly one underscore is internal surface and may be renamed', () => {
	for (const name of ['queue_', 'a_', 'nextNode_', 'x1_']) {
		assert.ok(mangle.pattern.test(name), `${name} is manglable`);
	}
});

test('a leading underscore is runtime-private and is never renamed', () => {
	for (const name of ['_private', '_foo_', '_', '__']) {
		assert.equal(mangle.pattern.test(name), false, `${name} must not be mangled`);
	}
});

test('an ordinary name and a doubled underscore are left alone', () => {
	for (const name of ['plain', 'toString', 'queue__', 'a_b', '']) {
		assert.equal(mangle.pattern.test(name), false, `${name} must not be mangled`);
	}
});

test('the two minifier shapes carry the same rule', () => {
	assert.equal(mangle.terser.mangle.properties.regex, mangle.pattern);
	assert.equal(mangle.esbuild.mangleProps, mangle.pattern);
});
