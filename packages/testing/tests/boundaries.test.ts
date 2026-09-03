import test from 'node:test';
import assert from 'node:assert/strict';

import { checkEdge, checkGraph, type PackageInfo } from '../src/boundaries.ts';

// The tier and plane cases below are about ordering, so every allowlist here is '*' and
// leaves them to the rule under test. The allowlist has its own table further down.
const table: Record<string, PackageInfo> = {
	core: { tier: 1, plane: 'isomorphic', imports: '*' },
	schema: { tier: 2, plane: 'isomorphic', imports: '*' },
	sync: { tier: 3, plane: 'isomorphic', imports: '*' },
	store: { tier: 3, plane: 'isomorphic', imports: '*' },
	modules: { tier: 4, plane: 'isomorphic', imports: '*' },
	dom: { tier: 5, plane: 'client', imports: '*' },
	server: { tier: 5, plane: 'server', imports: '*' },
	ui: { tier: 6, plane: 'client', imports: '*' },
	jobs: { tier: 6, plane: 'server', imports: '*' },
	testing: { tier: 'integrator', plane: 'isomorphic', imports: '*' },
	aweft: { tier: 'integrator', plane: 'isomorphic', imports: '*' },
};

// Three packages the tier and plane rules have nothing to say about: b sits above both a
// and c, and all three are isomorphic. Only the allowlist separates b -> a from b -> c.
const allowlist: Record<string, PackageInfo> = {
	a: { tier: 1, plane: 'isomorphic', imports: [] },
	c: { tier: 1, plane: 'isomorphic', imports: [] },
	b: { tier: 2, plane: 'isomorphic', imports: ['a'] },
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

test('an edge the allowlist omits is a violation, tier and plane notwithstanding', () => {
	assert.equal(checkEdge('b', 'a', allowlist), null);

	const v = checkEdge('b', 'c', allowlist);
	assert.ok(v);
	assert.equal(v.rule, 'not-allowed');
	assert.match(v.detail, /c is not in the imports allowlist for b/);
});

test('an allowlist of "*" leaves the edge to the tier and plane rules', () => {
	const wide: Record<string, PackageInfo> = {
		...allowlist,
		b: { tier: 2, plane: 'isomorphic', imports: '*' },
	};

	assert.equal(checkEdge('b', 'c', wide), null);
});

test('a wrong tier keeps its own rule name rather than the allowlist one', () => {
	// a lists nothing, so both rules apply to a -> b. The tier answer is the useful one.
	assert.equal(checkEdge('a', 'b', allowlist)?.rule, 'upward-tier');
});
