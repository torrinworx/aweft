// `ui`'s `h`: `dom`'s, plus the eight props that need the mount context (design 107).
//
// An element with none of them is `dom`'s `h` exactly, node and all. An element with any of them
// is a mounter, because the theme it gets and the `$var`s in its style are decided where the
// context is, and `dom` hands the context to a mounter and to nothing else.

import { type ElementLike, createElement, h as domH, htm } from '@aweftjs/dom';

import { assert } from './assert.ts';
import { type Marked, makeMark, markNameOf } from './mark.ts';
import { type Pair, dress, foldChildren, splitProps } from './wrapper.ts';

const SVG = 'http://www.w3.org/2000/svg';

const EACH = /^each:(.+)$/;

const nodeOf = (made: unknown): ElementLike =>
	(typeof (made as { nodeType?: unknown }).nodeType === 'number'
		? made
		: (made as { node: ElementLike }).node) as ElementLike;

/** `each:name` on a component: the item arrives under `name` instead of under `each`. */
const withEachName = (
	component: (...args: never[]) => unknown,
	name: string,
): (...args: never[]) => unknown =>
	((given: Record<string, unknown>, ...rest: never[]) =>
		(component as (...args: unknown[]) => unknown)({ ...given, [name]: given['each'] }, ...rest)
	) as (...args: never[]) => unknown;

const build = (
	tag: unknown,
	props: Record<string, unknown> | null,
	children: unknown[],
	namespace: string | null,
): unknown => {
	assert(tag !== null && tag !== undefined, 'a tag name cannot be null or undefined; pass an element name, a node, a component or a mark');
	const given = props ?? {};

	const slot = markNameOf(tag);
	if (slot !== null) {
		const inner = children.length > 0 ? children : (given['children'] as unknown[] | null) ?? [];
		const { children: _, ...rest } = given;
		return makeMark(slot, rest, inner);
	}

	if (typeof tag === 'function') {
		const renamed = Object.keys(given).map((key) => EACH.exec(key)).find((found) => found !== null);
		if (renamed === null || renamed === undefined) return domH(tag, given, ...children);
		const { [renamed[0]]: item, ...rest } = given;
		return domH(withEachName(tag as (...args: never[]) => unknown, renamed[1]!), { ...rest, each: item }, ...children);
	}

	const { rest, claimed } = splitProps(given, namespace === null);
	// A themed child folds into this element's own list rather than keeping a wrapper of its own,
	// so a subtree written as nested `h` calls mounts under one bracket.
	const folded = foldChildren(children);
	// An SVG element is made here rather than by `dom`'s `h`, because the namespace is what
	// makes it one and `h` takes a tag name with no namespace beside it.
	const target = namespace === null ? tag : createElement(String(tag), namespace);
	const made = domH(target, rest, ...folded.children);
	if (claimed === null && folded.pairs.length === 0) return made;
	// This element's own props first: document order is what decides which element asks the
	// render's class cache for a name first, and a compiled page has to ask in the same order.
	const pairs: Pair[] = claimed === null
		? folded.pairs
		: [{ element: nodeOf(made), claimed }, ...folded.pairs];
	return dress(made, pairs);
};

/**
 * Make an element, a component's mounter, or a mark.
 *
 * Params:
 *   tag: an element name, an existing node, a component, or `mark.name`
 *   props: everything `dom`'s `h` takes, plus `theme`, `class` alongside it, `style` as an
 *          object, `isHovered`, `isFocused`, `isClicked`, `isTouched`, `onXxx`, and `each:name`
 *          on a component
 *   children: what goes inside, exactly as `dom` takes it
 *
 * Returns: the element itself when nothing is reactive and `ui` claimed nothing; a value `mount`
 * binds when something inside is reactive; a mounter when `ui` claimed a prop; a mark when the
 * tag is one.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a null tag, a state
 * prop that is not a writable cell, an `onXxx` that is not a function, and everything `dom`'s own
 * `h` refuses.
 *
 * Example:
 *   mount(document.body, h('button', { theme: ['button', tone], onClick: go }, 'Go'));
 */
export const h = (tag: unknown, props: Record<string, unknown> | null = {}, ...children: unknown[]): unknown =>
	build(tag, props, children, null);

/**
 * Make an SVG element.
 *
 * The same as `h` with two differences: the node is made in the SVG namespace, and there is no
 * theme, so `class` and `style` are written as plain attributes.
 *
 * Params:
 *   tag: an SVG element name
 *   props: as `h`, without `theme`
 *   children: as `h`
 *
 * Returns: what `h` returns.
 *
 * Example:
 *   svg('svg', { viewBox: '0 0 24 24' }, svg('circle', { cx: 12, cy: 12, r: 10 }));
 */
export const svg = (tag: unknown, props: Record<string, unknown> | null = {}, ...children: unknown[]): unknown =>
	build(tag, props, children, SVG);

/**
 * Markup in a template literal, bound to `ui`'s `h`.
 *
 * The same tag `dom` ships, over this package's `h`, so markup in a `ui` file is themed the same
 * way JSX in one is.
 *
 * Example:
 *   mount(document.body, html`<button theme="button" onClick=${go}>Go</button>`);
 */
export const html = /* @__PURE__ */ htm(h);

export type { Marked };
