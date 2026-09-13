// One run of text: the `text` theme family, with the `type` grammar (designs 180, 181, 182).
//
// `type` is theme segments joined by `_`, and the first segment also picks the element. Nothing
// here decides what text looks like beyond naming entries: a word this package never defined is a
// segment like any other, so an application's own `eyebrow` works with nothing added to the
// library.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { h } from './h.ts';
import { assert } from './assert.ts';
import { createContext } from './contexts.ts';
import { elementFor } from './control.ts';
import { isSource, through } from './source.ts';
import { cellsOf, isText, textOf } from './text.ts';

/** One rule for turning part of a label into something else. Keys beyond these two are ignored. */
export interface TextModifier {
	/** A plain string, matched everywhere and case-insensitively, or a global regex. */
	readonly check: string | RegExp;
	/** What the matched text becomes. Anything mountable. */
	readonly return: (match: string) => unknown;
	readonly [key: string]: unknown;
}

/**
 * The modifiers every `Typography` below runs over its label.
 *
 * A provider replaces the list above it rather than adding to it, so a subtree that wants both
 * writes both. The list applies to `label` only: `children` are already markup and have nothing
 * for a pattern to run over.
 *
 * Example:
 *   <TextModifiers value={[{ check: 'TODO', return: (word) => <b>{word}</b> }]}>
 *     <Typography label="TODO: write this" />
 *   </TextModifiers>
 */
export const TextModifiers = createContext<TextModifier[]>([], (raw, parent) => {
	// A cell arrives as the cell, so an unread one would reach `matchesIn` as an object with no
	// `length` and apply nothing at all, silently.
	const own = isSource(raw) ? raw.get() : raw;
	return own === null || own === undefined ? parent : own as TextModifier[];
});

/**
 * The string a label shows: a text token resolved in the render, anything else as given.
 *
 * The one resolve step before the modifiers (design 181), so a modifier matches the translated
 * word (design 278).
 */
const resolve = (context: unknown, label: unknown): unknown =>
	(isText(label) ? textOf(context, label) : label);

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What one check matches with. A fresh regex, so a caller's own is never rewound under them. */
const patternOf = (check: string | RegExp): RegExp => {
	if (typeof check === 'string') {
		assert(check !== '', 'a TextModifiers check cannot be the empty string; write the text to match');
		return new RegExp(escaped(check), 'gi');
	}
	assert(check.global, `a TextModifiers check written as a regex must be global, and /${check.source}/${check.flags} is not; add the g flag`);
	return new RegExp(check.source, check.flags);
};

/** One piece of the label a modifier claimed. */
interface Found {
	readonly start: number;
	readonly end: number;
	readonly text: string;
	/** Which modifier found it, which is the tie-breaker when two start in the same place. */
	readonly at: number;
}

/** The matches to render: earliest start first, and anything overlapping an earlier one dropped. */
const matchesIn = (text: string, modifiers: readonly TextModifier[]): Found[] => {
	const found: Found[] = [];
	for (let at = 0; at < modifiers.length; at += 1) {
		for (const hit of text.matchAll(patternOf(modifiers[at]!.check))) {
			// A pattern that can match nothing, such as /x*/g, hits at every position. Rendering
			// those would put an element between every pair of characters.
			if (hit[0].length === 0) continue;
			found.push({ start: hit.index, end: hit.index + hit[0].length, text: hit[0], at });
		}
	}
	found.sort((a, b) => (a.start - b.start) || (a.at - b.at));

	const kept: Found[] = [];
	let reached = 0;
	for (const hit of found) {
		if (hit.start < reached) continue;
		kept.push(hit);
		reached = hit.end;
	}
	return kept;
};

/**
 * The list below whatever a modifier returned.
 *
 * Empty, because a `return` that mounts a `Typography` of its own would otherwise read the same
 * provider, run the same list over the same match, and never stop.
 */
const NONE: TextModifier[] = [];

