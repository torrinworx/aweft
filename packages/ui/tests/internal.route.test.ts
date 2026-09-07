// The act matcher (design 122). A pure function of a key list and a path, so the precedence table
// is checked here, once, rather than through a mounted stage that would also be proving five other
// things at the same time.
//
// Every expected answer is worked out from the rule in design 122, not read off a run.

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkActKeys, matchAct, parseQuery, pathOf, writeQuery } from '../src/route.ts';

test('a key whose whole text is the path wins before anything is split', () => {
	// Both keys match by the segment rules; the exact one is read first and never compared.
	const found = matchAct(['posts/:id', 'posts/new'], '/posts/new');
	assert.equal(found?.name, 'posts/new');
	assert.deepEqual(found?.params, {});
	assert.equal(found?.tail, '');

	// The same key with a parameter still wins for any other path.
	assert.equal(matchAct(['posts/:id', 'posts/7'], '/posts/7')?.name, 'posts/7');
	assert.equal(matchAct(['posts/:id', 'posts/new'], '/posts/7')?.name, 'posts/:id');

	// Where the two rules disagree. `a/b/*rest` matches `a/b` with an empty rest and is the longer
	// pattern, so the tiebreak alone would give it the path. The key written out in full wins.
	const exact = matchAct(['a/b', 'a/b/*rest'], 'a/b');
	assert.equal(exact?.name, 'a/b');
	assert.deepEqual(exact?.params, {}, 'and it captured nothing, because it declared nothing');
});

test('a literal segment beats a parameter, and a parameter beats a rest', () => {
	assert.equal(matchAct(['docs/:page', 'docs/intro'], 'docs/intro')?.name, 'docs/intro');
	assert.equal(matchAct(['docs/*rest', 'docs/:page'], 'docs/intro')?.name, 'docs/:page');
	assert.equal(matchAct(['docs/*rest', 'docs/intro'], 'docs/intro')?.name, 'docs/intro');

	// The comparison is position by position, so the key that is specific earlier wins even when
	// the totals are equal.
	assert.equal(matchAct([':a/x', 'x/:a'], 'x/x')?.name, 'x/:a');
});

test('the longer pattern breaks a tie, so a deeper key beats its own prefix', () => {
	assert.equal(matchAct(['posts/:id', 'posts/:id/edit'], 'posts/3/edit')?.name, 'posts/:id/edit');
	assert.equal(matchAct(['a', 'a/*rest'], 'a/b')?.name, 'a/*rest');
});

test('what a match hands back: decoded parameters, what it took and what it did not', () => {
	const found = matchAct(['posts/:id'], '/posts/hello%20world/comments');
	assert.deepEqual(found?.params, { id: 'hello world' });
	assert.equal(found?.taken, 'posts/hello world'.replace(' ', '%20'));
	assert.equal(found?.tail, 'comments');

	const rest = matchAct(['files/*path'], 'files/a/b/c');
	assert.deepEqual(rest?.params, { path: 'a/b/c' });
	assert.equal(rest?.tail, '', 'a rest segment takes everything left');

	// A rest that takes nothing still matches.
	assert.deepEqual(matchAct(['files/*path'], 'files')?.params, { path: '' });
	// A parameter needs a segment to be there.
	assert.equal(matchAct(['posts/:id'], 'posts'), null);
});

test('the index key takes the empty path and nothing else', () => {
	assert.equal(matchAct([''], '/')?.name, '');
	assert.equal(matchAct([''], '/')?.tail, '');
	// Otherwise an index act would take every path as a tail and a site with one could not 404.
	assert.equal(matchAct([''], '/a/b'), null);
	assert.equal(matchAct(['', 'missing'], '/a/b'), null);
});

test('a key with segments takes a prefix and leaves the rest, which is what nesting is', () => {
	const found = matchAct(['posts/:id'], '/posts/3/edit');
	assert.equal(found?.taken, 'posts/3');
	assert.equal(found?.tail, 'edit');
});

test('nothing matched is null, which is what makes the fallback the last thing tried', () => {
	assert.equal(matchAct(['about', 'posts/:id'], '/nowhere/at/all'), null);
	assert.equal(matchAct([], '/'), null);
});

test('a malformed escape in a segment is the segment, not a thrown navigation', () => {
	assert.deepEqual(matchAct([':name'], '/%E0%A4%A'), { name: ':name', params: { name: '%E0%A4%A' }, taken: '%E0%A4%A', tail: '' });
});

test('the act keys are checked once, and each mistake names its fix', () => {
	assert.throws(() => checkActKeys(['/about']), /act keys are relative/);
	assert.throws(() => checkActKeys(['a/*one/*two']), /at most one is allowed/);
	assert.throws(() => checkActKeys(['*rest/edit']), /move it to the end/);
	checkActKeys(['', 'about', 'posts/:id', 'files/*path']);
});

test('a query round trips through a plain object, spelled the same both ways', () => {
	assert.deepEqual(parseQuery('b=2&a=1'), { b: '2', a: '1' });
	assert.equal(writeQuery({ b: '2', a: '1' }), 'a=1&b=2');
	assert.equal(writeQuery(parseQuery('a=1&b=2')), writeQuery(parseQuery('b=2&a=1')),
		'two spellings of one query compare equal, so a reorder is not a URL change');
	assert.equal(writeQuery({}), '');
});

test('a path is read without its slashes, its query or its hash', () => {
	assert.equal(pathOf('/posts/3?x=1#top'), 'posts/3');
	assert.equal(pathOf('/'), '');
	assert.equal(pathOf('/a/b/'), 'a/b');
});

test('a key that passes the shape rules and can never match is refused at declaration', () => {
	assert.throws(() => checkActKeys(['trail/']), /ends with a slash/);
	assert.throws(() => checkActKeys(['a//b']), /has an empty segment/);
	assert.throws(() => checkActKeys([':']), /with no name after it/);
	assert.throws(() => checkActKeys(['a/*']), /with no name after it/);
	// The index key is the one empty key there is, and it is not a trailing slash.
	checkActKeys(['']);
});

test('two keys that match the same paths are refused, naming both', () => {
	// `a/:y` can never win: `a/:x` matches every path it does and one of them has to lose.
	assert.throws(() => checkActKeys(['a/:x', 'a/:y']), /"a\/:x" and "a\/:y" match the same paths/);
	assert.throws(() => checkActKeys(['*one', '*two']), /match the same paths/);
	// A literal somewhere tells them apart, and so does the kind of segment.
	checkActKeys(['a/:x', 'b/:y']);
	checkActKeys(['a/:x', 'a/*rest']);
});

test('a query value that is not text is refused where it would be written', () => {
	assert.throws(() => writeQuery({ n: 5 } as unknown as Record<string, string>), /write String\(value\)/);
	assert.throws(() => writeQuery({ q: undefined } as unknown as Record<string, string>), /write String\(value\)/);
	// The message says which key, because a query has several.
	assert.throws(() => writeQuery({ a: 'x', page: 2 } as unknown as Record<string, string>), /for "page"/);
	assert.equal(writeQuery({ n: '5' }), 'n=5', 'the text of the same number is a query');
});
