// The assert strip: one shape goes, and three shapes stay (design 097).

import test from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '@babel/parser';

import { transform } from '../src/index.ts';

const release = (source: string): string => transform(source, { filename: 'a.ts', release: true }).code;
const development = (source: string): string => transform(source, { filename: 'a.ts' }).code;

test('a statement that is nothing but an assert call goes, with its import', () => {
	const source = "import { assert } from './assert.ts';\nexport const f = (x) => {\n\tassert(x, 'needs x');\n\treturn x;\n};";
	const out = release(source);
	assert.doesNotMatch(out, /assert/);
	assert.match(out, /return x;/);
});

test('nothing goes without release', () => {
	const source = "import { assert } from './assert.ts';\nexport const f = (x) => { assert(x, 'm'); };";
	assert.equal(development(source), source);
});

test('the import survives when something else in the file still names it', () => {
	const source = "import { assert } from './assert.ts';\n"
		+ 'export const pass = assert;\n'
		+ "export const f = (x) => { assert(x, 'm'); };";
	const out = release(source);
	assert.match(out, /import \{ assert \} from '\.\/assert\.ts';/);
	assert.match(out, /export const pass = assert;/);
	assert.doesNotMatch(out, /assert\(x/);
});

test('an import used only inside the asserts goes with them, and one used elsewhere stays', () => {
	const source = [
		"import { assert } from './assert.ts';",
		"import { check, other } from './checks.ts';",
		"import { keep } from './keep.ts';",
		'export const f = (x) => {',
		'	assert(check(x), \'checked\');',
		'	assert(other(x) !== null, \'present\');',
		'	return keep(x);',
		'};',
	].join('\n');
	const out = transform(source, { filename: 'f.ts', release: true }).code;
	assert.doesNotMatch(out, /check|other|assert/);
	assert.match(out, /import \{ keep \} from '\.\/keep\.ts';/);
	assert.match(out, /return keep\(x\);/);
});

test('an import the file never names is left alone by the strip', () => {
	const source = "import { assert } from './assert.ts';\nimport { unused } from './x.ts';\nexport const f = (x) => {\n\tassert(x, 'x');\n\treturn x;\n};";
	const out = transform(source, { filename: 'f.ts', release: true }).code;
	assert.match(out, /import \{ unused \} from '\.\/x\.ts';/);
	assert.doesNotMatch(out, /assert/);
});

test('an assert inside another assert\'s argument goes with it, once', () => {
	const source = "import { assert } from './assert.ts';\nexport const f = (x) => {\n\tassert((() => { assert(x, 'in'); return true; })(), 'out');\n\treturn x;\n};";
	const out = transform(source, { filename: 'f.ts', release: true }).code;
	assert.doesNotMatch(out, /assert/);
	assert.match(out, /return x;/);
});

test('only the assert specifier goes when the import brought others', () => {
	const before = "import { assert, isRelease } from './assert.ts';\nexport const f = (x) => { assert(x, 'm'); return isRelease(); };";
	assert.match(release(before), /import \{ isRelease \} from '\.\/assert\.ts';/);

	const after = "import { isRelease, assert } from './assert.ts';\nexport const f = (x) => { assert(x, 'm'); return isRelease(); };";
	assert.match(release(after), /import \{ isRelease \} from '\.\/assert\.ts';/);
});

test('an assert whose value is read keeps its call', () => {
	const source = "import { assert } from './assert.ts';\nexport const f = (x) => { const ok = assert(x, 'm'); return ok; };";
	assert.match(release(source), /const ok = assert\(x, 'm'\);/);
});

test('node\'s assert is left alone, however it is called', () => {
	const source = "import assert from 'node:assert/strict';\nexport const f = (x) => { assert(x, 'm'); };";
	assert.equal(release(source), source);

	const named = "import { strict as assert } from 'node:assert';\nexport const f = (x) => { assert(x, 'm'); };";
	assert.equal(release(named), named);
});

test('an assert from a module that is not a neighbouring assert is left alone', () => {
	const source = "import { assert } from './helpers.ts';\nexport const f = (x) => { assert(x, 'm'); };";
	assert.equal(release(source), source);
});

test('a specifier that merely has assert in its name is not a neighbouring assert module', () => {
	// The rule is the last path segment of a relative specifier, not the word appearing somewhere.
	// A looser match would take a page's own assertion library out of its release build.
	for (const from of ['./assert-helpers.ts', './asserts.ts', '../assertions/index.ts', 'node:assert/strict', 'some-assert-lib']) {
		const source = `import { assert } from '${from}';\nexport const f = (x) => { assert(x, 'm'); };`;
		assert.equal(release(source), source, `${from} is not a neighbouring assert module`);
	}
});

test('every spelling of a neighbouring assert module is recognised', () => {
	for (const from of ['./assert.ts', './assert.js', '../assert.ts', '../../src/assert.mjs', './assert']) {
		const source = `import { assert } from '${from}';\nexport const f = (x) => { assert(x, 'm'); };`;
		assert.doesNotMatch(release(source), /assert\(x/, `${from} should have been stripped`);
	}
});

test('the strip takes real bytes out of the binding\'s own source', async () => {
	const { readFileSync } = await import('node:fs');
	const path = new URL('../../dom/src/mount.ts', import.meta.url);
	const source = readFileSync(path, 'utf8');
	const out = release(source);
	assert.ok(out.length < source.length, 'a release build of mount.ts is smaller');
	assert.doesNotMatch(out, /\n\tassert\(/);
});

// A statement position where the language requires a statement: taking the assert out has to
// leave one behind, or the structure reads whatever comes next as its body (design 097).
const IMPORT = "import { assert } from './assert.ts';\n";

const thrower = (condition: unknown, message: string): void => {
	if (!condition) throw new Error(message);
};

/** Run the module's `f`, with the import taken out and the assert passed in instead. */
const runF = (source: string, argument: unknown): unknown =>
	(new Function('assert', `${source.split(IMPORT).join('')}\nreturn f;`)(thrower) as (x: unknown) => unknown)(argument);

test('an assert alone in a statement position leaves a statement behind', () => {
	const cases: readonly [name: string, body: string, argument: unknown][] = [
		['an unbraced if body', "const f = (x) => { if (x) assert(x, 'm'); return 'after'; };", 0],
		['an else body', "const f = (x) => { if (!x) x = 'set'; else assert(x, 'm'); return x; };", 0],
		['a while body', "const f = (x) => { while (x) assert(x, 'm'); return 'after'; };", 0],
		['a for body', "const f = (n) => { for (let i = 0; i < n; i++) assert(i, 'm'); return 'after'; };", 0],
		['a for-of body', "const f = (xs) => { for (const x of xs) assert(x, 'm'); return 'after'; };", []],
		['a do body', "const f = (x) => { let n = 0; do assert(x, 'm'); while (n++ < 0); return 'after'; };", 1],
		['a labelled statement', "const f = (x) => { done: assert(x, 'm'); return 'after'; };", 1],
		['a case clause', "const f = (x) => { switch (x) { case 1: assert(x, 'm'); default: return 'after'; } };", 1],
	];

	for (const [name, body, argument] of cases) {
		const source = IMPORT + body;
		const out = release(source);
		assert.doesNotMatch(out, /assert\(/, `${name}: the call should be gone`);
		assert.doesNotThrow(() => parse(out, { sourceType: 'module' }), `${name}: the output has to parse`);
		assert.equal(runF(out, argument), runF(source, argument), `${name}: the stripped program means something else`);
	}
});

test('an assert written as a concise arrow body keeps its call', () => {
	// Its value is the function's result, so it is not a statement and nothing removes it.
	const source = `${IMPORT}const f = (x) => assert(x, 'm');`;
	assert.match(release(source), /assert\(x, 'm'\)/);
});

test('a member named assert is not a use of the imported one', () => {
	const source = `${IMPORT}const log = { assert: (x) => x };\nconst f = (x) => { log.assert(x); assert(x, 'm'); };`;
	const out = release(source);
	assert.doesNotMatch(out, /from '\.\/assert\.ts'/, 'the import has no user left');
	assert.match(out, /log\.assert\(x\);/);
	assert.doesNotMatch(out, /assert\(x, 'm'\)/);
});
