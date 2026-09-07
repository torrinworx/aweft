// The Node hook (design 110), and what it says when the file it was handed does not compile.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

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

// --- the package a file with no `h` of its own gets one from (design 147) ---------------------------

/** A `.tsx` that binds no `h` at all, and a script that mounts what it makes. */
const PROBE = 'export const make = () => <p theme="card">x</p>;\n';
/** A script that compiles no `.tsx` at all, so nothing ever reaches the load hook. */
const PLAIN = 'console.log("ran");\n';

const DRIVER = `import { createDocument, toHtml } from '@aweftjs/dom';
import { mount } from '@aweftjs/ui';

import { make } from './probe.tsx';

const document = createDocument();
mount(document.body, make());
console.log(toHtml(document.body));
`;

/**
 * Run the driver in a process of its own, with the setting the case is about.
 *
 * A process of its own because the hook runs on a worker thread, and a worker takes its
 * environment when it is made: a variable written after the process started reaches nobody. That
 * is the mechanism, not a limitation of the test.
 */
const drove = (setting?: string, script = 'driver.ts'): { out: string; error: string; status: number } => {
	const dir = join(space.dir, `default-h-${setting === undefined ? 'unset' : setting.replace(/\W+/g, '-')}`);
	mkdirSync(dir, { recursive: true });
	// The stack's specifiers resolve by walking up from the file, and a scratch directory has
	// nowhere to walk to, so the workspace's own tree is pointed at from here.
	const modules = join(dir, 'node_modules');
	if (!existsSync(modules)) symlinkSync(join(repo, 'node_modules'), modules, 'dir');
	writeFileSync(join(dir, 'probe.tsx'), PROBE);
	writeFileSync(join(dir, 'driver.ts'), DRIVER);
	writeFileSync(join(dir, 'plain.ts'), PLAIN);

	const env = { ...process.env };
	delete env['AWEFT_DEFAULT_H'];
	if (setting !== undefined) env['AWEFT_DEFAULT_H'] = setting;

	const run = spawnSync(process.execPath, ['--import', '@aweftjs/build/loader', join(dir, script)],
		{ cwd: dir, env, encoding: 'utf8' });
	return { out: run.stdout ?? '', error: run.stderr ?? '', status: run.status ?? -1 };
};

test('with nothing set, a file that binds no h gets dom\'s, so theme is a literal attribute', () => {
	const run = drove();
	assert.equal(run.status, 0, run.error);
	// `dom` knows nothing about themes, so the prop goes out as an attribute nothing reads. That is
	// the failure the setting exists to prevent.
	assert.match(run.out, /<p theme="card">x<\/p>/);
});

test('with AWEFT_DEFAULT_H set to ui, the same file gets ui\'s h and the theme becomes a class', () => {
	const run = drove('@aweftjs/ui');
	assert.equal(run.status, 0, run.error);
	assert.match(run.out, /<p class="[^"]+">x<\/p>/);
	assert.ok(!run.out.includes('theme='), 'and the prop is not on the element at all');
});

test('an empty setting is no setting, and an unknown one is refused before a file is read', () => {
	assert.match(drove('').out, /<p theme="card">x<\/p>/);

	const refused = drove('@aweftjs/preact');
	assert.notEqual(refused.status, 0);
	assert.match(refused.error, /unknown-default-h: AWEFT_DEFAULT_H=@aweftjs\/preact/);
	assert.match(refused.error, /Set it to @aweftjs\/dom or @aweftjs\/ui/);
});

test('an unknown setting is refused even by a run that compiles no .tsx at all', () => {
	// The setting is checked when the hook loads, not when a file reaches it. Checked per file, a
	// build script that happens to import no `.tsx` runs to the end with a value the loader could
	// not have honoured, and the refusal the README promises never happens.
	const plain = drove('@aweftjs/preact', 'plain.ts');
	assert.notEqual(plain.status, 0);
	assert.match(plain.error, /unknown-default-h: AWEFT_DEFAULT_H=@aweftjs\/preact/);
	assert.ok(!plain.out.includes('ran'), 'and the script never started');

	// A good one leaves that run alone.
	assert.equal(drove('@aweftjs/ui', 'plain.ts').out.trim(), 'ran');
});
