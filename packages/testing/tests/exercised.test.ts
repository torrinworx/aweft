// The exercised check, against a surface and a suite written here so the expected answers are
// fixed by this file. What it does over the real tree is `npm run exercised`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkExercised } from '../src/index.ts';

const surface = [
	'value open: (doc: string) => Handle',
	'value projectionOf: (rows: readonly Row[]) => Fields',
	'/node value throwaway: () => Promise<Pool>',
	'type Handle: interface Handle { readonly doc: string; }',
	'',
].join('\n');

const errors = [
	'not-open: Open the document first.',
	'not-open: Open it again; the last close tore the handle down.',
	'empty-query: Give the query at least one condition.',
	'',
].join('\n');

const suite = (text: string, path = 'packages/x/tests/store.test.ts') => [{ path, text }];

test('a suite that names every export and quotes every reason passes', () => {
	const text = `
		const handle = await open('a');
		projectionOf(rows);
		const pool = throwaway();
		assert.equal(error.reason, 'not-open');
		reason(() => find({}), "empty-query");
	`;
	assert.deepEqual(checkExercised('x', surface, errors, suite(text)), []);
});

test('an export no test names is reported by name, and so is a reason no test quotes', () => {
	const text = `
		const handle = await open('a');
		assert.equal(error.reason, 'not-open');
	`;
	assert.deepEqual(checkExercised('x', surface, errors, suite(text)), [
		'x: projectionOf is exported and no test names it',
		'x: throwaway is exported and no test names it',
		"x: 'empty-query' is a refusal and no test quotes it",
	]);
});

test('a type export is not asked for, and a value is counted once however many entries list it', () => {
	const twice = surface + 'value open: (doc: string) => Handle\n';
	assert.deepEqual(checkExercised('x', twice, '', suite('open(); projectionOf(); throwaway();')), []);
});

test('a name inside a comment is a mention, not a use', () => {
	const text = `
		// projectionOf is for drivers; throwaway too
		/* and 'empty-query' is what an empty find says */
		open('a'); assert.equal(error.reason, 'not-open');
	`;
	assert.deepEqual(checkExercised('x', surface, errors, suite(text)), [
		'x: projectionOf is exported and no test names it',
		'x: throwaway is exported and no test names it',
		"x: 'empty-query' is a refusal and no test quotes it",
	]);
});

test('the slashes of a URL in a string are not a comment, so the names after them still count', () => {
	const text = `fetch('http://x/y'); open('a'); projectionOf(); throwaway(); 'not-open'; 'empty-query';`;
	assert.deepEqual(checkExercised('x', surface, errors, suite(text)), []);
});

test('a name inside a longer word is not the name', () => {
	const text = `reopen('a'); const projectionOfRows = 1; throwawayAll(); 'not-opened'; 'empty-querying';`;
	assert.deepEqual(checkExercised('x', surface, errors, suite(text)), [
		'x: open is exported and no test names it',
		'x: projectionOf is exported and no test names it',
		'x: throwaway is exported and no test names it',
		"x: 'empty-query' is a refusal and no test quotes it",
		"x: 'not-open' is a refusal and no test quotes it",
	]);
});

test('the surface list and a white-box file do not count as exercise', () => {
	const text = `open(); projectionOf(); throwaway(); 'not-open'; 'empty-query';`;
	const files = [
		...suite(text, 'packages/x/tests/surface.test.ts'),
		...suite(text, 'packages/x/tests/internal.rows.test.ts'),
		...suite(text, 'packages/x/tests/helpers.ts'),
	];
	assert.equal(checkExercised('x', surface, errors, files).length, 5);
	assert.deepEqual(checkExercised('x', surface, errors, [...files, ...suite(text)]), []);
});

test('a reason as the whole of a regular expression counts, since the message opens with it', () => {
	const text = `open(); projectionOf(); throwaway(); assert.throws(fn, /not-open/); assert.throws(fn, /empty-query/);`;
	assert.deepEqual(checkExercised('x', surface, errors, suite(text)), []);
	const longer = `open(); projectionOf(); throwaway(); assert.throws(fn, /not-open: a/); assert.throws(fn, /an empty-query/);`;
	assert.equal(checkExercised('x', surface, errors, suite(longer)).length, 2);
});

test('a package with no refusals and an empty errors file is judged on its surface alone', () => {
	assert.deepEqual(checkExercised('x', 'value only: () => void\n', '', suite('only();')), []);
	assert.deepEqual(checkExercised('x', 'value only: () => void\n', '', suite('none();')), [
		'x: only is exported and no test names it',
	]);
});
