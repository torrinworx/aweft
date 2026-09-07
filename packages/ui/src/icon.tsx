// Icons: one driver, one data shape, and a stack of packs to look a name up in (design 131).
//
// The `<svg>` is built here from the fields of the data, never read out of an `<svg …>` string.
// The `body` is the drawing itself, and it goes into the element as markup, which is the one thing
// it can be: the light tree and a browser both take it, so a static render writes the paths and a
// hydration pairs them one for one.

import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { applyClaimed } from './wrapper.ts';
import { assert } from './assert.ts';
import { type IconData, type IconSource, isPromise, lookupIcon, transformOf } from './icon-data.ts';
import { createContext } from './contexts.ts';
import { elementFor } from './control.ts';
import { svg } from './h.ts';
import { isSource } from './source.ts';

const SVG = 'http://www.w3.org/2000/svg';

const listOf = (raw: unknown): IconSource[] => {
	if (raw === null || raw === undefined) return [];
	return (Array.isArray(raw) ? raw : [raw]) as IconSource[];
};

/**
 * The icon packs and resolvers everything below can look a name up in.
 *
 * The stack starts empty: this package ships no drawings (design 144). A provider stacks what it
 * names in front of what it inherited, so the nearest one wins. A pack is
 * `{ prefix, icons, aliases?, width?, height? }`, where the root size covers every icon in it
 * that declares none; a resolver is `(name) => data | Promise<data> | null`, and answering null
 * passes the question on to the next source.
 *
 * Example:
 *   <Icons value={myPack}><App /></Icons>
 *   <Icons value={(name) => fetch(`/icons/${name}.json`).then((r) => r.json())}><App /></Icons>
 */
export const Icons = createContext<IconSource[]>([], (raw, parent) => {
	const own = listOf(raw);
	return own.length === 0 ? parent : [...own, ...parent];
});

const isData = (value: unknown): value is IconData =>
	typeof value === 'object' && value !== null && typeof (value as IconData).body === 'string';

/**
 * The group holding one icon's drawing.
 *
 * The body is written in with `innerHTML`, so the paths are ordinary child nodes: a static render
 * serializes them and a hydration pairs them rather than parsing anything again.
 */
const groupFor = (data: IconData): unknown => {
	const width = data.width ?? 16;
	const height = data.height ?? 16;
	const group = createElement('g', SVG);
	(group as unknown as { innerHTML: string }).innerHTML = data.body;
	const transform = transformOf(data, width, height);
	if (transform !== null) group.setAttribute('transform', transform);
	return group;
};

