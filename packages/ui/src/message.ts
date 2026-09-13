// A message: the subset of ICU MessageFormat a text token is written in (design 278).
//
// Holes, a plural and a select over `Intl.PluralRules`, and a tag around part of the sentence.
// Parsed here with no dependency, because the platform ships everything a message needs except
// the formatter, and the formatter is this file. A parse is cached by source, so a token written
// once and mounted a thousand times parses once.

import { isComponentCall } from '@aweftjs/dom';

import { assert } from './assert.ts';

/** One piece of a parsed message. */
export type Part =
	| { readonly kind: 'text'; readonly text: string }
	| { readonly kind: 'hole'; readonly name: string }
	/** `#` inside a plural: the number, formatted for the locale. */
	| { readonly kind: 'count' }
	| { readonly kind: 'plural'; readonly name: string; readonly exact: Readonly<Record<string, readonly Part[]>>; readonly branches: Readonly<Record<string, readonly Part[]>> }
	| { readonly kind: 'select'; readonly name: string; readonly branches: Readonly<Record<string, readonly Part[]>> }
	| { readonly kind: 'tag'; readonly name: string; readonly inner: readonly Part[] };

/** Reads a hole's value: the value itself, or what a cell holds now. */
export type Read = (value: unknown) => unknown;

/** What a tag's value is: a function from the inner content to what to mount in its place. */
export type Tag = (inner: unknown) => unknown;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const EXACT = /^=\d+/;
// The characters an apostrophe quotes when it stands in front of one, as ICU reads them.
const QUOTABLE = new Set(['{', '}', '<', '#']);

interface Cursor {
	readonly source: string;
	at: number;
	/** How many plurals are open, which is what gives `#` its meaning. */
	plural: number;
}

const rest = (c: Cursor): string => c.source.slice(c.at);

const skipSpace = (c: Cursor): void => {
	while (c.at < c.source.length && /\s/.test(c.source[c.at]!)) c.at += 1;
};

// Thrown after the assert, so a release build, which has no assert, still stops reading here
// and `parseMessage` shows the source as written rather than half of it.
const UNREADABLE: unique symbol = Symbol('aweft.ui.unreadable');

const fail = (c: Cursor, expected: string): never => {
	assert(false, `a text message could not be read at offset ${c.at} of ${JSON.stringify(c.source)}: expected ${expected}; write braces in pairs, name every hole, and quote a literal brace as '{'`);
	throw UNREADABLE;
};

const nameAt = (c: Cursor, what: string): string => {
	const found = NAME.exec(rest(c));
	if (found === null) return fail(c, what);
	c.at += found[0].length;
	return found[0];
};

const expect = (c: Cursor, char: string): void => {
	if (c.source[c.at] !== char) fail(c, JSON.stringify(char));
	c.at += 1;
};

/** The branches of a plural or a select: `selector {parts}` pairs up to the closing brace. */
const branchesOf = (c: Cursor, plural: boolean): { exact: Record<string, Part[]>; branches: Record<string, Part[]> } => {
	const exact: Record<string, Part[]> = {};
	const branches: Record<string, Part[]> = {};
	for (;;) {
		skipSpace(c);
		if (c.source[c.at] === '}') break;
		const found = plural ? EXACT.exec(rest(c)) : null;
		let selector: string;
		if (found !== null) {
			selector = found[0].slice(1);
			c.at += found[0].length;
		} else {
			selector = nameAt(c, plural ? 'a plural category such as one or other, or =N' : 'a select branch name');
		}
		skipSpace(c);
		expect(c, '{');
		if (plural) c.plural += 1;
		const parts = partsUntil(c, '}');
		if (plural) c.plural -= 1;
		expect(c, '}');
		(found !== null ? exact : branches)[selector] = parts;
	}
	if (branches['other'] === undefined) fail(c, 'an other branch, which every plural and select needs');
	return { exact, branches };
};

/** One `{...}` argument: a hole, a plural or a select. */
const argument = (c: Cursor): Part => {
	expect(c, '{');
	skipSpace(c);
	const name = nameAt(c, 'the name of a hole');
	skipSpace(c);
	if (c.source[c.at] === '}') {
		c.at += 1;
		return { kind: 'hole', name };
	}
	if (c.at >= c.source.length) fail(c, 'a closing brace');
	expect(c, ',');
	skipSpace(c);
	const type = nameAt(c, 'plural or select');
	skipSpace(c);
	expect(c, ',');
	if (type === 'plural') {
		const { exact, branches } = branchesOf(c, true);
		expect(c, '}');
		return { kind: 'plural', name, exact, branches };
	}
	if (type === 'select') {
		const { branches } = branchesOf(c, false);
		expect(c, '}');
		return { kind: 'select', name, branches };
	}
	return fail(c, `plural or select, not ${type}`);
};

