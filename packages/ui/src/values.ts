// The value language: `$name`, `$fn(a, b)`, `$$`, and the property names a bare number is
// given `px` for.
//
// A value is read once into parts and resolved as often as it is used. `$size$px` works
// because a `$` both ends a name and starts the next one, so the reader hands the terminator
// back rather than eating it.

import { assert } from './assert.ts';

/** One piece of a parsed value: literal text, a variable, or a call. */
export type Part =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'var'; readonly name: string }
	| { readonly kind: 'call'; readonly name: string; readonly args: Part[][] };

const NAME = /[A-Za-z0-9_-]/;

interface Reader {
	readonly source: string;
	at: number;
}

const readName = (reader: Reader): string => {
	const start = reader.at;
	while (reader.at < reader.source.length && NAME.test(reader.source[reader.at]!)) reader.at += 1;
	return reader.source.slice(start, reader.at);
};

const readParts = (reader: Reader, stop: string): Part[] => {
	const parts: Part[] = [];
	let text = '';
	const flush = (): void => {
		if (text !== '') parts.push({ kind: 'text', text });
		text = '';
	};

	while (reader.at < reader.source.length) {
		const char = reader.source[reader.at]!;
		if (stop.includes(char)) break;
		if (char !== '$') {
			text += char;
			reader.at += 1;
			continue;
		}
		reader.at += 1;
		if (reader.source[reader.at] === '$') {
			text += '$';
			reader.at += 1;
			continue;
		}
		const name = readName(reader);
		if (name === '') {
			text += '$';
			continue;
		}
		if (reader.source[reader.at] === '(') {
			reader.at += 1;
			const args: Part[][] = [];
			// An empty argument list is `$fn()`, not one empty argument.
			if (reader.source[reader.at] === ')') reader.at += 1;
			else {
				for (;;) {
					args.push(readParts(reader, ',)'));
					const ended = reader.source[reader.at];
					reader.at += 1;
					if (ended !== ',') break;
				}
			}
			flush();
			parts.push({ kind: 'call', name, args });
			continue;
		}
		flush();
		parts.push({ kind: 'var', name });
		// A name ends at the first character that cannot be in one, and when that character is
		// itself a `$` it is the terminator rather than the start of the next name. That is what
		// makes `$size$px` the variable followed by the text `px`.
		if (reader.source[reader.at] === '$') reader.at += 1;
	}
	flush();
	return parts;
};

/**
 * Read a theme value into its parts.
 *
 * Params:
 *   text: the value as written, with `$name`, `$fn(a, b)` and `$$` in it
 *
 * Returns: the parts, in order. Plain text with no `$` in it is one text part.
 *
 * Example:
 *   parseValue('1px solid $shiftBrightness($color, -0.2)');
 */
export const parseValue = (text: string): Part[] => readParts({ source: text, at: 0 }, '');

/**
 * A theme function: the resolved arguments in, the value out.
 *
 * A function is theme data rather than a table in this package. It sits in an entry beside the
 * variables, under a `$name` key, and the same precedence walk finds it, so an application's
 * theme can add one and a nested theme can shadow one (design 111). The colour and arithmetic
 * functions ship as entries of the default theme.
 */
export type ThemeFunction = (args: string[]) => string;

/** What a value needs to resolve: what a `$name` holds, and what a `$name(` calls. */
export interface Lookup {
	/** The value of a variable, or null when nothing in the chain defines it. */
	variable(name: string): string | null;
	/** The function of that name, or null when nothing in the chain defines one. */
	call(name: string): ThemeFunction | null;
}

/** A number out of a CSS value, ignoring a unit. What the arithmetic functions read their arguments with. */
export const numeric = (text: string): number => {
	const value = Number(text.trim().replace(/(px|%|em|rem|deg)$/, ''));
	return Number.isFinite(value) ? value : 0;
};

/** A lookup that defines nothing, for a value resolved with no theme in effect. */
export const NO_THEME: Lookup = { variable: () => null, call: () => null };

/**
 * Resolve parsed parts to text.
 *
 * Params:
 *   parts: what `parseValue` read
 *   lookup: what a `$name` holds and what a `$name(` calls, both from the theme in effect
 *
 * Returns: the resolved text. A `$name` nothing defines resolves to nothing. A `$name(` nothing
 * defines is written back out as it was read, separators and all, so `calc()`, `rgb()` and every
 * other CSS function survive untouched.
 *
 * Example:
 *   resolve(parseValue('$radius$px'), { variable: (n) => (n === 'radius' ? '4' : null), call: () => null });
 */
export const resolve = (parts: readonly Part[], lookup: Lookup): string => {
	let out = '';
	for (const part of parts) {
		if (part.kind === 'text') out += part.text;
		else if (part.kind === 'var') out += lookup.variable(part.name) ?? '';
		else {
			const args = part.args.map((arg) => resolve(arg, lookup));
			const fn = lookup.call(part.name);
			out += fn === null ? `${part.name}(${args.join(',')})` : fn(args);
		}
	}
	return out;
};

/**
 * The property names a bare number is written in pixels for.
 *
 * A theme or a `style` prop may say `padding: 8`, and these are the properties where 8 means
 * eight pixels rather than the number eight. Everything else keeps the number as written, so
 * `flexGrow: 1` and `zoom: 2` are not broken by the convenience.
 */
export const sizeProperties: ReadonlySet<string> = new Set([
	'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
	'top', 'right', 'bottom', 'left', 'inset',
	'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
	'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
	'gap', 'rowGap', 'columnGap', 'fontSize', 'lineHeight', 'letterSpacing',
	'borderRadius', 'borderWidth', 'outlineWidth', 'outlineOffset', 'strokeWidth',
	'flexBasis', 'translate', 'textIndent',
]);

const kebab = (name: string): string =>
	(name.startsWith('--') ? name : name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));

/** One CSS declaration's value, with a bare number in a size property given `px`. */
export const declarationValue = (name: string, value: unknown): string => {
	assert(value !== undefined, `a style value cannot be undefined; use null to leave ${name} unset`);
	if (typeof value === 'number' && sizeProperties.has(name)) return `${value}px`;
	return String(value);
};

/** A property name as CSS spells it. A custom property is left as written. */
export const cssName = (name: string): string => kebab(name);
