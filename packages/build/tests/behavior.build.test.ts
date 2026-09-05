// The behavioral corpus, this package's share. Each case is a requirement the transform must
// meet, and each one is here because getting it wrong is a way a compiler silently changes what a
// program means.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, mount, toHtml } from '@aweftjs/dom';

import { transform } from '../src/index.ts';
import { cloningDocument, loadModule, mounted, scratch } from './fixtures.ts';

const space = scratch();
test.after(() => space.done());

const run = async (name: string, source: string): Promise<string> => {
	const built = await loadModule(space.dir, name, transform(source, { filename: `${name}.ts` }).code);
	return mounted(built.create).before;
};

test('a template made once is instanced per use, and the instances are separate nodes', async () => {
	const source = "import { h } from '@aweftjs/dom';\n"
		+ 'export const create = () => ({ item: [row(1), row(2), row(3)] });\n'
		+ "const row = (n) => h('li', { class: 'r' }, 'row ', n);";
	assert.equal(await run('separate', source), '<body><li class="r">row 1</li><li class="r">row 2</li><li class="r">row 3</li></body>');
});

test('two documents get two prototypes, so one page never holds another page\'s nodes', async () => {
	// The subtree is made inside the mount, which is where a page's nodes come from a page's own
	// document. One prototype at module scope would hand the second document the first one's nodes.
	// Both documents clone, because that is the path a prototype is actually used on: where nodes
	// do not clone the instance is built in the active document anyway and nothing is shared.
	const source = "import { h } from '@aweftjs/dom';\n"
		+ "const App = () => h('p', { class: 'p' }, 'x');\n"
		+ 'export const create = () => ({ item: h(App) });';
	const built = await loadModule(space.dir, 'twodocs', transform(source, { filename: 'twodocs.ts' }).code);

	const first = cloningDocument();
	const second = cloningDocument();
	mount(first.body, built.create().item);
	mount(second.body, built.create().item);

	assert.equal(toHtml(first.body), '<body><p class="p">x</p></body>');
	assert.equal(toHtml(second.body), '<body><p class="p">x</p></body>');
	assert.equal(first.body.firstChild!.ownerDocument, first, 'the first page holds its own nodes');
	assert.equal(second.body.firstChild!.ownerDocument, second, 'the second page holds its own nodes');
});

test('two adjacent literal text children stay two nodes, as the h calls make them', async () => {
	const source = "import { h } from '@aweftjs/dom';\nexport const create = () => ({ item: h('p', {}, 'one', 'two') });";
	const built = await loadModule(space.dir, 'adjacent', transform(source, { filename: 'adjacent.ts' }).code);
	const document = createDocument();
	mount(document.body, built.create().item);
	const paragraph = document.body.firstChild!;
	assert.equal(paragraph.firstChild!.nextSibling!.textContent, 'two',
		'the two text children are two nodes, not one merged node');
});

test('an element with nothing reactive in it is the element, not something mount has to unwrap', async () => {
	const source = "import { h } from '@aweftjs/dom';\n"
		+ "export const create = () => { const node = h('p', { class: 'x' }, 'body'); return { item: h('div', {}, node), node }; };";
	const built = await loadModule(space.dir, 'isnode', transform(source, { filename: 'isnode.ts' }).code);
	const page = built.create() as { item: unknown; node: unknown };
	assert.equal(typeof (page.node as { setAttribute?: unknown }).setAttribute, 'function',
		'a fully static subtree answers with its element, the way h does');
});

test('a varying value that turns out to be a plain string becomes text, not a signal', async () => {
	const source = "import { h } from '@aweftjs/dom';\n"
		+ "export const create = () => { const name = 'plain'; return { item: h('p', { class: 'x' }, name) }; };";
	assert.equal(await run('plainvalue', source), '<body><p class="x">plain</p></body>');
});

test('a nested subtree inside a subtree that cannot be hoisted still gets its own template', () => {
	const source = "import { h } from '@aweftjs/dom';\n"
		+ "export const a = (rest) => h('div', { ...rest }, h('p', { class: 'in' }, h('b', {}, 'deep')));";
	const out = transform(source, { filename: 'nested.ts' }).code;
	assert.match(out, /_template\(\["p",\{"class":"in"\},\["b",null,"deep"\]\], \[\]\)/);
	assert.match(out, /h\('div', \{ \.\.\.rest \}, _t0\(\[\]\)\)/);
});

test('a file that binds h itself gets no template anywhere in it', () => {
	const source = "import { h } from '@aweftjs/dom';\n"
		+ "export const a = h('p', { class: 'x' }, 'body');\n"
		+ 'export const shadow = (h) => h;';
	const out = transform(source, { filename: 'shadow.ts' }).code;
	assert.doesNotMatch(out, /_template/);
	assert.equal(out, source);
});

test('the transform is a function of its input, so two runs give the same bytes', () => {
	const source = "import { h, html } from '@aweftjs/dom';\n"
		+ "export const a = (x) => h('div', { class: 'c' }, html`<p title=\"t ${x}\">${x}</p>`);";
	const first = transform(source, { filename: 'stable.ts' });
	const second = transform(source, { filename: 'stable.ts' });
	assert.equal(second.code, first.code);
	assert.equal(second.map.toString(), first.map.toString());
});