/** The label as children: gaps as text, and each match as whatever its modifier answers. */
const labelOf = (context: unknown, raw: unknown, modifiers: readonly TextModifier[]): unknown => {
	const label = resolve(context, raw);
	if (label === null || label === undefined) return null;
	if (typeof label !== 'string' && typeof label !== 'number') return label;

	const text = String(label);
	const matches = matchesIn(text, modifiers);
	if (matches.length === 0) return text;

	const out: unknown[] = [];
	let at = 0;
	for (const hit of matches) {
		if (hit.start > at) out.push(text.slice(at, hit.start));
		out.push(modifiers[hit.at]!.return(hit.text));
		at = hit.end;
	}
	if (at < text.length) out.push(text.slice(at));
	// A provider mounts its children in place and adds no node, so this changes nothing a page or
	// a hydration sees.
	return h(TextModifiers, { value: NONE }, ...out);
};

const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const PARAGRAPHS: ReadonlySet<string> = new Set(['p', 'p1', 'p2']);

/** A `type` as theme segments. */
const segmentsOf = (type: unknown): string[] =>
	(type === null || type === undefined || type === '' ? [] : String(type).split('_'));

/**
 * The element the first segment names.
 *
 * A word the six headings and the three paragraphs do not claim is a `<span>`, which is what
 * leaves an application free to invent one.
 */
const elementOf = (type: unknown): string => {
	const first = segmentsOf(type)[0] ?? '';
	if (HEADINGS.has(first)) return first;
	return PARAGRAPHS.has(first) ? 'p' : 'span';
};

/** What `Typography` takes. Everything not named here goes to the element. */
export interface TypographyProps {
	/** The theme segments, joined by `_`; the first also picks the element. A value or a cell. */
	readonly type?: unknown;
	/** The text. A value or a cell, and the only thing the modifiers run over. */
	readonly label?: unknown;
	/** Decorate this element instead of building one. Any element name will do. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * One run of themed text.
 *
 * Params:
 *   props: `type`, `label`, `element`, `theme`, and anything else, which goes to the element
 *
 * Returns: one element on the `text` entry plus a segment per word in `type`. `h1` to `h6` give
 * that heading, `p`, `p1` and `p2` give a `<p>`, and everything else gives a `<span>`. With no
 * `type` at all it is a `<span>` on `text` alone. The later segment wins where two disagree, so
 * `h2_bold` is a heading at the bold weight.
 *
 * `label` renders first and `children` after it, and neither is required. The `TextModifiers`
 * above it run over `label` only; a label that is neither a string nor a number renders as given.
 *
 * A `type` that is a cell moves the theme when it changes. It does not move the element: the
 * element lasts as long as the component, as `Icon`'s does. A page that needs the tag to change
 * puts the two spellings in a `Switch`.
 *
 * Throws: the assert `elementFor` makes for an `element` that is not an element, such as a
 * component or a themed element written as `<p theme="card" />`, which is a function.
 *
 * Example:
 *   <Typography type="h2_bold" label="Today" />
 *   <Typography type="p2" label={note} />
 */
export const Typography = (props: TypographyProps): Mounter => (elem, _item, before, context) => {
	const { type, label, element, theme, children, ...rest } = props;
	const modifiers = TextModifiers.read(context);
	const held = isSource(type) ? type.get() : type;

	// A token whose values hold a cell re-resolves as the cell moves, through one cell of its own
	// the modifiers then run over. A token with plain values costs no subscription at all.
	const cells = isText(label) ? cellsOf(label) : [];
	let shown: unknown = label;
	let stops: (() => void)[] = [];
	if (cells.length > 0) {
		const cell = mutable<unknown>(textOf(context, label));
		let building = true;
		stops = cells.map((source) => source.effect(() => { if (!building) cell.set(textOf(context, label)); }));
		building = false;
		shown = cell;
	}

	const node = h(
		element === null || element === undefined ? elementOf(held) : elementFor(element),
		{ ...rest, theme: ['text', through(type, segmentsOf), theme] },
		through(shown, (value) => labelOf(context, value, modifiers)),
		...(children ?? []),
	);
	const remove = mount(elem, node, before, context);
	return (arg) => {
		if (arg !== undefined) return remove(arg);
		for (const stop of stops) stop();
		return remove();
	};
};
