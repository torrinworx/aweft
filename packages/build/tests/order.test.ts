// The order the build compiles the packages in: every dependency before its dependents, and the
// repo's own manifests answering one such order.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { type Manifest, buildOrder, workspaceDependencies } from '../scripts/order.ts';

const manifest = (name: string, deps: string[] = [], peers: string[] = [], optional: string[] = []): [string, Manifest] => [name, {
	name: `@aweftjs/${name}`,
	dependencies: Object.fromEntries(deps.map((d) => [`@aweftjs/${d}`, '^0.1.0'])),
	peerDependencies: Object.fromEntries(peers.map((d) => [d.startsWith('@') ? d : `@aweftjs/${d}`, '^1.0.0'])),
	optionalDependencies: Object.fromEntries(optional.map((d) => [`@aweftjs/${d}`, '^0.1.0'])),
}];

test('a dependency comes before its dependent, whatever the alphabet says', () => {
	const order = buildOrder(new Map([
		manifest('auth', ['client', 'server']),
		manifest('client', ['sync']),
		manifest('server', ['sync']),
		manifest('sync', []),
	]));
	assert.deepEqual(order, ['sync', 'client', 'server', 'auth']);
});

test('the order is alphabetical where the graph leaves a choice, and a peer or optional dependency counts', () => {
	const order = buildOrder(new Map([
		manifest('zed', []),
		manifest('ant', []),
		manifest('icons', [], ['ui', '@iconify-json/lucide']),
		manifest('ui', ['ant']),
		manifest('build', [], [], ['icons']),
	]));
	assert.deepEqual(order, ['ant', 'zed', 'ui', 'icons', 'build']);
	assert.deepEqual(workspaceDependencies(manifest('icons', [], ['ui', '@iconify-json/lucide'])[1]), ['ui'], 'a third-party peer is not a workspace package');
});

test('a dependency outside the workspace, or on itself, does not hold a package back', () => {
	const order = buildOrder(new Map([manifest('one', ['one', 'elsewhere']), manifest('two', ['one'])]));
	assert.deepEqual(order, ['one', 'two']);
});

test('a cycle is refused by name, since no order can build it', () => {
	assert.throws(
		() => buildOrder(new Map([manifest('a', ['b']), manifest('b', ['a']), manifest('c', [])])),
		(error: unknown) => (error as Error).message === 'the packages a, b depend on each other in a cycle, so there is no order to build them in',
	);
});

test('the repo\'s own manifests answer one order with every package in it, dependencies first', () => {
	const packagesDir = join(import.meta.dirname, '..', '..');
	const names = readdirSync(packagesDir).filter((name) => existsSync(join(packagesDir, name, 'package.json')));
	const manifests = new Map<string, Manifest>(names.map((name) => [name, JSON.parse(readFileSync(join(packagesDir, name, 'package.json'), 'utf8')) as Manifest]));
	const order = buildOrder(manifests);
	assert.deepEqual([...order].sort(), [...names].sort(), 'every package once');
	for (const [index, name] of order.entries()) {
		for (const dep of workspaceDependencies(manifests.get(name)!)) {
			if (!manifests.has(dep)) continue;
			assert.ok(order.indexOf(dep) < index, `${dep} builds before ${name}`);
		}
	}
	// The one the alphabet gets wrong from a clean tree.
	assert.ok(order.indexOf('client') < order.indexOf('auth'));
	assert.ok(order.indexOf('ui') < order.indexOf('icons') && order.indexOf('icons') < order.indexOf('build'));
});
