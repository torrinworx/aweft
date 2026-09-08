// The theme engine: definitions in, class names and CSS out.
//
// Definitions are static data written at import time, and are shared by every render. What a
// definition compiled to for one page is not: the class cache and the `<style>` text belong to
// the render that asked for them (design 109), so two pages rendered at once cannot see each
// other's classes.
//
// An element's `theme` prop flattens to a class list. An entry matches when its `_`-joined
// segments are a subsequence of that list, so `button_hovered` matches `button_primary_hovered`
// but `hovered_button` does not. The matches, ordered, are the define chain, and later in the
// chain wins.

import { type Derived, mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { warnOnContrast } from './contrast.ts';
import { type Lookup, type ThemeFunction, cssName, declarationValue, parseValue, resolve } from './values.ts';

/** One theme entry: CSS declarations, `$var` definitions, `extends`, and `_directive_` blocks. */
export type Entry = Readonly<Record<string, unknown>>;

/** A whole theme: entries by `_`-joined selector path. */
export type Definitions = Readonly<Record<string, Entry>>;

const LAYER = 'aweft';

// A key naming one of these is a pseudo-element and gets two colons. Everything else is a
// pseudo-class and gets one, which is the fix for a `_cssProp_focus` that matched nothing.
const PSEUDO_ELEMENTS: ReadonlySet<string> = new Set([
	'before', 'after', 'first-line', 'first-letter', 'marker', 'selection', 'placeholder',
	'backdrop', 'file-selector-button', 'target-text', 'grammar-error', 'spelling-error',
	'view-transition', 'view-transition-group', 'view-transition-image-pair',
	'view-transition-old', 'view-transition-new',
]);

// A key of the shape `_name_rest`. The name says what to do with the block and the rest is that
// directive's argument: `_elem_`, `_children_` and `_cssProp_` build a selector, `_media_` and
// `_container_` wrap the rule in a query, `_starting_` wraps it in `@starting-style` and takes no
// argument, and `_keyframes_`, `_fontFace_` and `_import_` leave the entry body altogether
// (designs 111, 190). A directive block holds declarations and one more directive: two levels of
// wrapping, so a query can hold a pseudo-element and a pseudo-element can hold a starting style.
const DIRECTIVE = /^_([A-Za-z]+)_([\s\S]*)$/;

// Every directive there is. A key of that shape naming anything else is a typo, and a typo used to
// emit nothing at all: `_medai_(min-width: 10px)` compiled to no rule and said nothing, so the
// query simply never applied and the entry looked correct in the source.
const DIRECTIVES: ReadonlySet<string> = new Set([
	'elem', 'children', 'cssProp', 'media', 'container', 'starting', 'keyframes', 'fontFace', 'import',
]);
const DIRECTIVE_NAMES = [...DIRECTIVES].join(', ');

// How many directives deep a block may go: the entry's own keys, then one level under those.
// Deeper than that emits nothing at all (design 190, amended).
const NESTING = 2;

// --- the registry ------------------------------------------------------------------------

const registry: Record<string, Entry> = {};

const same = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	// A theme function is data, and a module loaded twice defines the same function twice under
	// two identities. Its source is what says whether the second one is the same function.
	if (typeof a === 'function' && typeof b === 'function') return String(a) === String(b);
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) return false;
	return keys.every((key) => same(left[key], right[key]));
};

const listOf = (value: unknown): string[] => {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value.map(String) : [String(value)];
};

// --- what a theme says, as a string --------------------------------------------------------

const written = (value: unknown): string => {
	// A function is theme data, so two copies of one module define the same function twice. Its
	// source is what says whether they are the same, as `same()` reads it above.
	if (typeof value === 'function') return `f${JSON.stringify(String(value))}`;
	if (value === null || value === undefined) return 'n';
	if (Array.isArray(value)) return `[${value.map(written).join(',')}]`;
	if (typeof value !== 'object') return JSON.stringify(value) ?? 'u';
	const held = value as Record<string, unknown>;
	return `{${Object.keys(held).sort().map((key) => `${JSON.stringify(key)}:${written(held[key])}`).join(',')}}`;
};

// Read once per object. A theme written inline is a fresh object on every mount, so what a cache
// keyed on identity sees is a new theme every time; what this sees is the same one.
const contents = new WeakMap<object, string>();

/**
 * What a theme says, as a string, so two objects that say the same thing key the same.
 *
 * Params:
 *   definitions: the theme
 *
 * Returns: the same string for any two themes with the same entries, whatever order their keys
 * were written in and whatever objects they are. Functions compare by their source.
 */
