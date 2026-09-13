// The build finds the text a page shows (design 277): what the `text` option moves, what it
// leaves, what it answers, and what the plugin writes.
//
// That a wrapped page renders and hydrates like an unwrapped one is `ui-equivalence.test.ts`,
// which runs the `ui` fixture with the option on as well; that the string a token shows is the
// catalog's is `ui`'s own suite.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aweft, transform } from '../src/index.ts';
import { scratch } from './fixtures.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const space = scratch();
after(() => space.done());

const compile = (source: string, on = true): { code: string; text: readonly string[] } => {
	const out = transform(source, { filename: 'page.tsx', ...(on ? { text: true } : {}) });
	return { code: out.code, text: out.text };
};

const ui = "import { h } from '@aweftjs/ui';";

// --- what moves ------------------------------------------------------------------------------------

test('a text child and a text prop become text() calls, in each of the three notations', () => {
	const jsx = compile(`${ui}\nexport const a = <input id="q" placeholder="Search" name="q" />;\nexport const b = <p>Save changes</p>;`);
	assert.match(jsx.code, /^import \{ .*text as _text.* \} from '@aweftjs\/ui';$/m, 'text comes in under a fresh name');
	assert.match(jsx.code, /placeholder: _text\("Search"\)/);
	assert.match(jsx.code, /name: "q"/, 'a name is not text');
	assert.match(jsx.code, /_text\("Save changes"\)/);
	assert.deepEqual(jsx.text, ['Search', 'Save changes']);

	const markup = compile("import { h, html } from '@aweftjs/ui';\nexport const a = html`<em title=\"Mark\">Emph</em>`;");
	assert.match(markup.code, /title: _text\("Mark"\)/);
	assert.match(markup.code, /_text\("Emph"\)/);
	assert.deepEqual(markup.text, ['Mark', 'Emph']);

	const call = compile(`${ui}\nexport const a = h('button', { label: 'Go', type: 'quiet' }, 'Press');`);
	assert.match(call.code, /label: _text\("Go"\)/);
	assert.match(call.code, /type: "quiet"/);
	assert.match(call.code, /_text\("Press"\)/);
	assert.deepEqual(call.text, ['Go', 'Press']);
});

test('the wrapped literal is a hole in the hoisted template', () => {
	const { code } = compile(`${ui}\nexport const a = <li class="row">Save</li>;`);
	assert.match(code, /_template\(\["li",null\], \[\["props",\[\]\],\["child",\[\],-1\]\]\)/, 'the text left the prototype');
	assert.match(code, /_t0\(\[\{ class: "row" \}, _text\("Save"\)\]\)/, 'and is applied per instance');
});

test('an h call that cannot hoist and holds a wrapped literal is printed from the model', () => {
	const { code, text } = compile(`${ui}\nexport const a = h('p', { ...rest, title: 'Spread' }, 'Child still');`);
	assert.match(code, /h\("p", \{ \.\.\.rest, title: "Spread" \}, _text\("Child still"\)\)/);
	assert.deepEqual(text, ['Child still'], 'the spread leaves the props alone and the child moves');
});

test('a hand-written text() is left as written, and its key is answered, with the context folded in', () => {
	const source = "import { h, text } from '@aweftjs/ui';\n"
		+ "export const a = <p>{text('Hello {name}', { name })}</p>;\n"
		+ "export const b = text('Close', { context: 'dialog' });\n"
		+ "export const c = text(dynamic);";
	const { code, text } = compile(source);
	assert.match(code, /text\('Hello \{name\}', \{ name \}\)/, 'the call is the call that was written');
	assert.ok(!code.includes('_text'), 'the file\'s own binding is the one the wrap uses too');
	assert.deepEqual(text, ['Hello {name}', 'Close|dialog']);
});

test('a hand-written text() is answered whatever h the file has, and a helper with no element at all', () => {
	const helper = transform("import { text } from '@aweftjs/ui';\nexport const save = text('Hand written');", { filename: 'helper.ts', text: true });
	assert.deepEqual(helper.text, ['Hand written']);
	assert.ok(!helper.code.includes('_text'), 'nothing to wrap, nothing imported');
	const dom = transform("import { h } from '@aweftjs/dom';\nimport { text } from '@aweftjs/ui';\nexport const a = <p>{text('Written')}</p>;", { filename: 'page.tsx', text: true });
	assert.deepEqual(dom.text, ['Written'], 'a dom file still names its message');
	assert.ok(!dom.code.includes('_text'), 'and its literals are left alone');
});

test('a file that binds text from ui wraps with that binding', () => {
	const { code } = compile("import { h, text as t } from '@aweftjs/ui';\nexport const a = <p>Save</p>;");
	assert.match(code, /t\("Save"\)/);
	assert.ok(!code.includes('text as _text'), 'no second import');
});

