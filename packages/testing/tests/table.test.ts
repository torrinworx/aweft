// The boundary table is data, so it can rot without anything noticing. These tests are
// what notice. They check the shape of boundaries.json and that the declared graph of the
// stack is legal under its own rules, which catches a tier assigned by hand that
// contradicts an import that already exists.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkGraph, type PackageInfo } from '../src/boundaries.ts';

const table = JSON.parse(
	readFileSync(new URL('../../../boundaries.json', import.meta.url), 'utf8'),
) as { packages: Record<string, PackageInfo> };

const packages = table.packages;

test('every entry has a tier and a plane', () => {
	for (const [name, info] of Object.entries(packages)) {
		assert.ok(
			typeof info.tier === 'number' || info.tier === 'integrator',
			`${name} has tier ${String(info.tier)}, expected a number or "integrator"`,
		);
		assert.ok(
			['client', 'server', 'isomorphic'].includes(info.plane),
			`${name} has plane ${info.plane}`,
		);
	}
});

test('tiers are contiguous from 1, so no tier is silently empty', () => {
	const tiers = Object.values(packages)
		.map((p) => p.tier)
		.filter((t): t is number => typeof t === 'number');

	const present = [...new Set(tiers)].sort((a, b) => a - b);
	assert.deepEqual(present, Array.from({ length: present.length }, (_, i) => i + 1));
});

test('the base tier is isomorphic, since everything above it depends on it', () => {
	for (const [name, info] of Object.entries(packages)) {
		if (info.tier === 1) {
			assert.equal(info.plane, 'isomorphic', `${name} is tier 1 and must be isomorphic`);
		}
	}
});

test('the intended dependency graph is legal under the table', () => {
	// The edges the architecture calls for. If a tier is edited so one of these becomes
	// illegal, this fails rather than the mistake surfacing when the package is written.
	const intended: ReadonlyArray<readonly [string, string]> = [
		['schema', 'core'],
		['sync', 'core'],
		['sync', 'schema'],
		['store', 'core'],
		['store', 'schema'],
		['modules', 'core'],
		['dom', 'core'],
		['ui', 'dom'],
		['ui', 'core'],
		['icons', 'core'],
		['server', 'core'],
		['server', 'modules'],
		['server', 'store'],
		['server', 'sync'],
		['jobs', 'modules'],
		['aweft', 'ui'],
		['aweft', 'server'],
	];

	assert.deepEqual(checkGraph(intended, packages), []);
});

test('the table rejects the edges the architecture forbids', () => {
	const forbidden: ReadonlyArray<readonly [string, string]> = [
		['core', 'schema'],
		['core', 'store'],
		['dom', 'server'],
		['ui', 'jobs'],
		['store', 'dom'],
	];

	const violations = checkGraph(forbidden, packages);
	assert.equal(violations.length, forbidden.length, 'every forbidden edge should be caught');
});