export const contentKey = (definitions: Definitions): string => {
	const held = contents.get(definitions);
	if (held !== undefined) return held;
	const key = written(definitions);
	contents.set(definitions, key);
	return key;
};

/**
 * Add entries to the theme every render starts from.
 *
 * Params:
 *   entries: entries by `_`-joined selector path
 *
 * Returns: nothing. Entries merge property by property, so two modules may both add to `*`, and
 * writing the same property twice with the same value is a no-op: a module loaded twice, and two
 * copies of a package in one bundle, are both fine.
 *
 * Throws: an assert, loud in development and stripped in a release build, when one property of
 * one entry is defined twice with two different values, and when a key has an empty segment
 * (`a__b`, `a_`), which no element can ever match.
 *
 * Example:
 *   defineTheme({ button: { background: '$colour' }, button_hovered: { background: '$hover' } });
 */
export const defineTheme = (entries: Definitions): void => {
	for (const key of Object.keys(entries)) {
		// A key is matched segment by segment against a class list that has no empty segments in
		// it, so a key with one can never match anything and is a typo every time.
		if (key.split('_').includes('')) {
			assert(false, `the theme key ${key} has an empty segment, so no element can ever match it; write ${key.split('_').filter((part) => part !== '').join('_')}`);
			continue;
		}
		const given = entries[key]!;
		const held = registry[key];
		if (held === undefined) {
			registry[key] = { ...given };
			continue;
		}
		// Entries merge property by property, because `*` and every shared entry are written by
		// more than one module. What is refused is one property said twice with two answers.
		const merged = { ...held } as Record<string, unknown>;
		for (const property of Object.keys(given)) {
			const before = merged[property];
			if (before !== undefined && !same(before, given[property])) {
				assert(false, `the theme entry ${key} already sets ${property} to something else; give the second one another name`);
				continue;
			}
			merged[property] = given[property];
		}
		registry[key] = merged;
	}
};

/** The entries every render starts from. A fresh object each call, so nothing holds the store. */
export const baseTheme = (): Definitions => ({ ...registry });

/** Forget everything defined so far. A test seam; not exported from the package. */
export const forgetTheme = (): void => {
	for (const key of Object.keys(registry)) delete registry[key];
};

/**
 * Merge a partial theme onto another, entry by entry.
 *
 * `extends` is the one key that concatenates rather than replaces, so a nested theme adds to
 * what it inherits. A child whose `extends` list starts with `*` replaces instead.
 */
export const mergeTheme = (base: Definitions, over: Definitions): Definitions => {
	const out: Record<string, Entry> = { ...base };
	for (const key of Object.keys(over)) {
		const held = out[key];
		const given = over[key]!;
		if (held === undefined) {
			out[key] = given;
			continue;
		}
		const merged: Record<string, unknown> = { ...held, ...given };
		const inherited = listOf(held['extends']);
		const added = listOf(given['extends']);
		if (added.length > 0) merged['extends'] = added[0] === '*' ? added.slice(1) : [...inherited, ...added];
		out[key] = merged;
	}
	return out;
};

// --- matching ----------------------------------------------------------------------------

/**
 * Whether `segments` appear inside `classes` in order, and where the last one sits.
 *
 * A class token without `_` is a segment: it matches one segment of the entry, and the entry's
 * segments have to appear in order with gaps allowed. A class token holding `_` names a part, and
 * a part is all or nothing: it matches that whole run of the entry's segments or none of it, so
 * `filedrop_entry` reaches the entry of that name and no longer reaches the bare `filedrop`
 * (design 193).
 */
const matchAt = (segments: readonly string[], classes: readonly string[]): number => {
	const need = segments.length;
	// Where each count of consumed segments was first reached, or -2 for nowhere yet. Taking the
	// first arrival keeps the answer the earliest match, which is what the old walk gave and what
	// the chain's ordering is read from. A part consumes several segments at once, so a plain
	// token that took one of them early can leave the part with nothing to match; the whole row is
	// carried rather than one position, so that path is not the only one tried.
	const reached: number[] = new Array<number>(need + 1).fill(-2);
	reached[0] = -1;

	for (let at = 0; at < classes.length; at += 1) {
		const token = classes[at]!;
		const parts = token.includes('_') ? token.split('_') : null;
		const width = parts === null ? 1 : parts.length;
		// Walked from the far end, so a token cannot feed a state it has just reached and match
		// itself twice.
		for (let k = need - width; k >= 0; k -= 1) {
			if (reached[k] === -2 || reached[k + width] !== -2) continue;
			let same = true;
			if (parts === null) same = segments[k] === token;
			else for (let i = 0; i < width; i += 1) if (segments[k + i] !== parts[i]) { same = false; break; }
			if (same) reached[k + width] = at;
		}
		if (reached[need] !== -2) return reached[need]!;
	}
	return -1;
};

