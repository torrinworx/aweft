// The matcher's semantics, table driven.
//
// White box on purpose: `matches` is not public, because a policy is decided with `validate`
// and there is no second way to ask what a rule covers. The same ground is walked through the
// public surface in validate.test.ts; this file is where the edges are dense enough to be
// worth stating one per line.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ANY, REST, SELF } from '../src/pattern.ts';
import { matches } from '../src/pattern.ts';
import type { Pattern } from '../src/pattern.ts';

const cases: Array<[string, Pattern, string[], boolean]> = [
	['a literal pattern matches that path', ['a', 'b'], ['a', 'b'], true],
	['and nothing under it', ['a', 'b'], ['a', 'b', 'c'], false],
	['and nothing above it', ['a', 'b'], ['a'], false],
	['and no sibling of it', ['a', 'b'], ['a', 'z'], false],

	['ANY matches one step', ['posts', ANY, 'title'], ['posts', 'p1', 'title'], true],
	['ANY does not match zero steps', ['posts', ANY, 'title'], ['posts', 'title'], false],
	['ANY does not match two steps', ['posts', ANY, 'title'], ['posts', 'p1', 'x', 'title'], false],

	['REST matches none of the rest', ['drafts', REST], ['drafts'], true],
	['REST matches one step', ['drafts', REST], ['drafts', 'a'], true],
	['REST matches a whole subtree', ['drafts', REST], ['drafts', 'a', 'b', 'c'], true],
	['REST still needs its prefix', ['drafts', REST], ['notes'], false],
	['REST alone matches the root', [REST], [], true],
	['REST alone matches everything', [REST], ['anything', 'at', 'all'], true],

	['SELF matches the acting actor', ['users', SELF, 'name'], ['users', 'me', 'name'], true],
	['SELF matches nobody else', ['users', SELF, 'name'], ['users', 'you', 'name'], false],

	['an empty pattern is the root itself', [], [], true],
	['and nothing in it', [], ['a'], false],
];

for (const [what, pattern, path, expected] of cases) {
	test(what, () => {
		assert.equal(matches(pattern, path, 'me'), expected);
	});
}
