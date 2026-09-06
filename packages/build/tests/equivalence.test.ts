// The equivalence suite: a transformed program does what the untransformed one does.
//
// This is the backbone. The transform's whole risk is changing what a program means, so every
// fixture runs twice and in all three modes. A fixture where the two disagree is a defect in the
// transform, never a fixture to adjust.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { transform } from '../src/index.ts';
import { createDocument } from '@aweftjs/dom';
import type { LightDocument } from '@aweftjs/dom';

import { type Page, asThePage, cloningDocument, fixtures, hydrated, loadModule, mounted, plainDocument, rendered, scratch } from './fixtures.ts';

// Every document, every time. A hoisted template clones an instance where the document's nodes
// clone and builds it where they do not, so one document proves half of it. The light tree clones
// on its own since design 099; `plainDocument` is the host that does not, which is every host the
// application writes itself, because `ElementLike` asks for no `cloneNode`.
const documents: readonly [string, () => LightDocument][] = [
	['the light tree', createDocument],
	['a document whose nodes clone', cloningDocument],
	['a document whose nodes do not clone', plainDocument],
];

// The list above is a claim about coverage, and it stops being true the moment one of these
// documents changes what it does. `packages/build/README.md` says the suite runs over both, so
// this is the check that fails when it stops.
test('the suite runs over a document that clones and one that does not', () => {
	const cloning = (make: () => LightDocument): boolean =>
		typeof (make().createElement('p') as { cloneNode?: unknown }).cloneNode === 'function';
	assert.equal(cloning(createDocument), true, 'the light tree clones');
	assert.equal(cloning(cloningDocument), true, 'the wrapper clones');
	assert.equal(cloning(plainDocument), false, 'the plain host does not clone, so the build branch runs');
});

const space = scratch();
before(() => undefined);
after(() => space.done());

const compare = async (name: string, plain: () => Page, other: () => Page): Promise<void> => {
	const markupA = await rendered(plain());
	const markupB = await rendered(other());
	assert.equal(markupB, markupA, `${name}: the rendered markup differs`);

	for (const [where, make] of documents) {
		const a = mounted(plain, make);
		const b = mounted(other, make);
		assert.equal(b.before, a.before, `${name}: the mounted tree differs in ${where}`);
		assert.equal(b.after, a.after, `${name}: the tree after an edit differs in ${where}`);

		const hydratedA = await hydrated(plain, markupA, make);
		const hydratedB = await hydrated(other, markupB, make);
		assert.equal(hydratedB.markup, hydratedA.markup, `${name}: the hydrated tree differs in ${where}`);
		assert.equal(hydratedB.kept, hydratedA.kept,
			`${name}: hydration adopted a different number of nodes in ${where}`);
		assert.ok(hydratedA.kept > 0, `${name}: the fixture hydrates nothing in ${where}, so it proves nothing`);
	}
};

for (const [index, fixture] of fixtures.entries()) {
	test(`transformed and untransformed agree: ${fixture.name}`, async () => {
		const filename = fixture.filename ?? 'case.ts';
		const plain = await loadModule(space.dir, `plain${index}`, fixture.source);
		const compiled = transform(fixture.source, { filename });
		const built = await loadModule(space.dir, `built${index}`, compiled.code);
		await compare(fixture.name, plain.create, built.create);
	});

	const jsx = fixture.jsx;
	if (jsx === undefined) continue;
	test(`JSX means the same as the h calls: ${fixture.name}`, async () => {
		const plain = await loadModule(space.dir, `jsxplain${index}`, fixture.source);
		const compiled = transform(jsx, { filename: 'case.tsx' });
		const built = await loadModule(space.dir, `jsxbuilt${index}`, compiled.code);
		await compare(fixture.name, plain.create, built.create);
	});
}

// JavaScript evaluates a call's arguments left to right, so a source runs an element's properties
// before its children, and an outer element's properties before anything nested inside it. The
// compiled form has to run the same expressions in the same order, whatever order it then applies
// them to the tree in. The expected order is read off the source by hand and written out here, so
// it does not come from either the transform or the binding.
const orderCases: readonly { readonly name: string; readonly body: string; readonly order: string }[] = [
	{ name: 'one element', body: `h('p', { title: mark('a') }, mark('b'))`, order: 'ab' },
	{
		name: 'a nested element between two children',
		body: `h('p', { title: mark('a') }, mark('b'), h('em', { class: mark('c') }, mark('d')), mark('e'))`,
		order: 'abcde',
	},
	{
		name: 'three levels',
		body: `h('div', { id: mark('a') }, h('p', { id: mark('b') }, h('em', { id: mark('c') }, mark('d')), mark('e')), mark('f'))`,
		order: 'abcdef',
	},
	{
		name: 'two siblings each with properties',
		body: `h('ul', { id: mark('a') }, h('li', { id: mark('b') }, mark('c')), h('li', { id: mark('d') }, mark('e')))`,
		order: 'abcde',
	},
	{
		name: 'a static child before and after the varying ones',
		body: `h('p', { title: mark('a') }, 'one', mark('b'), 'two', h('i', { id: mark('c') }, 'three', mark('d')), mark('e'))`,
		order: 'abcde',
	},
];

for (const [index, item] of orderCases.entries()) {
	test(`the compiled form runs the source's expressions in source order: ${item.name}`, async () => {
		const source = `import { h } from '@aweftjs/dom';
export const create = () => {
	const order = [];
	const mark = (label) => { order.push(label); return label; };
	const item = ${item.body};
	return { item, order: order.join('') };
};`;
		const plain = await loadModule(space.dir, `orderPlain${index}`, source);
		const built = await loadModule(space.dir, `orderBuilt${index}`, transform(source, { filename: 'order.ts' }).code);

		const ran = (module: { create(): Page }): string =>
			asThePage(createDocument(), () => (module.create() as Page & { order: string }).order);

		assert.equal(ran(plain), item.order, `${item.name}: the source itself does not run in the order stated`);
		assert.equal(ran(built), item.order, `${item.name}: the compiled form runs the source's expressions in another order`);
	});
}

test('a child that resolves to undefined still asserts, transformed or not', async () => {
	const source = `import { h } from '@aweftjs/dom';
export const create = () => ({ item: h('div', { class: 'x' }, h('span', {}, 'ok'), gone) });
const gone = undefined;`;
	const plain = await loadModule(space.dir, 'undefinedPlain', source);
	const built = await loadModule(space.dir, 'undefinedBuilt', transform(source, { filename: 'u.ts' }).code);

	for (const module of [plain, built]) {
		assert.throws(() => mounted(module.create), /cannot mount undefined/);
	}
});
