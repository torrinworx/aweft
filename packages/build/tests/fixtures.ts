// The equivalence fixtures, and the harness that runs a fixture three ways.
//
// A fixture is a module that runs as it stands: it writes `h` and markup in a template literal,
// both of which the binding understands with no build step. The transform's whole risk is
// changing what a program means, so every fixture is run twice, once as written and once
// transformed, and the two have to agree in all three modes: mounted into a tree, rendered to
// markup, and hydrated over that markup.
//
// A fixture that writes JSX carries a second source, `same`, that says what it means in plain
// `h` calls. That pair is how the JSX pass is checked, because JSX does not run untransformed.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createDocument, hydrate, mount, parseHtml, render, toHtml } from '@aweftjs/dom';
import type { LightDocument, LightElement, LightNode, LightText } from '@aweftjs/dom';

/** What a fixture module hands back: the item to mount, and a change to make to it. */
export interface Page {
	readonly item: unknown;
	readonly edit?: () => void;
}

export interface Fixture {
	readonly name: string;
	/** The module source, runnable as it stands. */
	readonly source: string;
	/** The same page written in JSX, when the fixture covers the JSX pass. */
	readonly jsx?: string;
	/** The file name to compile under, which picks the dialect. */
	readonly filename?: string;
}

const packages = new URL('../../', import.meta.url);
const resolved: Record<string, string> = {
	'@aweftjs/dom': new URL('dom/src/index.ts', packages).href,
	'@aweftjs/core': new URL('core/src/index.ts', packages).href,
	'@aweftjs/ui': new URL('ui/src/index.ts', packages).href,
};

/** A module written to a scratch file and imported. The stack's specifiers become file URLs, so
 * the file resolves from anywhere; both sides of a comparison get the same rewrite. */
export const loadModule = async (dir: string, name: string, source: string): Promise<{ create(): Page }> => {
	let code = source;
	for (const [specifier, url] of Object.entries(resolved)) {
		code = code.split(`'${specifier}'`).join(JSON.stringify(url));
	}
	const file = join(dir, `${name}.ts`);
	writeFileSync(file, code);
	return await import(pathToFileURL(file).href) as { create(): Page };
};

export const scratch = (): { dir: string; done(): void } => {
	const dir = mkdtempSync(join(tmpdir(), 'aweft-build-'));
	return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
};

/**
 * The light tree with cloning written a second time, per node rather than on the class.
 *
 * The light tree clones on its own since design 099, so this is no longer the only document in the
 * suite whose nodes clone. It stays because it is a second implementation, written here from what
 * cloning means rather than from what the template does with it, so a template that came to depend
 * on something only the light tree's own `cloneNode` does would show up.
 *
 * It is a wrapper, not a second tree: every node is a light node and every operation is the light
 * tree's.
 */
export const cloningDocument = (): LightDocument => {
	const document = createDocument();
	const element = document.createElement.bind(document);
	const text = document.createTextNode.bind(document);
	const cloneText = (node: LightText): LightText => text(node.data);
	const cloneElement = (node: LightElement, deep: boolean): LightElement => {
		const copy = element(node.localName);
		for (const name of node.getAttributeNames()) copy.setAttribute(name, node.getAttribute(name) ?? '');
		if (deep) for (let n = node.firstChild; n !== null; n = n.nextSibling) copy.appendChild(clone(n as LightElement, true));
		return copy;
	};
	const clone = (node: LightNode, deep: boolean): LightNode =>
		(node.nodeType === 1 ? cloneElement(node as LightElement, deep) : cloneText(node as LightText));

	document.createElement = (tag: string): LightElement => {
		const made = element(tag);
		(made as { cloneNode?: unknown }).cloneNode = (deep: boolean) => clone(made, deep);
		return made;
	};
	document.createTextNode = (data: string): LightText => {
		const made = text(data);
		(made as { cloneNode?: unknown }).cloneNode = () => cloneText(made);
		return made;
	};
	return document;
};

/**
 * The light tree with nodes that do not clone, which is what a host the application wrote itself
 * may be: `ElementLike` asks for no `cloneNode` and `DocumentLike` is satisfied by four factory
 * functions. A hoisted template clones where it can and builds each instance where it cannot, so
 * without this the build branch never runs in the gate.
 *
 * It is a wrapper, not a second tree: every node is a light node with one own property shadowing
 * the class's `cloneNode`.
 */
