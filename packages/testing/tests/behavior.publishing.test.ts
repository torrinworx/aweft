// The publishing shape check (design 256).

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkPublishing } from '../src/index.ts';

/** A manifest with nothing wrong with it, for a test to spoil one field of. */
const sound = (over: Record<string, unknown> = {}) => ({
	name: '@aweftjs/core',
	version: '0.1.0',
	engines: { node: '>=24.12.0' },
	files: ['dist', 'src'],
	scripts: { prepack: 'node ../build/scripts/build-package.ts' },
	publishConfig: { access: 'public' },
	exports: {
		'.': { 'aweft-source': './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' },
	},
	...over,
});

test('a manifest in the shape design 256 describes is clean', () => {
	assert.deepEqual(checkPublishing([sound()]), []);
});

test('an entry that names one file serves a checkout or a consumer but never both', () => {
	const violations = checkPublishing([sound({ exports: { '.': './src/index.ts' } })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /one file/);
});

test('a default read before the source condition would answer first, so the order is checked', () => {
	const violations = checkPublishing([sound({
		exports: {
			'.': { default: './dist/index.js', 'aweft-source': './src/index.ts', types: './dist/index.d.ts' },
		},
	})]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /without aweft-source first/);
});

test('a missing condition is named one at a time', () => {
	const violations = checkPublishing([sound({
		exports: { '.': { 'aweft-source': './src/index.ts' } },
	})]);
	assert.equal(violations.length, 2);
	assert.match(violations.join('\n'), /without a types condition/);
	assert.match(violations.join('\n'), /without a default condition/);
});

test('a condition pointing outside the directory its half lives in is a violation', () => {
	const violations = checkPublishing([sound({
		exports: { '.': { 'aweft-source': './dist/index.js', types: './dist/index.d.ts', default: './src/index.ts' } },
	})]);
	assert.equal(violations.length, 2);
	assert.match(violations.join('\n'), /aweft-source outside src/);
	assert.match(violations.join('\n'), /default outside dist/);
});

test('dist missing from files would publish a package with no code in it', () => {
	const violations = checkPublishing([sound({ files: ['src', 'README.md'] })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /does not name dist in files/);
});

test('a package that names no Node version lets an old one install it in silence', () => {
	const violations = checkPublishing([sound({ engines: {} })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /no engines.node/);
});

test('a scoped package without public access publishes as private', () => {
	const violations = checkPublishing([sound({ publishConfig: { access: 'restricted' } })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /publishConfig.access/);
});

test('a package with no prepack could pack a stale dist', () => {
	const violations = checkPublishing([sound({ scripts: {} })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /no prepack/);
});

test('a private package can never be published', () => {
	const violations = checkPublishing([sound({ private: true })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /is private/);
});

test('the packages version in lockstep, so a version of its own is a violation for each', () => {
	const violations = checkPublishing([
		sound(),
		sound({ name: '@aweftjs/dom', version: '0.1.1' }),
	]);
	assert.equal(violations.length, 2);
	assert.match(violations.join('\n'), /do not all agree/);
});

test('a star range published means any version, which crosses a set that versions in lockstep', () => {
	const violations = checkPublishing([sound({ dependencies: { '@aweftjs/codec': '*' } })]);
	assert.equal(violations.length, 1);
	assert.match(violations[0]!, /any version/);
});

test('a third-party range is not this check\'s business', () => {
	assert.deepEqual(checkPublishing([sound({ dependencies: { ws: '*' } })]), []);
});
