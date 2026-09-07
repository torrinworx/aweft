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

test('an icon import resolves to the icon, and the package\'s own entries are left alone', async () => {
	// The other half of the plugin's two hooks (design 141). The loader is registered for this
	// whole run, so an import written here is resolved the way a page's would be.
	const file = join(space.dir, 'names-an-icon.tsx');
	writeFileSync(file, "import check from '@aweftjs/icons/lucide/check';\n"
		+ "import standard from '@aweftjs/icons/lucide/+standard';\n"
		+ "import { moduleFor } from '@aweftjs/icons/node';\n"
		+ 'export const icon = check;\nexport const pack = standard;\nexport const real = moduleFor;\n');

	const module = await import(pathToFileURL(file).href) as {
		icon: { body: string; width: number };
		pack: { icons: Record<string, unknown> };
		real: unknown;
	};
	assert.match(module.icon.body, /^<path /);
	assert.equal(module.icon.width, 24, 'the set\'s root size came with it');
	assert.ok(Object.keys(module.pack.icons).length > 0);
	assert.equal(typeof module.real, 'function', '@aweftjs/icons/node is a real file, not a generated one');
});

test('a specifier the generator does not recognise goes back to ordinary resolution', async () => {
	// `@aweftjs/icons/..` is not an icon import, and claiming it would resolve
	// `@iconify-json/../icons.json`, a file in this directory's own node_modules and in no set.
	// Handed back to the chain, it is Node's own refusal about the exports map.
	const file = join(space.dir, 'names-a-path.tsx');
	writeFileSync(file, "import x from '@aweftjs/icons/../x';\nexport const a = x;\n");

	await assert.rejects(() => import(pathToFileURL(file).href), (error: Error & { code?: string }) => {
		assert.equal(error.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'the package answered, not the generator');
		return true;
	});
});

test('an icon import for a set nobody installed says how to install it', async () => {
	const file = join(space.dir, 'names-a-missing-set.tsx');
	writeFileSync(file, "import home from '@aweftjs/icons/nosuchset/home';\nexport const a = home;\n");

	await assert.rejects(() => import(pathToFileURL(file).href), (error: Error) => {
		assert.match(error.message, /npm install @iconify-json\/nosuchset/);
		return true;
	});
});
