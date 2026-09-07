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

test('a third-party peer is a violation unless the allowlist names it', () => {
	const violations = checkManifests([{
		name: '@aweftjs/icons',
		peerDependencies: { '@iconify-json/lucide': '^1.0.0' },
		peerDependenciesMeta: { '@iconify-json/lucide': { optional: true } },
	}], []);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /icons declares @iconify-json\/lucide/);
});

test('a peer the allowlist names still has to be optional', () => {
	// The probe the rule exists for: an allowed peer that installs itself with the package is a
	// dependency wearing another name, and nothing else in the gate would see it.
	const required = checkManifests([{
		name: '@aweftjs/icons',
		peerDependencies: { '@iconify-json/lucide': '^1.0.0' },
	}], ['@iconify-json/*']);
	assert.equal(required.length, 1);
	assert.match(required[0]!, /without peerDependenciesMeta\.optional/);

	const marked = checkManifests([{
		name: '@aweftjs/icons',
		peerDependencies: { '@iconify-json/lucide': '^1.0.0' },
		peerDependenciesMeta: { '@iconify-json/lucide': { optional: false } },
	}], ['@iconify-json/*']);
	assert.equal(marked.length, 1, 'optional: false is not optional');

	const optional = checkManifests([{
		name: '@aweftjs/icons',
		peerDependencies: { '@iconify-json/lucide': '^1.0.0' },
		peerDependenciesMeta: { '@iconify-json/lucide': { optional: true } },
	}], ['@iconify-json/*']);
	assert.deepEqual(optional, []);
});

test('a family pattern covers the family and nothing outside it', () => {
	const violations = checkManifests([{
		name: '@aweftjs/icons',
		devDependencies: { '@iconify-json/lucide': '^1.0.0', '@iconify-icons/lucide': '^1.0.0' },
	}], ['@iconify-json/*']);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /@iconify-icons\/lucide/);
});