/**
 * The entries a class list reaches, lowest precedence first.
 *
 * Params:
 *   definitions: the theme in effect
 *   classes: the flattened `theme` prop, with `*` already in front of it
 *
 * Returns: entry names in the order they apply. An entry's `extends` list is expanded in
 * front of it, so what it extends applies first and it wins over it.
 *
 * Example:
 *   chainOf(defs, ['*', 'button', 'hovered']);   // ['*', 'button', 'button_hovered']
 */
export const chainOf = (definitions: Definitions, classes: readonly string[]): string[] => {
	const scored: { name: string; last: number; length: number }[] = [];
	for (const name of Object.keys(definitions)) {
		const segments = name.split('_');
		const last = matchAt(segments, classes);
		if (last >= 0) scored.push({ name, last, length: segments.length });
	}
	scored.sort((a, b) => (a.last - b.last) || (a.length - b.length) || (a.name < b.name ? -1 : 1));

	const out: string[] = [];
	const seen = new Set<string>();
	const push = (name: string, depth: number): void => {
		if (seen.has(name) || depth > 8) return;
		seen.add(name);
		for (const parent of listOf(definitions[name]?.['extends'])) {
			if (parent !== '*' && definitions[parent] !== undefined) push(parent, depth + 1);
		}
		out.push(name);
	};
	for (const entry of scored) push(entry.name, 0);
	return out;
};

// --- compiling ---------------------------------------------------------------------------

interface Compiled {
	/** The rule blocks for this chain, in the order they go into the layer. */
	readonly rules: string[];
	/** At-rules that belong to a definition rather than to this chain: fonts and keyframes. */
	readonly atRules: { readonly key: string; readonly css: string }[];
	/** Stylesheet imports, which sit above the layer. */
	readonly imports: string[];
	/** What a `$name` in this chain resolves to, and what a `$name(` calls. */
	readonly lookup: Lookup;
	/** The variables alone, for a caller that wants to read one. */
	readonly variables: Map<string, string>;
}

const isBlock = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** One rule body, with `$var` and `$fn()` resolved. */
const declarations = (block: Record<string, unknown>, lookup: Lookup): string => {
	const out: string[] = [];
	for (const key of Object.keys(block)) {
		if (key === 'extends' || key[0] === '$' || DIRECTIVE.test(key)) continue;
		const value = block[key];
		if (value === null || value === undefined) continue;
		// A list is the property said once per item, in order. A host that cannot read the later
		// value drops that declaration and keeps the one before it, which is how CSS has always
		// spelled a fallback and is the only way an object with one value per key can say it.
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item === null || item === undefined) continue;
			out.push(`${cssName(key)}: ${resolve(parseValue(declarationValue(key, item)), lookup)};`);
		}
	}
	return out.join(' ');
};

const pseudo = (rest: string): string => {
	if (rest.startsWith(':')) return rest;
	const bare = rest.split('(')[0]!;
	return `${PSEUDO_ELEMENTS.has(bare) ? '::' : ':'}${rest}`;
};

/** Where a rule is written: the selector, and the at-rules wrapped around it, outermost first. */
interface Frame {
	readonly selector: string;
	readonly at: readonly string[];
}

/** The frame a directive puts its block in, or null when the directive is not one that wraps. */
const framed = (frame: Frame, kind: string, rest: string): Frame | null => {
	if (kind === 'elem') return { selector: `${rest} ${frame.selector}`, at: frame.at };
	if (kind === 'children') return { selector: `${frame.selector} > ${rest}`, at: frame.at };
	if (kind === 'cssProp') return { selector: `${frame.selector}${pseudo(rest)}`, at: frame.at };
	if (kind === 'media') return { selector: frame.selector, at: [...frame.at, `@media ${rest}`] };
	if (kind === 'container') return { selector: frame.selector, at: [...frame.at, `@container ${rest}`] };
	// The style an element is transitioned from on the frame it is first rendered. There is nothing
	// to write after the name, so anything after it is ignored.
	if (kind === 'starting') return { selector: frame.selector, at: [...frame.at, '@starting-style'] };
	return null;
};

