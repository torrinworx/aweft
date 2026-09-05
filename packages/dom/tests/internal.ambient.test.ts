// Where `h` makes a node when nothing has said.
//
// White box on purpose: `h` is imported from its own file rather than through the package
// entry, because the entry pulls in the light tree and the light tree is what registers the
// fallback document. That is the whole point of the split, so the only way to see the case
// with no fallback is to import the file that does not reach it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { h } from '../src/h.ts';

test('h with no mount, no page and no light tree says where to get a document', () => {
	assert.equal((globalThis as { document?: unknown }).document, undefined, 'this run has no page');
	assert.throws(() => h('div'), /no document to make nodes in/);
});
