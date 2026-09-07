// The document builder and the noindex reading (design 149), over shells written by hand.
//
// Each shell here is the smallest one that can state the rule under test, so a failure names the
// rule rather than a bundler's whole output.

import test from 'node:test';
import assert from 'node:assert/strict';

import type { HeadList, HeadTag } from '@aweftjs/ui';

import { buildDocument, noindexOf } from '../src/document.ts';

const parts = (over: Partial<Parameters<typeof buildDocument>[1]> = {}): Parameters<typeof buildDocument>[1] =>
	({ body: '<p>page</p>', css: '.a{}', head: '<title>Page</title>', title: 'Page', ...over });

test('the run goes behind a leading charset and in front of everything else', () => {
	const html = buildDocument('<html><head><meta charset="utf-8"><link rel="icon" href="/i"></head><body></body></html>', parts());
	assert.equal(
		html,
		'<html><head><meta charset="utf-8"><style data-aweft>.a{}</style><title>Page</title>'
		+ '<link rel="icon" href="/i"></head><body data-aweft-ssg=""><p>page</p></body></html>',
	);
});

test('a charset the shell did not write first is left where it is', () => {
	// Design 127: the one tag that may not go behind the run is a charset in the first bytes.
	// One that is already second is not that tag, and moving the run behind it would be wrong.
	const html = buildDocument('<html><head><link rel="icon" href="/i"><meta charset="utf-8"></head><body></body></html>', parts());
	assert.match(html, /<head><style data-aweft>\.a\{\}<\/style><title>Page<\/title><link rel="icon"/);
});

test('the shell\'s title goes when the page declares one, and stays when it does not', () => {
	const shell = '<html><head><title>the shell</title></head><body></body></html>';

	const declared = buildDocument(shell, parts());
	assert.deepEqual([...declared.matchAll(/<title[^>]*>([^<]*)</g)].map((one) => one[1]), ['Page']);

	const silent = buildDocument(shell, parts({ title: null, head: '' }));
	assert.deepEqual([...silent.matchAll(/<title[^>]*>([^<]*)</g)].map((one) => one[1]), ['the shell'],
		'so a shell title is the fallback for a page that declares none');
});

test('the body tag keeps its own attributes and gains the stamp once', () => {
	const html = buildDocument('<html><head></head><body class="page"></body></html>', parts());
	assert.match(html, /<body class="page" data-aweft-ssg=""><p>page<\/p><\/body>/);

	// Writing a document from one this package already wrote does not stamp it twice.
	assert.match(
		buildDocument('<html><head></head><body data-aweft-ssg=""></body></html>', parts()),
		/<body data-aweft-ssg=""><p>page<\/p><\/body>/,
	);
});

test('whitespace after </body> goes, because a parser moves it back into the body', () => {
	const html = buildDocument('<html><head></head><body>\n\t</body>\n</html>\n', parts());
	assert.ok(html.endsWith('<p>page</p></body></html>'));
});

test('a shell with no head or no body is refused, and so is one whose body holds markup', () => {
	for (const [shell, reason] of [
		['<html><body></body></html>', 'shell-head'],
		['<html><head></head></html>', 'shell-body'],
		['<html><body></body><head></head></html>', 'shell-body'],
		['<html><head></head><body><div id="app"></div></body></html>', 'shell-body-content'],
	] as const) {
		assert.throws(() => buildDocument(shell, parts()), (error: Error & { reason?: string; fix?: string }) => {
			assert.equal(error.reason, reason);
			assert.ok(String(error.fix).length > 0, 'and it says what to do about it');
			return true;
		});
	}
});

/** A head list with nothing in it but the tags a test hands it. */
const listOf = (tags: readonly HeadTag[]): HeadList => ({ items: tags } as unknown as HeadList);

const robots = (content: unknown, depth = 0): HeadTag =>
	({ kind: 'meta', group: 'meta:name=robots', depth, attrs: { name: 'robots', content } });

test('noindex is read off the head list, deepest and then latest', () => {
	assert.equal(noindexOf(listOf([])), false);
	assert.equal(noindexOf(listOf([robots('index')])), false);
	assert.equal(noindexOf(listOf([robots('noindex, nofollow')])), true);
	assert.equal(noindexOf(listOf([robots('noindex'), robots('index')])), false, 'the later one wins at one depth');
	assert.equal(noindexOf(listOf([robots('index', 1), robots('noindex', 0)])), false,
		'and a page inside a layout beats it, however late the layout is');
	assert.equal(noindexOf(listOf([robots('index', 0), robots('noindex', 1)])), true);
});

test('a robots tag behind a cell is read through it, and a title is not a robots tag', () => {
	assert.equal(noindexOf(listOf([robots({ get: () => 'NOINDEX' })])), true);
	assert.equal(noindexOf(listOf([
		{ kind: 'title', group: 'title', depth: 0, attrs: {}, text: 'noindex' },
		{ kind: 'meta', group: 'meta:name=description', depth: 0, attrs: { name: 'description', content: 'noindex' } },
	])), false);
});

test('a shell with two titles loses both when the page declares one', () => {
	// The README says the document carries exactly one title. A shell that carries two, which is
	// what a hand-edited one or a plugin that adds a default does, kept the second one.
	const shell = '<html><head><title>one</title><meta name="x" content="y"><title>two</title></head><body></body></html>';
	const html = buildDocument(shell, parts());
	assert.deepEqual([...html.matchAll(/<title[^>]*>([^<]*)</g)].map((one) => one[1]), ['Page']);
	assert.ok(html.includes('<meta name="x" content="y">'), 'and nothing else in the head went with them');
});
