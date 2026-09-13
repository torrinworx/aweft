// The second hoistable identity (design 108): a `ui` file compiles to a `ui` template, and the
// page it renders is the page it rendered before.
//
// Three comparisons, because three things could have gone wrong. The transformed `ui` file has to
// mean what the untransformed one means. The JSX has to mean what the `h` calls mean. And the
// `ui` file has to render what the same page written against `dom` renders, which is the claim
// that a wrapping `h` changes the ergonomics and not the output.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';

import { createDocument, parseHtml, toHtml } from '@aweftjs/dom';
import type { LightDocument, LightElement } from '@aweftjs/dom';
import { context, hydrate, mount, render } from '@aweftjs/ui';

import { transform } from '../src/index.ts';
import { loadModule, scratch } from './fixtures.ts';

const space = scratch();
after(() => space.done());

/** The page as `h` calls, so it runs with no build step at all. */
const uiCalls = `
import { h } from '@aweftjs/ui';
import { mutable, mutableArray } from '@aweftjs/core';

export const create = () => {
	const tone = mutable('plain');
	const rows = mutableArray(['one', 'two']);
	const clicks = mutable(0);
	const Row = (props) => h('li', { theme: 'row' }, props.each);

	return {
		item: h('section', { theme: 'panel', class: 'page', style: { padding: 12 } },
			h('header', { class: 'head' },
				h('h1', {}, 'Gallery'),
				h('button', { theme: ['button', tone], onClick: () => clicks.set(clicks.get() + 1) }, 'press'),
			),
			h('ul', { theme: 'list' }, h(Row, { each: rows })),
			h('p', { theme: 'muted' }, clicks),
		),
		edit: () => { tone.set('accent'); rows.push('three'); clicks.set(1); },
	};
};
`;

/** The same page in JSX. */
const uiJsx = `
import { h } from '@aweftjs/ui';
import { mutable, mutableArray } from '@aweftjs/core';

export const create = () => {
	const tone = mutable('plain');
	const rows = mutableArray(['one', 'two']);
	const clicks = mutable(0);
	const Row = (props) => <li theme="row">{props.each}</li>;

	return {
		item: <section theme="panel" class="page" style={{ padding: 12 }}>
			<header class="head">
				<h1>Gallery</h1>
				<button theme={['button', tone]} onClick={() => clicks.set(clicks.get() + 1)}>press</button>
			</header>
			<ul theme="list"><Row each={rows} /></ul>
			<p theme="muted">{clicks}</p>
		</section>,
		edit: () => { tone.set('accent'); rows.push('three'); clicks.set(1); },
	};
};
`;

/**
 * The same page written against `dom`, with the classes `ui` would have generated written out.
 *
 * The class names are `aw0` upward in the order the elements ask for one, which is mount order,
 * and the style is the declaration `ui` writes for `{ padding: 12 }`. Both come from the design
 * rather than from a run: if `ui` ever generates something else, this fixture is what says so.
 */
const domCalls = `
import { h } from '@aweftjs/dom';
import { mutable, mutableArray } from '@aweftjs/core';

export const create = () => {
	const rows = mutableArray(['one', 'two']);
	const clicks = mutable(0);
	const tone = mutable('aw1');
	const Row = (props) => h('li', { class: 'aw4' }, props.each);

	return {
		item: h('section', { class: 'page aw0', style: 'padding: 12px;' },
			h('header', { class: 'head' },
				h('h1', {}, 'Gallery'),
				h('button', { class: tone }, 'press'),
			),
			h('ul', { class: 'aw2' }, h(Row, { each: rows })),
			h('p', { class: 'aw3' }, clicks),
		),
		edit: () => { tone.set('aw5'); rows.push('three'); clicks.set(1); },
	};
};
`;

interface Page {
	readonly item: unknown;
	readonly edit?: () => void;
}

const mountedWith = (
	create: () => Page,
	how: (target: LightElement, item: unknown) => () => void,
): { before: string; after: string } => {
	const document = createDocument();
	const page = create();
	const stop = how(document.body, page.item);
	const before = toHtml(document.body.childNodes);
	page.edit?.();
	const now = toHtml(document.body.childNodes);
	stop();
	return { before, after: now };
};

