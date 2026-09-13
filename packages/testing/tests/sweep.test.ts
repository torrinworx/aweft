// The operator sweep's finder and flip, against text written here so the answers are fixed by
// this file. What the sweep does over a package is `npm run sweep -- <package>`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { type Site, flipSite, sweepSites } from '../src/index.ts';

const shape = (site: Site): string => `${String(site.line)}:${String(site.column)} ${site.from.trim()}->${site.to.trim()}`;

test('every operator on a line is a site, in column order, each with its nearest wrong neighbour', () => {
	const line = 'if (a === b && c !== d || e < f) return true;';
	assert.deepEqual(sweepSites(line).map(shape), [
		'1:5 ===->!==',
		'1:11 &&->||',
		'1:16 !==->===',
		'1:22 ||->&&',
		'1:27 <-><=',
		'1:33 return true->return false',
	]);
});

test('the wide comparisons flip to the narrow ones and back, and a wide one is never also a narrow one', () => {
	assert.deepEqual(sweepSites('x <= y').map(shape), ['1:1 <=-><']);
	assert.deepEqual(sweepSites('x >= y').map(shape), ['1:1 >=->>']);
	assert.deepEqual(sweepSites('x > y').map(shape), ['1:1 >->>=']);
	assert.deepEqual(sweepSites('return false;').map(shape), ['1:0 return false->return true']);
});

test('an operator needs a space on both sides, so a type parameter and a shift are not sites', () => {
	assert.deepEqual(sweepSites('const a: Map<string, number> = x<<2;'), []);
	assert.deepEqual(sweepSites('const b = a<b;'), []);
});

test('a comment line and a line carrying a comment have no sites', () => {
	const text = [
		'// a < b is the rule',
		' * and a === b too',
		'/* or a && b */',
		'if (a < b) go(); // a < b',
	].join('\n');
	assert.deepEqual(sweepSites(text), []);
});

test('the slashes of a URL in a string do not make the line a comment', () => {
	assert.deepEqual(sweepSites(`if (url === 'http://x' && ok) go();`).map(shape), ['1:7 ===->!==', '1:22 &&->||']);
});

test('an operator inside a string is not a site, and one after the string still is', () => {
	assert.deepEqual(sweepSites(`throw new Error('a < b'); if (c < d) go();`).map(shape), ['1:31 <-><=']);
	assert.deepEqual(sweepSites('const s = `x === y`; return true;').map(shape), ['1:21 return true->return false']);
});

test('the line number is the one a reader opens the file at', () => {
	const text = ['const a = 1;', '', 'if (a > 0) {', '\treturn false;', '}'].join('\n');
	assert.deepEqual(sweepSites(text).map(shape), ['3:5 >->>=', '4:1 return false->return true']);
});

test('a flip changes that one operator and nothing else', () => {
	const text = ['if (a < b && c < d) {', '\treturn true;', '}'].join('\n');
	const [first, second, third, fourth] = sweepSites(text);
	assert.equal(flipSite(text, first!), ['if (a <= b && c < d) {', '\treturn true;', '}'].join('\n'));
	assert.equal(flipSite(text, second!), ['if (a < b || c < d) {', '\treturn true;', '}'].join('\n'));
	assert.equal(flipSite(text, third!), ['if (a < b && c <= d) {', '\treturn true;', '}'].join('\n'));
	assert.equal(flipSite(text, fourth!), ['if (a < b && c < d) {', '\treturn false;', '}'].join('\n'));
	assert.equal(text, ['if (a < b && c < d) {', '\treturn true;', '}'].join('\n'), 'the source is not touched');
});

test('a flip refuses a site that is not where it says', () => {
	assert.throws(
		() => flipSite('if (a < b) go();', { line: 1, column: 0, from: ' < ', to: ' <= ' }),
		{ message: /no " < " at 1:0/ },
	);
});