/** One rule body inside its frame, at-rules wrapped from the inside out. */
const wrapped = (frame: Frame, body: string): string => {
	let out = `${frame.selector} { ${body} }`;
	for (let i = frame.at.length - 1; i >= 0; i -= 1) out = `${frame.at[i]!} { ${out} }`;
	return out;
};

/**
 * Write one block's rules: its own declarations, then whatever a directive inside it wraps.
 *
 * `depth` is how many more directives deep this may go. A block at depth zero is declarations
 * only, so nothing nests past the level design 190 allows and a fourth level emits nothing.
 */
const emitBlock = (
	rules: string[],
	frame: Frame,
	block: Record<string, unknown>,
	lookup: Lookup,
	depth: number,
): void => {
	const body = declarations(block, lookup);
	if (body !== '') rules.push(wrapped(frame, body));
	if (depth <= 0) return;

	for (const key of Object.keys(block)) {
		const found = DIRECTIVE.exec(key);
		if (found === null) continue;
		if (!DIRECTIVES.has(found[1]!)) {
			assert(false, `unknown directive \`${found[1]!}\` in the theme key ${key}; `
				+ `the directives are ${DIRECTIVE_NAMES}`);
			continue;
		}
		const value = block[key];
		if (!isBlock(value)) continue;
		const inner = framed(frame, found[1]!, found[2]!);
		if (inner === null) continue;
		emitBlock(rules, inner, value, lookup, depth - 1);
	}
};

// A definition's keyframes and fonts are named after the definition, not after the chain that
// reached them, so two chains that both reach an entry emit the block once (design 111).
const stableName = (text: string): string => {
	let hash = 2166136261;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
};

/**
 * Compile one define chain into CSS.
 *
 * Params:
 *   definitions: the theme in effect
 *   chain: the entry names, lowest precedence first
 *   className: the generated class the rules are written against
 *
 * Returns: the rules, the at-rules keyed so each is emitted once, the imports, and what each
 * `$name` in the chain resolves to.
 *
 * Example:
 *   compileChain(defs, chainOf(defs, ['*', 'button']), 'aw0');
 */
export const compileChain = (
	definitions: Definitions,
	chain: readonly string[],
	className: string,
): Compiled => {
	const variables = new Map<string, string>();
	const functions = new Map<string, ThemeFunction>();
	const atRules: { key: string; css: string }[] = [];
	const imports: string[] = [];

	// A `$name` is supplied by the most specific entry in the chain that defines it, so a generic
	// entry writes `$hover` once and every component supplies its own. A function is the same
	// `$name` namespace with a function on the other side of the colon, so a nested theme shadows
	// one exactly as it shadows a variable.
	for (let i = chain.length - 1; i >= 0; i -= 1) {
		const entry = definitions[chain[i]!];
		if (entry === undefined) continue;
		for (const key of Object.keys(entry)) {
			if (key[0] !== '$') continue;
			const name = key.slice(1);
			const value = entry[key];
			if (typeof value === 'function') {
				if (!functions.has(name)) functions.set(name, value as ThemeFunction);
				continue;
			}
			if (!variables.has(name)) variables.set(name, String(value));
		}
		for (const key of Object.keys(entry)) {
			const found = DIRECTIVE.exec(key);
			if (found === null || found[1] !== 'keyframes') continue;
			const name = `${found[2]}-${stableName(chain[i]! + String(entry[key]))}`;
			if (!variables.has(found[2]!)) variables.set(found[2]!, name);
		}
	}

	const lookup: Lookup = {
		variable: (name) => variables.get(name) ?? null,
		call: (name) => functions.get(name) ?? null,
	};
	const rules: string[] = [];
	const selector = `.${className}`;

	for (const name of chain) {
		const entry = definitions[name];
		if (entry === undefined) continue;

		// The three that leave the entry body altogether. They are not a frame around this rule, so
		// they are taken out here and the rest of the entry goes through the nesting walk.
		for (const key of Object.keys(entry)) {
			const found = DIRECTIVE.exec(key);
			if (found === null) continue;
			const kind = found[1]!;
			const rest = found[2]!;
			const value = entry[key];

			if (kind === 'keyframes') {
				const generated = variables.get(rest) ?? rest;
				atRules.push({ key: `keyframes:${generated}`, css: `@keyframes ${generated} { ${String(value)} }` });
			} else if (kind === 'fontFace') {
				const css = isBlock(value) ? declarations(value, lookup) : String(value);
				atRules.push({ key: `fontFace:${rest}:${stableName(css)}`, css: `@font-face { ${css} }` });
			} else if (kind === 'import') {
				const url = isBlock(value) ? String(value['url'] ?? '') : String(value);
				if (url !== '') imports.push(`@import url(${JSON.stringify(url)}) layer(${LAYER});`);
			}
		}

		emitBlock(rules, { selector, at: [] }, entry as Record<string, unknown>, lookup, NESTING);
	}

	// Dev-only bookkeeping: the whole statement leaves a release build (designs 097, 120), so a
	// shipped page pays nothing for the walk or the measurement.
	assert(
		warnOnContrast(
			chain.map((name) => definitions[name]).filter((entry) => entry !== undefined),
			lookup,
			chain[chain.length - 1] ?? '*',
		),
		'the contrast warning never refuses a theme',
	);

	return { rules, atRules, imports, lookup, variables };
};

