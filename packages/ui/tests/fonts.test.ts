// `@font-face` directives for one family, from a list of its files (design 316).

import test from 'node:test';
import assert from 'node:assert/strict';

import { Theme, context, fontFaces, h, render } from '@aweftjs/ui';
import type { Entry } from '@aweftjs/ui';

/** The stylesheet a render writes for a page whose root wears an entry holding these faces. */
const sheetOf = async (entry: Entry): Promise<string> => {
	const ui = context();
	await render(h(Theme, { value: { fontpage: entry } }, h('main', { theme: 'fontpage' })), { context: ui });
	return ui.theme.markup();
};

const faces = (css: string): string[] => [...css.matchAll(/@font-face \{ ([^}]*) \}/g)].map((match) => match[1]!.trim());

test('each file is one face, quoted, with its format, weight, style, display and range', async () => {
	const css = await sheetOf({
		...fontFaces('IBM Plex Sans', [
			{ src: '/plex/Regular.woff2', weight: 400 },
			{ src: '/plex/Italic.woff', weight: 400, style: 'italic' },
			{ src: '/serif/Variable.ttf?v=2', weight: '200 900', range: 'U+0000-00FF, U+0131' },
			{ src: '/mono/Mono.otf' },
			{ src: '/old/Face.eot' },
			{ src: '/caps/Face.WOFF2' },
		]),
		color: 'red',
	});
	assert.deepEqual(faces(css), [
		'font-family: "IBM Plex Sans"; src: url("/plex/Regular.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap;',
		'font-family: "IBM Plex Sans"; src: url("/plex/Italic.woff") format("woff"); font-weight: 400; font-style: italic; font-display: swap;',
		'font-family: "IBM Plex Sans"; src: url("/serif/Variable.ttf?v=2") format("truetype"); font-weight: 200 900; font-style: normal; font-display: swap; unicode-range: U+0000-00FF, U+0131;',
		'font-family: "IBM Plex Sans"; src: url("/mono/Mono.otf") format("opentype"); font-style: normal; font-display: swap;',
		'font-family: "IBM Plex Sans"; src: url("/old/Face.eot"); font-style: normal; font-display: swap;',
		'font-family: "IBM Plex Sans"; src: url("/caps/Face.WOFF2") format("woff2"); font-style: normal; font-display: swap;',
	]);
	assert.match(css, /color: red/, 'the entry the faces were spread into keeps its own declarations');
});

test('a quote or a backslash in the family or the URL is escaped, and the display can be named', async () => {
	const css = await sheetOf(fontFaces('My "Odd" Face', [{ src: '/a\\b"c.woff2' }], { display: 'block' }));
	assert.deepEqual(faces(css), [
		'font-family: "My \\"Odd\\" Face"; src: url("/a\\\\b\\"c.woff2") format("woff2"); font-style: normal; font-display: block;',
	]);
});

test('two calls spread into one entry keep every face', async () => {
	const css = await sheetOf({
		...fontFaces('Mono', [{ src: '/mono/Regular.woff2', weight: 400 }]),
		...fontFaces('Serif', [{ src: '/serif/Regular.woff2', weight: 400 }]),
		...fontFaces('Mono', [{ src: '/mono/Bold.woff2', weight: 700 }]),
	});
	assert.equal(faces(css).length, 3);
	assert.deepEqual(Object.keys(fontFaces('Mono', [{ src: '/a.woff2' }, { src: '/b.woff2', weight: 700, range: 'U+0000-00FF' }])), [
		'_fontFace_Mono /a.woff2 normal', '_fontFace_Mono /b.woff2 normal 700 U+0000-00FF',
	]);
	const twice = await sheetOf(fontFaces('Var', [{ src: '/v.woff2', weight: '100 900' }, { src: '/v.woff2', weight: '100 900', style: 'italic' }]));
	assert.deepEqual(faces(twice).map((face) => /font-style: (\w+)/.exec(face)?.[1]), ['normal', 'italic'], 'one file declared upright and slanted is two faces');
});

test('an empty family, list or source, a weight out of range and a style that is not a word are loud', () => {
	const bad: [() => unknown, RegExp][] = [
		[() => fontFaces('', [{ src: '/a.woff2' }]), /the family's name/],
		[() => fontFaces('  ', [{ src: '/a.woff2' }]), /the family's name/],
		[() => fontFaces('Mono', []), /no files for Mono/],
		[() => fontFaces('Mono', [{ src: '' }]), /a file of Mono has no src/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: 0 }]), /weight 0/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: 1001 }]), /weight 1001/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: 'bold' }]), /weight "bold"/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: Number.NaN }]), /weight null/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: '5000' }]), /weight "5000"/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: '0 0' }]), /weight "0 0"/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', weight: '100 1001' }]), /weight "100 1001"/],
		[() => fontFaces('Mono', [{ src: '/a.woff2', style: 'oblique' as 'italic' }]), /style "oblique"/],
	];
	for (const [call, said] of bad) assert.throws(call, said);
	assert.doesNotThrow(() => fontFaces('Mono', [{ src: '/a.woff2', weight: 1 }, { src: '/b.woff2', weight: 1000 }, { src: '/c.woff2', weight: '100 900' }]));
});
