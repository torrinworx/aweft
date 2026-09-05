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

import { type Page, cloningDocument, fixtures, hydrated, loadModule, mounted, rendered, scratch } from './fixtures.ts';

// Both documents, every time. A browser's nodes clone and the light tree's do not, and the
// template takes a different path for each, so one document proves half of it.
const documents: readonly [string, () => LightDocument][] = [
	['the light tree', createDocument],
	['a document whose nodes clone', cloningDocument],
];

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
