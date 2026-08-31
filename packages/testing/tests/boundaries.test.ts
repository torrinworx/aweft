import test from 'node:test';
import assert from 'node:assert/strict';

import { checkEdge, checkGraph, type PackageInfo } from '../src/boundaries.ts';

const table: Record<string, PackageInfo> = {
	core: { tier: 1, plane: 'isomorphic' },
	schema: { tier: 2, plane: 'isomorphic' },
	sync: { tier: 3, plane: 'isomorphic' },
	store: { tier: 3, plane: 'isomorphic' },
	modules: { tier: 4, plane: 'isomorphic' },
	dom: { tier: 5, plane: 'client' },
	server: { tier: 5, plane: 'server' },
	ui: { tier: 6, plane: 'client' },
	jobs: { tier: 6, plane: 'server' },
	testing: { tier: 'integrator', plane: 'isomorphic' },
	aweft: { tier: 'integrator', plane: 'isomorphic' },
};

test('a package may import a lower tier', () => {
	assert.equal(checkEdge('schema', 'core', table), null);
	assert.equal(checkEdge('ui', 'core', table), null);
	assert.equal(checkEdge('modules', 'store', table), null);
});

test('a package may import its own tier', () => {
	assert.equal(checkEdge('sync', 'store', table), null);
	assert.equal(checkEdge('store', 'sync', table), null);
});

test('importing upward is a violation', () => {
	const v = checkEdge('core', 'schema', table);
	assert.ok(v);
	assert.equal(v.rule, 'upward-tier');
	assert.match(v.detail, /tier 1 .* tier 2/);
});

test('crossing the client and server planes is a violation, both directions', () => {
	assert.equal(checkEdge('ui', 'server', table)?.rule, 'cross-plane');
	assert.equal(checkEdge('server', 'ui', table)?.rule, 'upward-tier');
	assert.equal(checkEdge('jobs', 'dom', table)?.rule, 'cross-plane');
});

test('isomorphic packages sit on both planes', () => {
	assert.equal(checkEdge('dom', 'core', table), null);
	assert.equal(checkEdge('server', 'core', table), null);
	assert.equal(checkEdge('jobs', 'modules', table), null);
});

test('an integrator may import anything', () => {
	assert.equal(checkEdge('aweft', 'ui', table), null);
	assert.equal(checkEdge('aweft', 'server', table), null);
	assert.equal(checkEdge('testing', 'core', table), null);
});

test('nothing may import an integrator', () => {
	const v = checkEdge('core', 'testing', table);
	assert.ok(v);
	assert.equal(v.rule, 'upward-tier');
	assert.match(v.detail, /integrator/);
});

test('an unknown package is a violation rather than a silent pass', () => {
	assert.equal(checkEdge('core', 'nonexistent', table)?.rule, 'unknown-package');
	assert.equal(checkEdge('nonexistent', 'core', table)?.rule, 'unknown-package');
});

test('a package importing itself is allowed', () => {
	assert.equal(checkEdge('core', 'core', table), null);
});

test('checkGraph reports every violation, in input order', () => {
	const violations = checkGraph(
		[
			['schema', 'core'],
			['core', 'schema'],
			['ui', 'server'],
			['dom', 'core'],
		],
		table,
	);

	assert.equal(violations.length, 2);
	assert.equal(violations[0]?.rule, 'upward-tier');
	assert.equal(violations[1]?.rule, 'cross-plane');
});

test('checkGraph returns empty for a legal graph', () => {
	assert.deepEqual(checkGraph([['ui', 'core'], ['sync', 'schema']], table), []);
});