/** A `<name>` open tag at the cursor, or null when the `<` is only a character. */
const openTag = (c: Cursor): string | null => {
	const found = /^<([A-Za-z_][A-Za-z0-9_]*)>/.exec(rest(c));
	if (found === null) return null;
	c.at += found[0].length;
	return found[1]!;
};

/** Parts up to a closing brace, a closing tag, or the end. The stop itself is left in place. */
const partsUntil = (c: Cursor, stop: '}' | '</' | ''): Part[] => {
	const parts: Part[] = [];
	let text = '';
	const flush = (): void => {
		if (text !== '') parts.push({ kind: 'text', text });
		text = '';
	};
	while (c.at < c.source.length) {
		const char = c.source[c.at]!;
		if (char === '\'') {
			const next = c.source[c.at + 1];
			if (next === '\'') {
				text += char;
				c.at += 2;
				continue;
			}
			if (next === undefined || !QUOTABLE.has(next)) {
				text += char;
				c.at += 1;
				continue;
			}
			// A quoted run: everything up to the next apostrophe is text, a doubled apostrophe
			// inside it is one, and a run nothing closes is text to the end.
			c.at += 1;
			for (;;) {
				const inner = c.source[c.at];
				if (inner === undefined) break;
				c.at += 1;
				if (inner !== '\'') {
					text += inner;
					continue;
				}
				if (c.source[c.at] === '\'') {
					text += inner;
					c.at += 1;
					continue;
				}
				break;
			}
			continue;
		}
		if (char === '}') {
			if (stop === '}') break;
			fail(c, 'text or a hole, not a closing brace with nothing open');
		}
		if (char === '{') {
			flush();
			parts.push(argument(c));
			continue;
		}
		if (char === '#' && c.plural > 0) {
			flush();
			parts.push({ kind: 'count' });
			c.at += 1;
			continue;
		}
		if (char === '<') {
			if (rest(c).startsWith('</')) {
				if (stop === '</') break;
				fail(c, 'an open tag before a closing one');
			}
			const name = openTag(c);
			if (name !== null) {
				flush();
				const inner = partsUntil(c, '</');
				const close = `</${name}>`;
				if (!rest(c).startsWith(close)) fail(c, close);
				c.at += close.length;
				parts.push({ kind: 'tag', name, inner });
				continue;
			}
		}
		text += char;
		c.at += 1;
	}
	if (stop !== '' && c.at >= c.source.length) fail(c, stop === '}' ? 'a closing brace' : 'a closing tag');
	flush();
	return parts;
};

const parsed = new Map<string, readonly Part[]>();

/**
 * Read a message.
 *
 * Params:
 *   source: the message as written
 *
 * Returns: its parts, cached by source.
 *
 * Throws: an assert, loud in development and stripped in a release build, naming the offset and
 * what was expected there. In a release build a message that cannot be read is shown as written.
 *
 * Example:
 *   parseMessage('{n, plural, one {# item} other {# items}}');
 */
export const parseMessage = (source: string): readonly Part[] => {
	const held = parsed.get(source);
	if (held !== undefined) return held;
	const c: Cursor = { source, at: 0, plural: 0 };
	let parts: readonly Part[];
	try {
		parts = partsUntil(c, '');
	} catch (fault) {
		if (fault !== UNREADABLE) throw fault;
		parts = [{ kind: 'text', text: source }];
	}
	parsed.set(source, parts);
	return parts;
};

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

// A tag the host has no tables for, or cannot read at all, falls back to the host's own, which
// is what `Intl` does for the first and refuses for the second.
const intlFor = <T>(cache: Map<string, T>, locale: string | undefined, make: (tag: string | undefined) => T): T => {
	const tag = locale ?? '';
	let held = cache.get(tag);
	if (held === undefined) {
		try {
			held = make(locale);
		} catch {
			held = make(undefined);
		}
		cache.set(tag, held);
	}
	return held;
};

const rulesFor = (locale: string | undefined): Intl.PluralRules =>
	intlFor(pluralRules, locale, (tag) => new Intl.PluralRules(tag));

const numbersFor = (locale: string | undefined): Intl.NumberFormat =>
	intlFor(numberFormats, locale, (tag) => new Intl.NumberFormat(tag));

/** A branch by name, or nothing, never reaching `Object.prototype` for a name like `constructor`. */
const branchOf = (branches: Readonly<Record<string, readonly Part[]>>, name: string): readonly Part[] | undefined =>
	(Object.hasOwn(branches, name) ? branches[name] : undefined);

