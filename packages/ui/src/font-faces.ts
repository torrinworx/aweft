// `@font-face` directives for one family, from a list of its files (design 316).

import { assert } from './assert.ts';
import type { Entry } from './sheet.ts';

/** One file of a family: where it is, and which weights, style and characters it holds. */
export interface FontFile {
	/** The file's URL. Its extension names the `format()`. */
	readonly src: string;
	/** A weight, such as `400`, or a variable file's range as two numbers, such as `'200 900'`. */
	readonly weight?: number | string;
	/** `normal` unless set. */
	readonly style?: 'normal' | 'italic';
	/** A `unicode-range`, so the browser fetches the file only for a character in it. */
	readonly range?: string;
}

const FORMATS: Readonly<Record<string, string>> = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };

const quoted = (text: string): string => `"${text.replace(/["\\]/g, '\\$&')}"`;

const formatOf = (src: string): string | undefined => {
	const path = src.replace(/[?#].*$/, '');
	const dot = path.lastIndexOf('.');
	return dot === -1 ? undefined : FORMATS[path.slice(dot + 1).toLowerCase()];
};

const inRange = (weight: number): boolean => Number.isFinite(weight) && weight >= 1 && weight <= 1000;

const isWeight = (weight: number | string): boolean => (typeof weight === 'number'
	? inRange(weight)
	: /^\d{1,4}( \d{1,4})?$/.test(weight) && weight.split(' ').every((part) => inRange(Number(part))));

/**
 * The `_fontFace_` directives for one family, one per file, as a theme entry to spread into the
 * entry the page's root wears.
 *
 * Params:
 *   family: the family's name, as `fontFamily` names it elsewhere in the theme
 *   files: each file's `src`, and its `weight`, `style` and `range` where it has them
 *   options.display: `font-display` for every face, `swap` unless given
 *
 * Returns: an entry holding one directive per file, keyed by the family, the file and the face it
 * declares, so two calls spread into one entry keep every face, and so does one file declared
 * twice. Each face says its family and its URL quoted, a `format()` named from the URL's extension
 * (`woff2`, `woff`, `ttf`, `otf`), its weight when given, its style, its display and its range when
 * given. The theme engine emits each once per render, however many elements wear the entry.
 *
 * Throws: the assert for an empty family, an empty list, a file with no `src`, a weight that is
 * not one number from 1 to 1000 or two of them, a style that is neither word, and a `$` in the
 * family or a `src`, which the stylesheet would read as a theme variable.
 *
 * Example:
 *   Theme.define({ page: {
 *     ...fontFaces('IBM Plex Sans', [
 *       { src: '/plex/Regular.woff2', weight: 400 },
 *       { src: '/plex/Italic.woff2', weight: 400, style: 'italic' },
 *     ]),
 *     fontFamily: '"IBM Plex Sans", $font',
 *   } });
 */
export const fontFaces = (family: string, files: readonly FontFile[], options: { readonly display?: string } = {}): Entry => {
	assert(typeof family === 'string' && family.trim() !== '', 'fontFaces needs the family\'s name, such as \'IBM Plex Sans\'');
	// A $ in a theme value starts a variable, which the stylesheet replaces with its value.
	assert(!family.includes('$'), `${family} holds a $, which the stylesheet reads as a theme variable; name the family without one`);
	assert(files.length > 0, `fontFaces was given no files for ${family}; list each file with its src`);
	const entry: Record<string, Record<string, string>> = {};
	for (const file of files) {
		assert(typeof file.src === 'string' && file.src !== '', `a file of ${family} has no src; give each file its URL`);
		assert(!file.src.includes('$'), `${file.src} holds a $, which the stylesheet reads as a theme variable; write it as %24 in the URL`);
		assert(file.weight === undefined || isWeight(file.weight),
			`${file.src} has the weight ${JSON.stringify(file.weight)}; give a number from 1 to 1000, or two in a string for a variable file`);
		assert(file.style === undefined || file.style === 'normal' || file.style === 'italic',
			`${file.src} has the style ${JSON.stringify(file.style)}; give 'normal' or 'italic'`);
		const format = formatOf(file.src);
		const face: Record<string, string> = {
			fontFamily: quoted(family),
			src: `url(${quoted(file.src)})${format === undefined ? '' : ` format("${format}")`}`,
		};
		if (file.weight !== undefined) face['fontWeight'] = String(file.weight);
		face['fontStyle'] = file.style ?? 'normal';
		face['fontDisplay'] = options.display ?? 'swap';
		if (file.range !== undefined) face['unicodeRange'] = file.range;
		// One file may be declared twice, upright and slanted, so the key says the face, not the file.
		entry[`_fontFace_${[family, file.src, face['fontStyle'], face['fontWeight'], file.range].filter((part) => part !== undefined).join(' ')}`] = face;
	}
	return entry;
};