// --- the per-render sheet ------------------------------------------------------------------

/** The theme systems for one render: its class cache and its stylesheet. */
export interface Sheet {
	/**
	 * The generated class name for a theme list, made once per render per chain.
	 *
	 * Params:
	 *   definitions: the theme in effect where the element sits
	 *   classes: the flattened `theme` prop, without `*`
	 */
	classes(definitions: Definitions, classes: readonly string[]): string;
	/** What a `$name` resolves to for that same chain, or null when nothing defines it. */
	variable(definitions: Definitions, classes: readonly string[], name: string): string | null;
	/** The function of that name for that chain, or null when nothing defines one. */
	call(definitions: Definitions, classes: readonly string[], name: string): ThemeFunction | null;
	/** Resolve a whole value against that chain, `$var` and `$fn()` and all. */
	value(definitions: Definitions, classes: readonly string[], text: string): string;
	/** The theme this render starts from: the entries every `defineTheme` has written. */
	base(): Definitions;
	/** The whole stylesheet as it stands. */
	markup(): string;
	/** The cell a `<style>` element's text follows. */
	readonly text: Derived<string>;
}

/**
 * Make the theme systems for one render.
 *
 * Returns: a sheet holding nothing from any other render. Nothing is emitted until an element
 * asks for a class.
 *
 * Example:
 *   const sheet = createSheet();
 *   sheet.classes(baseTheme(), ['button']);   // 'aw0'
 */
export const createSheet = (): Sheet => {
	// Keyed on what a theme says, not on which object said it, so a `<Theme value={{...}}>`
	// written inline gets one class for every mount rather than one class per mount.
	const cache = new Map<string, Map<string, { className: string; lookup: Lookup; variables: Map<string, string> }>>();
	const imports: string[] = [];
	const seenImports = new Set<string>();
	const atRules: string[] = [];
	const seenAtRules = new Set<string>();
	const rules: string[] = [];
	let counter = 0;
	let snapshot: Definitions | null = null;

	const text = mutable('');
	const markup = (): string => {
		const body = [...atRules, ...rules];
		if (body.length === 0 && imports.length === 0) return '';
		return [...imports, `@layer ${LAYER} {`, ...body.map((line) => `  ${line}`), '}'].join('\n');
	};

	const compiled = (definitions: Definitions, classes: readonly string[]) => {
		const theme = contentKey(definitions);
		let byChain = cache.get(theme);
		if (byChain === undefined) {
			byChain = new Map();
			cache.set(theme, byChain);
		}
		const key = classes.join(' ');
		const held = byChain.get(key);
		if (held !== undefined) return held;

		const chain = chainOf(definitions, ['*', ...classes]);
		const className = `aw${counter}`;
		counter += 1;
		const out = compileChain(definitions, chain, className);
		const made = { className, lookup: out.lookup, variables: out.variables };
		byChain.set(key, made);

		for (const line of out.imports) {
			if (seenImports.has(line)) continue;
			seenImports.add(line);
			imports.push(line);
		}
		for (const rule of out.atRules) {
			if (seenAtRules.has(rule.key)) continue;
			seenAtRules.add(rule.key);
			atRules.push(rule.css);
		}
		rules.push(...out.rules);
		text.set(markup());
		return made;
	};

	return {
		// Taken once, and held, because the class cache is keyed on this object's identity.
		base: () => (snapshot ??= baseTheme()),
		classes: (definitions, classes) => compiled(definitions, classes).className,
		variable: (definitions, classes, name) => compiled(definitions, classes).variables.get(name) ?? null,
		call: (definitions, classes, name) => compiled(definitions, classes).lookup.call(name),
		value: (definitions, classes, text) => resolve(parseValue(text), compiled(definitions, classes).lookup),
		markup,
		text,
	};
};