// --- what is left --------------------------------------------------------------------------------

test('a dom file is untouched', () => {
	const source = "import { h } from '@aweftjs/dom';\nexport const a = <p title=\"Hi\">Save</p>;";
	assert.equal(compile(source).code, compile(source, false).code);
	assert.deepEqual(compile(source).text, []);
});

test('with the option off nothing changes and no key is answered', () => {
	const source = `${ui}\nexport const a = <p title="Hi">Save</p>;`;
	const off = compile(source, false);
	assert.ok(!off.code.includes('_text'));
	assert.deepEqual(off.text, []);
});

test('text with no letter in it is left in the template', () => {
	const { code, text } = compile(`${ui}\nexport const a = <p alt="1234">{x} | {y} ... 42</p>;`);
	assert.ok(!code.includes('_text'), code);
	assert.deepEqual(text, []);
});

test('a literal translate="no" leaves the element and everything under it alone', () => {
	const { code, text } = compile(`${ui}\nexport const a = <p translate="no" title="Code"><code>let x = 1</code> is code</p>;\nexport const b = <p>But this moves</p>;`);
	assert.ok(!code.includes('_text("Code")'));
	assert.ok(!code.includes('_text("let x = 1")'));
	assert.ok(!code.includes('_text(" is code")'));
	assert.match(code, /_text\("But this moves"\)/);
	assert.deepEqual(text, ['But this moves']);
});

test('a prop given as an expression is left, whatever it holds', () => {
	const { code, text } = compile(`${ui}\nconst word = 'Save';\nexport const a = <p title={word}>{word}</p>;`);
	assert.ok(!code.includes('_text'));
	assert.deepEqual(text, []);
});

test('a prop off the list is left, even with words in it', () => {
	const { code, text } = compile(`${ui}\nexport const a = <a href="the docs" class="Save now" data-note="Hello there">1</a>;`);
	assert.ok(!code.includes('_text'));
	assert.deepEqual(text, []);
});

test('a key is answered once however many times it is written', () => {
	const { text } = compile(`${ui}\nexport const a = <p>Save</p>;\nexport const b = <p title="Save">Save</p>;`);
	assert.deepEqual(text, ['Save']);
});

// --- the plugin ------------------------------------------------------------------------------------

/** The keys the installed stack packages ship, which the plugin folds into every source catalog. */
const shipped = (): Record<string, string> => {
	const keys: Record<string, string> = {};
	for (const name of readdirSync(join(repo, 'node_modules', '@aweftjs')).sort()) {
		const file = join(repo, 'node_modules', '@aweftjs', name, 'text.json');
		if (!existsSync(file)) continue;
		for (const key of Object.keys(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)) keys[key] = `${name}:${key}`;
	}
	return keys;
};

test('the plugin writes text/source.json with the files per key, the shipped catalogs folded in, and warns about each language catalog', async () => {
	const root = join(space.dir, 'plugin');
	mkdirSync(join(root, 'text'), { recursive: true });
	const library = shipped();
	assert.ok('Previous' in library && 'Sign in' in library, 'ui and auth ship a catalog');
	writeFileSync(join(root, 'text', 'fr.json'), JSON.stringify({ ...library, Save: 'Enregistrer', Old: 'Vieux' }));
	writeFileSync(join(root, 'text', 'de.json'), JSON.stringify({ ...library, Save: 'Speichern', 'Look up': 'Nachschlagen' }));

	const plugin = aweft({ text: true });
	plugin.configResolved({ root });
	plugin.transform(`${ui}\nexport const a = <p>Save</p>;`, join(root, 'src', 'a.tsx'));
	plugin.transform(`${ui}\nexport const b = <input id="q" placeholder="Look up" aria-label="Search" />;\nexport const c = <p>Save</p>;`, join(root, 'src', 'b.tsx'));
	plugin.transform('export const d = 1;', join(root, 'src', 'd.css'));

	const warned: string[] = [];
	const real = console.warn;
	console.warn = (line: unknown): void => { warned.push(String(line)); };
	try {
		await plugin.closeBundle();
	} finally {
		console.warn = real;
	}

	const written = JSON.parse(readFileSync(join(root, 'text', 'source.json'), 'utf8')) as Record<string, string[]>;
	assert.deepEqual(written['Save'], ['src/a.tsx', 'src/b.tsx']);
	assert.deepEqual(written['Look up'], ['src/b.tsx']);
	assert.deepEqual(written['Search'], ['@aweftjs/ui/text.json', 'src/b.tsx'], 'a key the page and the library both show names both');
	assert.deepEqual(written['Previous'], ['@aweftjs/ui/text.json']);
	assert.deepEqual(written['Sign in'], ['@aweftjs/auth/text.json']);
	assert.deepEqual(Object.keys(written).sort(), [...new Set([...Object.keys(library), 'Save', 'Look up'])].sort());
	assert.deepEqual(warned, ['aweft text: text/fr.json lacks 1: "Look up"; holds 1 nothing uses: "Old"'],
		'de has every key and nothing extra, so it is not mentioned');
});

