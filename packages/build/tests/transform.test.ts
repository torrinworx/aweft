// What the transform emits: which `h` it calls, what it imports, and what it declines to hoist.

import test from 'node:test';
import assert from 'node:assert/strict';

import { transform } from '../src/index.ts';

const dom = "import { h, html } from '@aweftjs/dom';\n";

const code = (source: string, filename = 'case.tsx', release = false): string =>
	transform(source, { filename, release }).code;

test('JSX compiles to the h the file already has, and hoists nothing when that h is not dom\'s', () => {
	const out = code("const h = (t) => t;\nexport const a = <div class=\"x\">text</div>;");
	assert.match(out, /h\("div", \{ class: "x" \}, "text"\)/);
	assert.doesNotMatch(out, /template/);
	assert.doesNotMatch(out, /@aweftjs\/dom/);
});

test('JSX imports dom\'s h when the file has none, and then hoists', () => {
	const out = code('export const a = <div class="x">text</div>;');
	assert.match(out, /^import \{ h, template as _template \} from '@aweftjs\/dom';/);
	assert.match(out, /const _t0 = _template\(\["div",\{"class":"x"\},"text"\], \[\]\);/);
	assert.match(out, /export const a = _t0\(\[\]\);/);
});

test('a component and a member tag stay expressions, resolved by scope', () => {
	const out = code('const Thing = () => null;\nconst ns = { Part: Thing };\nexport const a = <Thing><ns.Part/></Thing>;');
	assert.match(out, /h\(Thing, null, h\(ns\.Part, null\)\)/);
});

test('a fragment becomes a list of items', () => {
	const out = code('export const a = <><p>one</p>{2}</>;');
	assert.match(out, /export const a = \[_t0\(\[\]\), 2\];/);
});

test('markup calls dom\'s h under its own name when the file has an h of its own', () => {
	const out = code("import { html } from '@aweftjs/dom';\nconst h = 1;\nexport const a = html`<p>x</p>`;");
	assert.match(out, /import \{ h as _h \} from '@aweftjs\/dom';/);
	assert.match(out, /export const a = _h\("p", null, "x"\);/);
});

