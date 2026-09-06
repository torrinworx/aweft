// The Node hook (design 110), and what it says when the file it was handed does not compile.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

// Written at run time rather than committed, because a file the parser cannot read is a file the
// typechecker cannot read either, and the gate typechecks this directory.
const BROKEN = `import { h } from '@aweftjs/dom';

export const Bad = () => (
	<div class="a">
		<span>unclosed
	</div>
);
`;

test('a .tsx the parser cannot read is refused by name, with the line', async () => {
	// The parser's own message says `(6:7)` and nothing about which file it read, and its stack
	// points into the parser. What a reader needs first is the file.
	const file = join(space.dir, 'unterminated.tsx');
	writeFileSync(file, BROKEN);

	await assert.rejects(
		() => import(pathToFileURL(file).href),
		(error: Error) => {
			assert.match(error.message, /unterminated\.tsx:6:7: /);
			assert.match(error.message, /Unterminated JSX contents/);
			assert.ok(error.cause instanceof Error, 'the parser\'s own error is kept as the cause');
			return true;
		},
	);
});