/** A value by name, never reaching `Object.prototype`. */
const valueOf = (values: Readonly<Record<string, unknown>> | undefined, name: string): unknown =>
	(values !== undefined && Object.hasOwn(values, name) ? values[name] : undefined);

/** The branch a plural picks for a value: an exact match first, then the locale's category. */
const pluralBranch = (part: Extract<Part, { kind: 'plural' }>, value: unknown, locale: string | undefined): readonly Part[] => {
	const n = Number(value);
	assert(Number.isFinite(n), `a plural takes a number and ${JSON.stringify(part.name)} holds ${JSON.stringify(value)}; give it the count`);
	const exact = branchOf(part.exact, String(n));
	if (exact !== undefined) return exact;
	const category = Number.isFinite(n) ? rulesFor(locale).select(n) : 'other';
	return branchOf(part.branches, category) ?? part.branches['other']!;
};

/** What formatting produces before it is joined or mounted. */
export type Piece =
	| string
	/** A hole's value as it was given, so a cell among them can be mounted and followed. */
	| { readonly kind: 'value'; readonly value: unknown }
	| { readonly kind: 'tag'; readonly tag: Tag | null; readonly inner: readonly Piece[] };

/**
 * Format a message with its values.
 *
 * Params:
 *   parts: the parsed message
 *   values: what the holes, the plurals, the selects and the tags name
 *   locale: the tag plural rules and numbers follow; the host's own when undefined
 *   read: how a value is read where a decision needs it now, which is what follows a cell
 *
 * Returns: the pieces, in order. A hole is handed back as its value, so the caller decides
 * whether to mount it or stringify it; a plural's `#` is already a string.
 *
 * Example:
 *   formatMessage(parseMessage('{n, plural, one {# item} other {# items}}'), { n: 3 }, 'en', (v) => v);
 */
export const formatMessage = (
	parts: readonly Part[],
	values: Readonly<Record<string, unknown>> | undefined,
	locale: string | undefined,
	read: Read,
): Piece[] => {
	const pieces = (list: readonly Part[], count: unknown): Piece[] => {
		const out: Piece[] = [];
		for (const part of list) {
			if (part.kind === 'text') out.push(part.text);
			else if (part.kind === 'hole') out.push({ kind: 'value', value: valueOf(values, part.name) });
			else if (part.kind === 'count') out.push(numbersFor(locale).format(Number(count)));
			else if (part.kind === 'plural') {
				const value = read(valueOf(values, part.name));
				out.push(...pieces(pluralBranch(part, value, locale), value));
			} else if (part.kind === 'select') {
				const value = String(read(valueOf(values, part.name)));
				out.push(...pieces(branchOf(part.branches, value) ?? part.branches['other']!, count));
			} else {
				const tag = valueOf(values, part.name);
				out.push({ kind: 'tag', tag: typeof tag === 'function' ? tag as Tag : null, inner: pieces(part.inner, count) });
			}
		}
		return out;
	};
	return pieces(parts, undefined);
};

/**
 * The pieces as one string: a value read and stringified, a tag reduced to what is inside it.
 *
 * Params:
 *   pieces: what `formatMessage` answered
 *   read: how a value is read
 *
 * Returns: the text.
 *
 * Example:
 *   joinPieces(formatMessage(parts, values, locale, read), read);
 */
export const joinPieces = (pieces: readonly Piece[], read: Read): string => {
	let text = '';
	for (const piece of pieces) {
		if (typeof piece === 'string') text += piece;
		else if (piece.kind === 'value') {
			const value = read(piece.value);
			text += value === null || value === undefined ? '' : String(value);
		} else text += joinPieces(piece.inner, read);
	}
	return text;
};

/**
 * The pieces as what `mount` takes: strings, a hole's value as it is so a cell is followed, and
 * a tag replaced by what its function answers for the inner content.
 *
 * Params:
 *   pieces: what `formatMessage` answered
 *
 * Returns: an array of items.
 *
 * Example:
 *   mount(elem, mountPieces(pieces), before, context);
 */
export const mountPieces = (pieces: readonly Piece[]): unknown[] =>
	pieces.map((piece) => {
		if (typeof piece === 'string') return piece;
		if (piece.kind === 'value') {
			// A bare function in a hole is a tag's value where a hole was written, and `dom` would
			// run it as a mounter; a component call is a function too and is mountable as it is.
			assert(typeof piece.value !== 'function' || isComponentCall(piece.value),
				'a hole takes a value and was given a function; write <name>…</name> for a tag, or put the value in the hole');
			return piece.value ?? null;
		}
		const inner = mountPieces(piece.inner);
		return piece.tag === null ? inner : piece.tag(inner);
	});
