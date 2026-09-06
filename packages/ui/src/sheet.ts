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

const DIRECTIVE = /^_([A-Za-z]+)_([\s\S]*)$/;

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

/** Whether `segments` appear inside `classes` in order, and where the last one sits. */
const matchAt = (segments: readonly string[], classes: readonly string[]): number => {
	let at = 0;
	let last = -1;
	for (const segment of segments) {
		while (at < classes.length && classes[at] !== segment) at += 1;
		if (at >= classes.length) return -1;
		last = at;
		at += 1;
	}
	return last;
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
		const text = resolve(parseValue(declarationValue(key, value)), lookup);
		out.push(`${cssName(key)}: ${text};`);
	}
	return out.join(' ');
};

const pseudo = (rest: string): string => {
	if (rest.startsWith(':')) return rest;
	const bare = rest.split('(')[0]!;
	return `${PSEUDO_ELEMENTS.has(bare) ? '::' : ':'}${rest}`;
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

		const body = declarations(entry, lookup);
		if (body !== '') rules.push(`${selector} { ${body} }`);

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
			} else if (isBlock(value)) {
				const inner = declarations(value, lookup);
				if (inner === '') continue;
				if (kind === 'elem') rules.push(`${rest} ${selector} { ${inner} }`);
				else if (kind === 'children') rules.push(`${selector} > ${rest} { ${inner} }`);
				else if (kind === 'cssProp') rules.push(`${selector}${pseudo(rest)} { ${inner} }`);
				else if (kind === 'media') rules.push(`@media ${rest} { ${selector} { ${inner} } }`);
			}
		}
	}

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
