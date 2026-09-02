// The dependency allowlist check.

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkManifests } from '../src/index.ts';

test('stack packages may depend on each other and on nothing else by default', () => {
	const clean = checkManifests([
		{ name: '@aweftjs/core', dependencies: { '@aweftjs/codec': '*' } },
	], []);
	assert.deepEqual(clean, []);
});

test('a second test framework or a DOM library is a violation wherever it is declared', () => {
	const violations = checkManifests([
		{ name: '@aweftjs/core', devDependencies: { vitest: '^2.0.0' } },
		{ name: '@aweftjs/ui', dependencies: { jsdom: '^24.0.0' } },
	], []);
	assert.equal(violations.length, 2);
	assert.match(violations[0]!, /vitest/);
	assert.match(violations[1]!, /jsdom/);
});

test('a per-package allowance covers that package alone', () => {
	const manifests = [
		{ name: '@aweftjs/testing', dependencies: { typescript: '^5.0.0' } },
		{ name: '@aweftjs/core', dependencies: { typescript: '^5.0.0' } },
	];
	const violations = checkManifests(manifests, [], { '@aweftjs/testing': ['typescript'] });
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /core declares typescript/);
});