export const plainDocument = (): LightDocument => {
	const document = createDocument();
	const element = document.createElement.bind(document);
	const text = document.createTextNode.bind(document);
	const withoutCloning = <T extends object>(node: T): T => {
		Object.defineProperty(node, 'cloneNode', { value: undefined, configurable: true });
		return node;
	};
	document.createElement = (tag: string): LightElement => withoutCloning(element(tag));
	document.createTextNode = (data: string): LightText => withoutCloning(text(data));
	return document;
};

/**
 * Run `fn` with `document` as the page's document, which is where `h` and a hoisted template
 * make nodes outside any mount.
 *
 * A page builds its top-level item before it hands it to `mount` or `hydrate`, so the document
 * that is active then is the page's, not the one the mount later runs in. Without this a fixture
 * is built in the no-page fallback, whose nodes never clone, and the clone path is never reached.
 */
export const asThePage = <T>(document: LightDocument, fn: () => T): T => {
	const global = globalThis as { document?: unknown };
	const had = 'document' in global;
	const before = global.document;
	global.document = document;
	try {
		return fn();
	} finally {
		if (had) global.document = before;
		else delete global.document;
	}
};

/** What a page does when it is mounted: the tree it makes, and the tree after one change. */
export const mounted = (create: () => Page, make: () => LightDocument = createDocument): { before: string; after: string } => {
	const document = make();
	return asThePage(document, () => {
		const page = create();
		mount(document.body, page.item);
		const before = toHtml(document.body);
		page.edit?.();
		return { before, after: toHtml(document.body) };
	});
};

export const rendered = async (page: Page): Promise<string> => await render(page.item);

/** What hydration leaves behind, and how many of the server's nodes it kept. */
export const hydrated = async (
	create: () => Page,
	markup: string,
	make: () => LightDocument = createDocument,
): Promise<{ markup: string; kept: number }> => {
	const document = make();
	return asThePage(document, () => {
		const page = create();
		for (const node of parseHtml(markup, document)) document.body.appendChild(node as LightElement);
		const before = nodesOf(document.body);
		hydrate(document.body, page.item);
		const after = new Set(nodesOf(document.body));
		return { markup: toHtml(document.body), kept: before.filter((node) => after.has(node)).length };
	});
};

const nodesOf = (root: LightNode): LightNode[] => {
	const out: LightNode[] = [];
	const walk = (node: LightNode): void => {
		for (let n = node.firstChild; n !== null; n = n.nextSibling) {
			out.push(n);
			walk(n);
		}
	};
	walk(root);
	return out;
};

const dom = "import { h, html } from '@aweftjs/dom';";
const core = "import { createArray, createObject, mutable, observer } from '@aweftjs/core';";