const uiMounted = (create: () => Page): { before: string; after: string } =>
	mountedWith(create, (body, item) => {
		const stop = mount(body, item);
		return () => { stop(); };
	});

const domMounted = (create: () => Page): { before: string; after: string } =>
	mountedWith(create, (body, item) => {
		const stop = mount(body, item);
		return () => { stop(); };
	});

const uiRendered = async (create: () => Page): Promise<{ markup: string; css: string }> => {
	const own = context();
	const markup = await render(create().item, { context: own });
	return { markup, css: own.theme.markup() };
};

/** Hydrate the markup a render wrote, and answer the tree plus how many server nodes survived. */
const uiHydrated = async (create: () => Page, markup: string): Promise<{ markup: string; kept: number }> => {
	const document: LightDocument = createDocument();
	for (const node of parseHtml(markup, document)) document.body.appendChild(node);
	const before = new Set<unknown>();
	const walk = (node: { firstChild: unknown; nextSibling: unknown } | null): void => {
		for (let n = node; n !== null; n = n.nextSibling as typeof n) {
			before.add(n);
			walk((n as { firstChild: typeof n }).firstChild);
		}
	};
	walk(document.body.firstChild as never);

	const stop = hydrate(document.body, create().item);
	const after: unknown[] = [];
	const collect = (node: { firstChild: unknown; nextSibling: unknown } | null): void => {
		for (let n = node; n !== null; n = n.nextSibling as typeof n) {
			after.push(n);
			collect((n as { firstChild: typeof n }).firstChild);
		}
	};
	collect(document.body.firstChild as never);
	const out = toHtml(document.body.childNodes);
	stop();
	return { markup: out, kept: after.filter((node) => before.has(node)).length };
};

const compare = async (name: string, a: () => Page, b: () => Page): Promise<void> => {
	const one = await uiRendered(a);
	const two = await uiRendered(b);
	assert.equal(two.markup, one.markup, `${name}: the rendered markup differs`);
	assert.equal(two.css, one.css, `${name}: the generated CSS differs`);

	const mountedA = uiMounted(a);
	const mountedB = uiMounted(b);
	assert.equal(mountedB.before, mountedA.before, `${name}: the mounted tree differs`);
	assert.equal(mountedB.after, mountedA.after, `${name}: the tree after an edit differs`);

	const hydratedA = await uiHydrated(a, one.markup);
	const hydratedB = await uiHydrated(b, two.markup);
	assert.equal(hydratedB.markup, hydratedA.markup, `${name}: the hydrated tree differs`);
	assert.equal(hydratedB.kept, hydratedA.kept, `${name}: hydration adopted a different number of nodes`);
	assert.ok(hydratedA.kept > 0, `${name}: the fixture hydrates nothing, so it proves nothing`);
};

test('a ui file hoists, and the transformed page means what the written one means', async () => {
	const plain = await loadModule(space.dir, 'uiplain', uiCalls);
	const compiled = transform(uiCalls, { filename: 'page.ts' });
	assert.match(compiled.code, /import \{ template as _template \} from '@aweftjs\/ui';/,
		'the template comes from ui, not from dom');
	const built = await loadModule(space.dir, 'uibuilt', compiled.code);
	await compare('ui calls', plain.create as () => Page, built.create as () => Page);
});

test('JSX in a ui file means the same as the h calls', async () => {
	const plain = await loadModule(space.dir, 'uijsxplain', uiCalls);
	const compiled = transform(uiJsx, { filename: 'page.tsx' });
	const built = await loadModule(space.dir, 'uijsxbuilt', compiled.code);
	await compare('ui jsx', plain.create as () => Page, built.create as () => Page);
});

/** The markers a static render brackets a dynamic mount with. They are not page content. */
const withoutMarkers = (markup: string): string => markup.split('<!--[-->').join('').split('<!--]-->').join('');