test('a file under node_modules is never wrapped, and its keys are not recorded', async () => {
	const root = join(space.dir, 'plugin-installed');
	mkdirSync(root, { recursive: true });
	const plugin = aweft({ text: true });
	plugin.configResolved({ root });
	const out = plugin.transform(`${ui}\nexport const a = h('p', {}, 'Save');`, join(root, 'node_modules', '@aweftjs', 'auth', 'dist', 'a.js'));
	assert.ok(out !== null && !out.code.includes('_text'), 'compiled output is read as it is');
	await plugin.closeBundle();
	const written = JSON.parse(readFileSync(join(root, 'text', 'source.json'), 'utf8')) as Record<string, string[]>;
	assert.ok(!('Save' in written));
});

test('a language catalog that is not an object is a warning, never a failure', async () => {
	const root = join(space.dir, 'plugin-null');
	mkdirSync(join(root, 'text'), { recursive: true });
	writeFileSync(join(root, 'text', 'fr.json'), 'null');
	writeFileSync(join(root, 'text', 'de.json'), '["a"]');
	const plugin = aweft({ text: true });
	plugin.configResolved({ root });
	plugin.transform(`${ui}\nexport const a = <p>Save</p>;`, join(root, 'a.tsx'));
	const warned: string[] = [];
	const real = console.warn;
	console.warn = (line: unknown): void => { warned.push(String(line)); };
	try {
		await plugin.closeBundle();
	} finally {
		console.warn = real;
	}
	assert.equal(warned.length, 2);
	assert.match(warned[0]!, /text\/de\.json could not be read: a catalog is an object/);
	assert.match(warned[1]!, /text\/fr\.json could not be read: a catalog is an object/);
});

test('with the option off the plugin writes nothing', async () => {
	const root = join(space.dir, 'plugin-off');
	mkdirSync(root, { recursive: true });
	const plugin = aweft({});
	plugin.configResolved({ root });
	plugin.transform(`${ui}\nexport const a = <p>Save</p>;`, join(root, 'a.tsx'));
	await plugin.closeBundle();
	assert.ok(!existsSync(join(root, 'text')));
});

// --- the loader ------------------------------------------------------------------------------------

const PROBE = `import { h, context, render } from '@aweftjs/ui';
export const page = () => render(h('p', { title: 'Hi' }, 'Save'), { context: context({ locale: 'fr', catalog: { Save: 'Enregistrer', Hi: 'Salut' } }) });
`;
const DRIVER = `import { page } from './probe.tsx';
console.log(await page());
`;

const drove = (setting?: string): { out: string; error: string; status: number } => {
	const dir = join(space.dir, `text-${setting === undefined ? 'unset' : setting.replace(/\W+/g, '-')}`);
	mkdirSync(dir, { recursive: true });
	const modules = join(dir, 'node_modules');
	if (!existsSync(modules)) symlinkSync(join(repo, 'node_modules'), modules, 'dir');
	writeFileSync(join(dir, 'probe.tsx'), PROBE);
	writeFileSync(join(dir, 'driver.ts'), DRIVER);
	const env = { ...process.env };
	delete env['AWEFT_TEXT'];
	if (setting !== undefined) env['AWEFT_TEXT'] = setting;
	const run = spawnSync(process.execPath, ['--import', '@aweftjs/build/loader', join(dir, 'driver.ts')],
		{ cwd: dir, env, encoding: 'utf8' });
	return { out: run.stdout ?? '', error: run.stderr ?? '', status: run.status ?? -1 };
};

test('the loader reads AWEFT_TEXT, and refuses a value that is neither a yes nor a no', () => {
	const off = drove();
	assert.equal(off.status, 0, off.error);
	assert.match(off.out, /<p title="Hi">Save<\/p>/, 'unset, the literal is the literal');

	const on = drove('1');
	assert.equal(on.status, 0, on.error);
	assert.match(on.out, /<p title="Salut">.*Enregistrer.*<\/p>/, 'set, the file compiles against the catalog the page hands its render');

	const refused = drove('maybe');
	assert.notEqual(refused.status, 0);
	assert.match(refused.error, /unknown-text-setting: AWEFT_TEXT=maybe/);
	assert.match(refused.error, /Set it to 1/);
});