export const fixtures: readonly Fixture[] = [
	{
		name: 'a static subtree',
		source: `${dom}
export const create = () => ({ item: h('div', { class: 'card' }, h('h1', {}, 'Title'), h('p', {}, 'Body')) });`,
		jsx: `export const create = () => ({ item: <div class="card"><h1>Title</h1><p>Body</p></div> });`,
	},
	{
		name: 'a reactive part inside a static subtree',
		source: `${dom}
${core}
export const create = () => {
	const name = mutable('world');
	return { item: h('section', { class: 'greet' }, h('h1', {}, 'Hello'), h('p', {}, 'hi ', name, '!')), edit: () => name.set('there') };
};`,
		jsx: `${core}
export const create = () => {
	const name = mutable('world');
	return { item: <section class="greet"><h1>Hello</h1><p>hi {name}!</p></section>, edit: () => name.set('there') };
};`,
	},
	{
		name: 'a null child and a plain string child',
		source: `${dom}
export const create = () => {
	const missing = null;
	const plain = 'plain';
	return { item: h('ul', {}, h('li', {}, missing), h('li', {}, plain), h('li', {}, 'literal')) };
};`,
		jsx: `export const create = () => {
	const missing = null;
	const plain = 'plain';
	return { item: <ul><li>{missing}</li><li>{plain}</li><li>literal</li></ul> };
};`,
	},
	{
		name: 'a number child and a node child',
		source: `${dom}
export const create = () => {
	const count = 3;
	const node = h('em', {}, 'made');
	return { item: h('p', {}, 'n=', count, ' ', node, ' end') };
};`,
	},
	{
		name: 'properties by $name and a reactive attribute',
		source: `${dom}
${core}
export const create = () => {
	const on = mutable(false);
	const clicked = () => undefined;
	return {
		item: h('form', { class: 'f' }, h('input', { type: 'checkbox', $checked: on, $onclick: clicked }), h('span', { title: on })),
		edit: () => on.set(true),
	};
};`,
		jsx: `${core}
export const create = () => {
	const on = mutable(false);
	const clicked = () => undefined;
	return {
		item: <form class="f"><input type="checkbox" $checked={on} $onclick={clicked}/><span title={on}/></form>,
		edit: () => on.set(true),
	};
};`,
	},
	{
		name: 'a $style object with a reactive member',
		source: `${dom}
${core}
export const create = () => {
	const width = mutable('10px');
	return { item: h('div', { $style: { color: 'red', width } }, 'boxed'), edit: () => width.set('20px') };
};`,
	},
	{
		name: 'spread properties',
		source: `${dom}
export const create = () => {
	const rest = { class: 'spread', title: 'from a spread' };
	return { item: h('div', { id: 'kept' }, h('span', { ...rest }, 'inside')) };
};`,
		jsx: `export const create = () => {
	const rest = { class: 'spread', title: 'from a spread' };
	return { item: <div id="kept"><span {...rest}>inside</span></div> };
};`,
	},
	{
		name: 'children given as a property',
		source: `${dom}
export const create = () => ({ item: h('div', { class: 'outer', children: ['a', h('b', {}, 'c')] }) });`,
	},
	{
		name: 'a component, with and without each',
		source: `${dom}
${core}
const Item = ({ each }) => h('li', {}, observer(each).path('label'));
export const create = () => {
	const rows = createArray([createObject({ label: 'one' }), createObject({ label: 'two' })]);
	return { item: h('ul', { class: 'list' }, h(Item, { each: rows })), edit: () => rows.push(createObject({ label: 'three' })) };
};`,
		jsx: `${core}
const Item = ({ each }) => <li>{observer(each).path('label')}</li>;
export const create = () => {
	const rows = createArray([createObject({ label: 'one' }), createObject({ label: 'two' })]);
	return { item: <ul class="list"><Item each={rows}/></ul>, edit: () => rows.push(createObject({ label: 'three' })) };
};`,
	},
	{
		name: 'markup with a mixed quoted attribute',
		source: `${dom}
${core}
export const create = () => {
	const tone = mutable('warm');
	return { item: html\`<p class="note \${tone} big" title="\${'only'}" alt="a\${1}b">text</p>\`, edit: () => tone.set('cool') };
};`,
	},
	{
		name: 'markup with a component, a spread and a comment',
		source: `${dom}
${core}
const Row = ({ each }) => html\`<li>\${observer(each).path('label')}</li>\`;
export const create = () => {
	const rows = createArray([createObject({ label: 'a' })]);
	const rest = { class: 'listy' };
	return { item: html\`<ul =\${rest}><!-- gone --><\${Row} each=\${rows} /></ul>\`, edit: () => rows.push(createObject({ label: 'b' })) };
};`,
	},
	{
		name: 'markup with a bare attribute, a bare value and a closing slash',
		source: `${dom}
export const create = () => ({ item: html\`<div hidden id=plain><input type="text" /><br/></div>\` });`,
	},
	{
		name: 'markup with several roots and a line break in text',
		source: `${dom}
export const create = () => ({ item: html\`
	<p>
		one
		two
	</p>
	<p>three</p>
\` });`,
	},
	{
		name: 'nested reactive parts either side of a static child',
		source: `${dom}
${core}
export const create = () => {
	const a = mutable('A');
	const b = mutable('B');
	return { item: h('p', {}, a, h('i', {}, 'mid'), b, ' tail'), edit: () => { a.set('a'); b.set('b'); } };
};`,
		jsx: `${core}
export const create = () => {
	const a = mutable('A');
	const b = mutable('B');
	return { item: <p>{a}<i>mid</i>{b} tail</p>, edit: () => { a.set('a'); b.set('b'); } };
};`,
	},
	{
		name: 'two reactive children in one gap',
		source: `${dom}
${core}
export const create = () => {
	const a = mutable('1');
	const b = mutable('2');
	return { item: h('p', {}, 'start ', a, b, h('em', {}, 'end')), edit: () => { a.set('9'); b.set('8'); } };
};`,
	},
	{
		// The cell becomes a signal and the plain value becomes a node right away, in the same gap
		// and with no static child after them. The signal's anchor is that node, so it goes first.
		name: 'a reactive child followed by a plain one, with nothing static after',
		source: `${dom}
${core}
export const create = () => {
	const cell = mutable('reactive');
	const plain = ' and plain';
	const node = h('em', {}, ' and a node');
	return { item: h('p', { class: 'g' }, cell, plain, node), edit: () => cell.set('changed') };
};`,
		jsx: `${core}
export const create = () => {
	const cell = mutable('reactive');
	const plain = ' and plain';
	const node = <em> and a node</em>;
	return { item: <p class="g">{cell}{plain}{node}</p>, edit: () => cell.set('changed') };
};`,
	},
	{
		name: 'a fragment of several items',
		source: `${dom}
${core}
export const create = () => {
	const name = mutable('x');
	return { item: [h('h1', {}, 'one'), h('p', {}, name)], edit: () => name.set('y') };
};`,
		jsx: `${core}
export const create = () => {
	const name = mutable('x');
	return { item: <><h1>one</h1><p>{name}</p></>, edit: () => name.set('y') };
};`,
	},
	{
		name: 'a static iterable child',
		source: `${dom}
export const create = () => ({ item: h('ul', {}, [h('li', {}, 'a'), h('li', {}, 'b')]) });`,
	},
	{
		name: 'an attribute whose literal value removes it',
		source: `${dom}
export const create = () => ({ item: h('div', { hidden: false, id: null, title: true, tabindex: 2 }, 'x') });`,
		jsx: `export const create = () => ({ item: <div hidden={false} id={null} title tabindex={2}>x</div> });`,
	},
	{
		// The property is written after the children, so it rewrites what they put there. Apply it
		// first and the child survives, which is a different page (design 093).
		name: 'a property that rewrites what a child put there',
		source: `${dom}
export const create = () => {
	const child = 'overwritten';
	return { item: h('div', { class: 'w', $textContent: 'written' }, child) };
};`,
		jsx: `export const create = () => {
	const child = 'overwritten';
	return { item: <div class="w" $textContent="written">{child}</div> };
};`,
	},
	{
		// JavaScript evaluates a call's arguments left to right, so a source reads its properties
		// before its children and an outer element's properties before anything inside it. The
		// compiled form has to run the same expressions in the same order: `order` is rendered into
		// the page, so a different order is a different page.
		name: 'expressions a side effect can see, in source order',
		source: `${dom}
export const create = () => {
	const order = [];
	const mark = (label, value) => { order.push(label); return value; };
	const card = h('section', { id: mark('a', 'card') },
		mark('b', 'one'),
		h('p', { title: mark('c', 'p') }, mark('d', 'two'), h('em', { class: mark('e', 'em') }, mark('f', 'three'))),
		mark('g', 'four'));
	return { item: h('div', {}, card, h('code', {}, order.join(''))) };
};`,
		jsx: `export const create = () => {
	const order = [];
	const mark = (label, value) => { order.push(label); return value; };
	const card = <section id={mark('a', 'card')}>{mark('b', 'one')}<p title={mark('c', 'p')}>{mark('d', 'two')}<em class={mark('e', 'em')}>{mark('f', 'three')}</em></p>{mark('g', 'four')}</section>;
	return { item: <div>{card}<code>{order.join('')}</code></div> };
};`,
	},
	{
		name: 'a deep tree with one varying leaf',
		source: `${dom}
${core}
export const create = () => {
	const leaf = mutable('deep');
	return {
		item: h('div', { class: 'a' }, h('div', { class: 'b' }, h('div', { class: 'c' }, h('span', {}, leaf)))),
		edit: () => leaf.set('deeper'),
	};
};`,
	},
];