test('a ui file and a dom file render the same page', async () => {
	const ui = await loadModule(space.dir, 'uisame', uiCalls);
	const dom = await loadModule(space.dir, 'domsame', domCalls);

	// The page is the same; where the two differ is how much of it is a dynamic mount, and a
	// themed element is one (design 107), so the `ui` page carries more markers. The markers are
	// what a hydration reads and not what a reader sees, so they come out of the comparison.
	const rendered = await uiRendered(ui.create as () => Page);
	const plain = await render((dom.create as () => Page)().item, { context: context() });
	assert.equal(withoutMarkers(plain), withoutMarkers(rendered.markup));

	// Mounted, there are no markers at all, so this comparison is byte for byte.
	const a = uiMounted(ui.create as () => Page);
	const b = domMounted(dom.create as () => Page);
	assert.equal(b.before, a.before);
	assert.equal(b.after, a.after);
});

test('a ui file puts every property in the edits, and keeps the shape in the prototype', () => {
	const source = `
import { h } from '@aweftjs/ui';
export const page = h('div', { class: 'card', id: 'one' }, h('span', {}, 'hi'));
`;
	const compiled = transform(source, { filename: 'page.ts' });
	// The shape hoists: two elements and the text are in the spec.
	assert.match(compiled.code, /template as _template/);
	assert.match(compiled.code, /\["div",null,\["span",null,"hi"\]\]/);
	// And nothing literal is in the prototype's attributes, because only `ui` knows which names
	// it claims off an element (design 108).
	assert.doesNotMatch(compiled.code, /"card"\s*\}/, 'a literal class must not be a prototype attribute');
	assert.match(compiled.code, /_t0\(\[\{ class: "card", id: "one" \}\]\)/);
});

test('a dom file is unchanged by ui knowing about ui', () => {
	const source = `
import { h } from '@aweftjs/dom';
export const page = h('div', { class: 'card', id: 'one' }, h('span', {}, 'hi'));
`;
	const compiled = transform(source, { filename: 'page.ts' });
	assert.match(compiled.code, /template as _template \} from '@aweftjs\/dom'/);
	assert.match(compiled.code, /\{"class":"card","id":"one"\}/, 'a dom file still puts its literals in the prototype');
});

test('a file holding both packages\' h hoists through its own and leaves the other alone', () => {
	const source = `
import { h } from '@aweftjs/ui';
import { h as domH } from '@aweftjs/dom';
export const a = h('div', { theme: 'x' }, 'ui');
export const b = domH('div', { class: 'y' }, 'dom');
`;
	const compiled = transform(source, { filename: 'page.ts' });
	assert.match(compiled.code, /template as _template \} from '@aweftjs\/ui'/);
	assert.match(compiled.code, /export const b = domH\('div', \{ class: 'y' \}, 'dom'\);/,
		'the other package\'s call is left exactly as it was written');
});

test('a file that binds no h gets it from the package the caller named', async () => {
	// The page a `ui` application writes and forgets the `h` import in. `theme` is not an
	// attribute, so compiled through `dom`'s `h` it is written out and read by nothing.
	const source = `
import { Theme } from '@aweftjs/ui';
Theme.define({ forgot: { color: 'red' } });
export const create = () => ({ item: <div theme="forgot">hi</div> });
`;

	const asDom = transform(source, { filename: 'page.tsx' });
	assert.match(asDom.code, /from '@aweftjs\/dom'/, 'the default is dom, so build assumes nothing about ui');
	const domPage = await loadModule(space.dir, 'forgotdom', asDom.code);
	const domTree = uiMounted(domPage.create as () => Page);
	assert.equal(domTree.before, '<div theme="forgot">hi</div>');

	const asUi = transform(source, { filename: 'page.tsx', defaultH: '@aweftjs/ui' });
	assert.doesNotMatch(asUi.code, /from '@aweftjs\/dom'/);
	const uiPage = await loadModule(space.dir, 'forgotui', asUi.code);
	const uiTree = uiMounted(uiPage.create as () => Page);
	assert.equal(uiTree.before, '<div class="aw0">hi</div>', 'the theme became a class');

	// And the option only changes what a file with no `h` of its own gets: a file that imports
	// dom's `h` keeps it.
	const bound = `
import { h } from '@aweftjs/dom';
export const create = () => ({ item: h('div', { class: 'kept' }, 'hi') });
`;
	assert.match(transform(bound, { filename: 'page.ts', defaultH: '@aweftjs/ui' }).code,
		/template as _template \} from '@aweftjs\/dom'/);
});

