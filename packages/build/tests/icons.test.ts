// A literal icon name on `Icon` becomes an import of that one icon (design 141).
//
// This file reads what the transform wrote: which names it takes and which it leaves exactly
// where they were. That the two sides draw the same element is `ui-equivalence.test.ts`, which
// already runs a page three ways.

import test from 'node:test';
import assert from 'node:assert/strict';

import { transform } from '../src/index.ts';

const compile = (source: string): string => transform(source, { filename: 'page.tsx' }).code;

const ui = "import { h, Icon } from '@aweftjs/ui';";

test('a set-prefixed literal on Icon becomes an import of that icon', () => {
	const code = compile(`${ui}\nexport const a = <Icon name="lucide:check" label="done" />;`);
	assert.match(code, /^import _icon0 from '@aweftjs\/icons\/lucide\/check';$/m);
	assert.match(code, /name: _icon0/);
	assert.doesNotMatch(code, /"lucide:check"/, 'the literal is gone from the element');
});

test('an h call is rewritten in place, and only the string moves', () => {
	const source = `${ui}\nexport const a = h(Icon, { size: '2rem', name: 'lucide:search' /* here */ });`;
	const code = compile(source);
	assert.match(code, /^import _icon0 from '@aweftjs\/icons\/lucide\/search';$/m);
	assert.match(code, /h\(Icon, \{ size: '2rem', name: _icon0 \/\* here \*\/ \}\)/,
		'the call is the call that was written, with the literal replaced');
});

test('a name with no set in it is left for the run-time lookup', () => {
	const code = compile(`${ui}\nexport const a = <Icon name="check" />;`);
	assert.doesNotMatch(code, /@aweftjs\/icons/);
	assert.match(code, /name: "check"/);
});

test('a name the sets could not publish is left alone', () => {
	for (const name of ['Lucide:Check', 'lucide:', ':check', 'a:b:c', 'lucide:my icon']) {
		const code = compile(`${ui}\nexport const a = <Icon name="${name}" />;`);
		assert.doesNotMatch(code, /@aweftjs\/icons/, `${name} is not a name a set publishes`);
	}
});

test('a computed name, and a spread that could carry one, are left alone', () => {
	const computed = compile(`${ui}\nconst wanted = 'lucide:check';\nexport const a = <Icon name={wanted} />;`);
	assert.doesNotMatch(computed, /@aweftjs\/icons/);

	const spread = compile(`${ui}\nconst rest = {};\nexport const a = <Icon name="lucide:check" {...rest} />;`);
	assert.doesNotMatch(spread, /@aweftjs\/icons/, 'the spread may carry a name of its own');

	const call = compile(`${ui}\nconst rest = {};\nexport const a = h(Icon, { ...rest, name: 'lucide:check' });`);
	assert.doesNotMatch(call, /@aweftjs\/icons/);
});

test('an Icon that is not ui\'s Icon is left alone', () => {
	const elsewhere = compile("import { h } from '@aweftjs/ui';\nimport { Icon } from './mine.ts';\n"
		+ 'export const a = <Icon name="lucide:check" />;');
	assert.doesNotMatch(elsewhere, /@aweftjs\/icons/);

	const rebound = compile(`${ui}\nconst Icon = () => null;\nexport const a = <Icon name="lucide:check" />;`);
	assert.doesNotMatch(rebound, /@aweftjs\/icons/, 'a name bound twice is not the import\'s any more');

	const none = compile("import { h } from '@aweftjs/ui';\nexport const a = <Icon name=\"lucide:check\" />;");
	assert.doesNotMatch(none, /@aweftjs\/icons/, 'a file that never imported Icon has no Icon to read');
});

test('one name written twice is imported once, and two names get two identifiers', () => {
	const twice = compile(`${ui}\nexport const a = [<Icon name="lucide:check" />, <Icon name="lucide:check" />];`);
	assert.equal(twice.split("from '@aweftjs/icons/lucide/check'").length - 1, 1);
	assert.equal(twice.split('_icon0').length - 1, 3, 'the import and both uses');

	const two = compile(`${ui}\nexport const a = [<Icon name="lucide:check" />, <Icon name="mdi:home" />];`);
	assert.match(two, /import _icon0 from '@aweftjs\/icons\/lucide\/check';/);
	assert.match(two, /import _icon1 from '@aweftjs\/icons\/mdi\/home';/);
});

test('the generated name dodges every name the file already mentions', () => {
	const code = compile(`${ui}\nconst _icon0 = 1;\nconst _icon1 = 2;\nexport const a = [<Icon name="lucide:x" />, _icon0, _icon1];`);
	assert.match(code, /^import _icon_0 from '@aweftjs\/icons\/lucide\/x';$/m);
	assert.match(code, /name: _icon_0/);
});