/** What `Icon` takes. Everything not named here goes to the `<svg>`. */
export interface IconProps {
	/** Icon data, or a name to look up. A cell either way. */
	readonly name?: unknown;
	/** A CSS length. `$iconSize` when omitted, which is `1em`, so it follows the text. */
	readonly size?: unknown;
	/** Its name for a screen reader. Without one the element is hidden from assistive technology. */
	readonly label?: unknown;
	/** Degrees, on top of whatever the data's own `rotate` says. */
	readonly rot?: unknown;
	/** Decorate this `<svg>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * An assert from inside a promise handler, thrown where the host already looks.
 *
 * A lookup that answers late is out of every caller's reach, so an assert thrown into the
 * promise chain would only reject a promise the render machinery already handles, which is the
 * same as saying nothing at all.
 */
const loudly = (message: string): void => {
	queueMicrotask(() => { assert(false, message); });
};

/**
 * One icon, drawn from icon data.
 *
 * Params:
 *   props: `name`, either icon data or a name to look up through `Icons`; `size`, a CSS length;
 *          `label`, its name for a screen reader; `rot`, degrees; and anything else, which goes to
 *          the `<svg>`
 *
 * Returns: one `<svg>`, filled with `currentColor` and sized in `em` so it matches the text beside
 * it. With a `label` it carries `role="img"` and that label; without one it is `aria-hidden` and
 * unfocusable, because an icon beside the word it means is otherwise read out twice.
 *
 * The element lasts as long as the component. A `name` that is a cell swaps the drawing inside it
 * and never the element itself.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a name no source in
 * the stack answers. A resolver that answers a promise says so late, so that assert is thrown
 * where the host reports it rather than into the promise nobody holds; a resolver that fails
 * reports the same way, naming the reason, and the element stays empty.
 *
 * Example:
 *   <Icon name="check" label="done" />
 *   <Icon name="chevron-down" rot={90} />
 */
export const Icon = (
	props: IconProps,
	cleanup: (...fns: (() => void)[]) => void,
	_mounted: unknown,
	pending: (promise: Promise<unknown>) => void,
): Mounter => (elem, _item, before, context) => {
	const { name, size, label, rot, theme, element, class: own, ...rest } = props;
	const stack = Icons.read(context);
	const held = mutable<IconData | null>(null);
	// A name nothing answers is a typo, not a state, so the message says how to answer it. One
	// sentence for every name: this package knows nothing about where a name comes from, and a
	// command built out of the name would be an install for a package that need not exist.
	const missing = (value: string): string =>
		`no icon named ${value}: ${String(stack.length)} source(s) were asked. `
		+ 'Wrap the page in <Icons value={pack}> with a pack or resolver that has it; '
		+ '@aweftjs/icons gives you one from an installed set.';

	// Which lookup is the current one. A name that changes while a lookup is out makes the answer
	// still coming back the wrong answer, however fast it arrives.
	let generation = 0;

	const take = (value: unknown): void => {
		generation += 1;
		const mine = generation;
		if (isData(value)) {
			held.set(value);
			return;
		}
		if (typeof value !== 'string' || value === '') {
			held.set(null);
			return;
		}
		const found = lookupIcon(value, stack);
		if (isPromise(found)) {
			held.set(null);
			// Declared pending, so a static render waits for it rather than writing an empty icon.
			pending(found.then(
				(data) => {
					if (mine !== generation) return;
					if (data === null || data === undefined) {
						// The same answer the sync path gives, so a name nothing answers is a
						// typo either way rather than a state one path reports and one does not.
						loudly(missing(value));
						return;
					}
					held.set(data);
				},
				(reason) => {
					if (mine !== generation) return;
					loudly(`${missing(value)}; the lookup failed with ${String(reason)}`);
				},
			));
			return;
		}
		assert(found !== null, missing(value));
		held.set(found);
	};

	if (isSource(name)) cleanup(name.effect(take));
	else take(name);

	const named = label !== undefined && label !== null && label !== '';
	const style: Record<string, unknown> = {};
	if (size !== undefined && size !== null) {
		style['width'] = size;
		style['height'] = size;
	}
	if (rot !== undefined && rot !== null) style['transform'] = `rotate(${String(rot)}deg)`;

	const box = (data: IconData | null): string =>
		`${String(data?.left ?? 0)} ${String(data?.top ?? 0)} ${String(data?.width ?? 16)} ${String(data?.height ?? 16)}`;

	const tag = elementFor(element, 'svg');
	const node = (typeof tag === 'string' ? createElement(tag, SVG) : tag) as ElementLike;

	// An `<svg>` has no `theme` prop (design 107), so the theme and the caller's own `class` go
	// through the one place that flattens a theme and follows a cell inside it, rather than
	// through a second copy of that work here. The class it computes goes into a cell handed to
	// the element below, which is what a hydration re-targets onto the node it adopts (design 133).
	const classes = mutable<unknown>(null);
	cleanup(applyClaimed({ theme: ['icon', theme], class: own, classInto: classes }, context));

	const item = svg(node, {
		...rest,
		class: classes,
		style: Object.keys(style).length === 0 ? null : style,
		viewBox: held.map(box),
		fill: 'currentColor',
		role: named ? 'img' : null,
		'aria-label': named ? label : null,
		'aria-hidden': named ? null : 'true',
		focusable: named ? null : 'false',
	}, held.map((data) => (data === null ? null : groupFor(data))));

	return mount(elem, item, before, context);
};

export type { IconAlias, IconData, IconPack, IconResolver, IconSource } from './icon-data.ts';