/** An icon named when the page runs: the set is a pack in `Icons`, the name is a variable. */
const iconLookedUp = `
import { h, Icon, Icons } from '@aweftjs/ui';
import lucide from '@aweftjs/icons/lucide';

export const create = () => {
	const wanted = 'lucide:check';
	return { item: h(Icons, { value: lucide }, h('p', { class: 'holder' }, h(Icon, { name: wanted, label: 'done' }))) };
};
`;

/**
 * The same page with the name written out, which is what the transform takes (design 141).
 *
 * The empty `Icons` is here so both pages have the same shape: a component mounts as a fragment
 * and the markup carries its markers, so a page with one more component in it differs for a
 * reason that has nothing to do with icons.
 */
const iconNamed = `
import { h, Icon, Icons } from '@aweftjs/ui';

export const create = () => ({
	item: h(Icons, { value: [] }, h('p', { class: 'holder' }, h(Icon, { name: 'lucide:check', label: 'done' }))),
});
`;

test('an icon named at build time draws what the run-time lookup draws', async () => {
	const compiled = transform(iconNamed, { filename: 'named.tsx' });
	assert.match(compiled.code, /import _icon0 from '@aweftjs\/icons\/lucide\/check';/,
		'the fixture exercises the rewrite');

	const looked = await loadModule(space.dir, 'iconlookedup', iconLookedUp);
	const built = await loadModule(space.dir, 'iconnamed', compiled.code);
	await compare('icon', looked.create as () => Page, built.create as () => Page);

	// The page that names the icon carries a specifier; the page that looks it up carries a set.
	// Both draw the same element, which is what makes the first one worth building.
	assert.ok(compiled.code.length < 400, `the compiled page is ${String(compiled.code.length)} bytes`);
	const drawn = await uiRendered(built.create as () => Page);
	assert.match(drawn.markup, /viewBox="0 0 24 24"/, 'the set\'s root size reached the element');
	assert.match(drawn.markup, /<path/, 'and the drawing is in the page');
});

/** The same page with its two literals written as text tokens by hand, which is what the option writes. */
const uiCallsText = uiCalls
	.replace("import { h } from '@aweftjs/ui';", "import { h, text } from '@aweftjs/ui';")
	.replace("h('h1', {}, 'Gallery')", "h('h1', {}, text('Gallery'))")
	.replace("h('button', { theme: ['button', tone], onClick: () => clicks.set(clicks.get() + 1) }, 'press')",
		"h('button', { theme: ['button', tone], onClick: () => clicks.set(clicks.get() + 1) }, text('press'))");

test('a ui file compiled with the text option means what the same page with hand-written tokens means (design 277)', async () => {
	assert.notEqual(uiCallsText, uiCalls, 'the fixture rewrote both literals');
	const plain = await loadModule(space.dir, 'uitextplain', uiCallsText);
	const compiled = transform(uiJsx, { filename: 'page.tsx', text: true });
	assert.deepEqual(compiled.text, ['Gallery', 'press']);
	const built = await loadModule(space.dir, 'uitextbuilt', compiled.code);
	await compare('ui text', plain.create as () => Page, built.create as () => Page);

	// Against the page with no tokens at all: the same elements and the same characters, and the
	// only difference is the bracket pair each token mounts under.
	const untouched = await loadModule(space.dir, 'uitextoff', uiCalls);
	const one = await uiRendered(untouched.create as () => Page);
	const two = await uiRendered(built.create as () => Page);
	assert.equal(two.markup.replace(/<!--\[-->|<!--\]-->/g, ''), one.markup.replace(/<!--\[-->|<!--\]-->/g, ''));
	assert.equal(two.css, one.css);
});