test('markup joins a quoted attribute of several parts through dom\'s joined', () => {
	const out = code(`${dom}export const a = (tone) => html\`<p class="note \${tone}"></p>\`;`);
	assert.match(out, /import \{ joined as _joined/);
	assert.match(out, /_joined\(\["note ", tone\]\)/);
});

test('markup with one hole in a quoted attribute keeps the expression itself', () => {
	const out = code(`${dom}export const a = (v) => html\`<p title="\${v}"></p>\`;`);
	assert.doesNotMatch(out, /_joined/);
	assert.match(out, /title: v/);
});

test('an element with a spread is left as an h call, and its parent hoists around it', () => {
	const out = code(`${dom}export const a = (rest) => h('ul', { class: 'l' }, h('li', { ...rest }, 'x'));`);
	assert.match(out, /const _t0 = _template\(\["ul",\{"class":"l"\}\], \[\["child",\[\],-1\]\]\);/);
	assert.match(out, /_t0\(\[h\('li', \{ \.\.\.rest \}, 'x'\)\]\)/);
});

test('an element given children as a property is left as an h call', () => {
	const out = code(`${dom}export const a = h('div', { children: ['x'] });`);
	assert.doesNotMatch(out, /_template/);
	assert.match(out, /h\('div', \{ children: \['x'\] \}\)/);
});

test('an h call the reader cannot take apart is left exactly as it was written', () => {
	const source = `${dom}const key = 'class';\nexport const a = h('div', { [key]: 'x' }, 'body');`;
	const out = code(source);
	assert.match(out, /h\('div', \{ \[key\]: 'x' \}, 'body'\)/);
	assert.doesNotMatch(out, /_template/);
});

test('a subtree inside a component call still hoists', () => {
	const out = code(`${dom}const C = () => null;\nexport const a = h(C, null, h('p', { class: 'in' }, 'x'));`);
	assert.match(out, /const _t0 = _template\(\["p",\{"class":"in"\},"x"\], \[\]\);/);
	assert.match(out, /h\(C, null, _t0\(\[\]\)\)/);
});

test('a literal attribute that removes itself is left out of the prototype', () => {
	const out = code(`${dom}export const a = h('div', { hidden: false, id: null, title: true, tabindex: 2 });`);
	assert.match(out, /_template\(\["div",\{"title":true,"tabindex":2\}\], \[\]\)/);
});

test('a generated name dodges one the file already uses', () => {
	const out = code('const _t0 = 1;\nconst _template = 2;\nexport const a = <p>x</p>;');
	assert.match(out, /template as _template1/);
	assert.match(out, /const _t_0 = _template1\(/);
	assert.match(out, /export const a = _t_0\(\[\]\);/);
});

test('what is not transformed comes out byte for byte, and the map names the file', () => {
	const source = `${dom}// a comment that must survive\nexport const untouched = { a: 1 /* inline */ };\n`;
	const result = transform(source, { filename: 'keep.ts' });
	assert.equal(result.code, source);
	assert.equal(result.map.sources[0], 'keep.ts');
	assert.equal(result.map.version, 3);
	assert.match(result.map.toUrl(), /^data:application\/json/);
});

test('a .ts file is TypeScript and not JSX, and a .tsx file is both', () => {
	const typescript = 'export const a: number = 1;\nexport const b = <T,>(x: T): T => x;';
	assert.doesNotThrow(() => code(typescript, 'x.ts'));
	assert.doesNotThrow(() => code(typescript, 'x.tsx'));
	assert.doesNotThrow(() => code('export const a = <p>x</p>;', 'x.jsx'));
	assert.doesNotThrow(() => code('export const a = <p>x</p>;'));
});

test('a template declaration runs before its use, wherever the file puts its imports', () => {
	const after = code(`${dom}import { other } from './other.ts';\nexport const a = h('p', {}, 'x');`);
	assert.ok(after.indexOf('const _t0 =') < after.indexOf('export const a'), 'the declaration must precede its use');

	// ESM hoists imports, so a statement may legally sit above one. The declaration is read where
	// it stands, so it has to be above every statement, not merely above the last import.
	const before = code(`${dom}export const a = h('p', { class: 'x' }, 'hi');\nimport './side.ts';`, 'case.ts');
	assert.ok(before.indexOf('const _t0 =') < before.indexOf('export const a'), 'the declaration must precede its use');
});

test('a file with its own h calls that one, whatever else it imports h as', () => {
	// `ui` is meant to declare its own `h`. An alias for dom's `h` beside it does not make the
	// file's own `h` disappear, and nothing in the file may be hoisted (design 095, case 4).
	const elsewhere = code("import { h as dh } from '@aweftjs/dom';\nimport { h } from './mine.ts';\nexport const a = <p class=\"q\">hi</p>;");
	assert.match(elsewhere, /export const a = h\("p", \{ class: "q" \}, "hi"\);/);
	assert.doesNotMatch(elsewhere, /_template|dh\(/);

	const own = code("import { h as create } from '@aweftjs/dom';\nconst h = (t, p, ...c) => 'mine';\nexport const a = <p class=\"q\">hi</p>;");
	assert.match(own, /export const a = h\("p", \{ class: "q" \}, "hi"\);/);
	assert.doesNotMatch(own, /_template|create\(/);
});

test('an h shadowed inside one function stops hoisting for the whole file', () => {
	const out = code(`${dom}export const f = () => { const h = (t) => t; return <p class="in">x</p>; };\nexport const g = <p class="out">y</p>;`);
	assert.doesNotMatch(out, /_template/);
	assert.match(out, /h\("p", \{ class: "in" \}, "x"\)/);
	assert.match(out, /h\("p", \{ class: "out" \}, "y"\)/);
});

test('dom\'s h under another name is still provably dom\'s, so the file hoists', () => {
	const out = code("import { h as create } from '@aweftjs/dom';\nexport const a = <p class=\"q\">hi</p>;\nexport const b = create('i', null, 'x');");
	assert.match(out, /const _t0 = _template\(\["p",\{"class":"q"\},"hi"\], \[\]\);/);
	assert.match(out, /export const a = _t0\(\[\]\);/);
	assert.match(out, /const _t1 = _template\(\["i",null,"x"\], \[\]\);/);
});
