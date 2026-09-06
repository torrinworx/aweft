// The props `ui` claims off an element, and what it does with them when the element mounts.
//
// The split happens where `h` runs; the work happens where the mount context is in hand, which
// is a mounter (design 107). Both `h` and the hoisted template go through here, so an element
// written by hand and the same element compiled into a template do the same thing.

import { type ElementLike, type Mounter, h as domH, mount, setAttribute } from '@aweftjs/dom';

import { assert } from './assert.ts';
import { use } from './render.ts';
import { isSource, isWritable } from './source.ts';
import { themeAt } from './theme.ts';
import { type Lookup, NO_THEME, cssName, declarationValue, parseValue, resolve } from './values.ts';

const STATE = ['isHovered', 'isFocused', 'isClicked', 'isTouched'] as const;

/** A state prop, and the two events that drive it. */
const STATE_EVENTS: Record<string, readonly [on: string[], off: string[]]> = {
	isHovered: [['mouseenter'], ['mouseleave']],
	isFocused: [['focusin'], ['focusout']],
	isClicked: [['mousedown'], ['mouseup', 'mouseleave']],
	isTouched: [['touchstart'], ['touchend', 'touchcancel']],
};

const isEventProp = (name: string): boolean =>
	name.length > 2 && name.startsWith('on') && name[2]! >= 'A' && name[2]! <= 'Z';

/** What `ui` took off an element's props. */
export interface Claimed {
	theme?: unknown;
	class?: unknown;
	style?: unknown;
	isHovered?: unknown;
	isFocused?: unknown;
	isClicked?: unknown;
	isTouched?: unknown;
	/** Event name as `addEventListener` spells it, and the handler. */
	events?: [string, unknown][];
}

/**
 * Split an element's props into the part `dom` writes and the part `ui` claims.
 *
 * Params:
 *   props: the props as written
 *   themes: false for `svg`, which has no theme and keeps `class` and `style` as attributes
 *
 * Returns: `rest`, what goes to `dom`'s `h`, and `claimed`, or null when `ui` claimed nothing.
 * `class` is claimed only alongside a `theme`, so a plain `class` stays an attribute `dom`
 * writes and costs nothing.
 *
 * Example:
 *   const { rest, claimed } = splitProps({ id: 'x', theme: 'button', onClick: go });
 */
export const splitProps = (
	props: Record<string, unknown>,
	themes = true,
): { rest: Record<string, unknown>; claimed: Claimed | null } => {
	// One pass to find out whether there is anything to take, over the keys rather than over a
	// copy of them. Most elements on a page have nothing `ui` claims, and those keep the object
	// they arrived in rather than paying for a copy of it.
	let anything = false;
	for (const key in props) {
		const value = props[key];
		if (value === undefined || value === null) continue;
		if (key === 'style' ? typeof value !== 'string' : claims(key, themes)) {
			anything = true;
			break;
		}
	}
	if (!anything) return { rest: props, claimed: null };

	const keys = Object.keys(props);

	const rest: Record<string, unknown> = {};
	const claimed: Claimed = {};
	const themed = themes && props['theme'] !== undefined && props['theme'] !== null;

	for (const key of keys) {
		const value = props[key];
		if (key === 'theme') {
			if (themes && value !== undefined && value !== null) claimed.theme = value;
			continue;
		}
		if (key === 'class' && themed) {
			claimed.class = value;
			continue;
		}
		if (key === 'style' && value !== undefined && value !== null && typeof value !== 'string') {
			claimed.style = value;
			continue;
		}
		if ((STATE as readonly string[]).includes(key)) {
			if (value !== undefined && value !== null) claimed[key as (typeof STATE)[number]] = value;
			continue;
		}
		if (isEventProp(key)) {
			if (value !== undefined && value !== null) (claimed.events ??= []).push([key.slice(2).toLowerCase(), value]);
			continue;
		}
		rest[key] = value;
	}

	return { rest, claimed };
};

/** Whether `ui` takes this name off an element at all. `class` only counts beside a `theme`. */
const claims = (key: string, themes: boolean): boolean =>
	(themes && key === 'theme') || (STATE as readonly string[]).includes(key) || isEventProp(key);

// --- resolving a value that may be reactive anywhere inside it -------------------------------

/** Read a value, following it if it is a cell, and subscribe so a change rebuilds. */
type Deep = (value: unknown) => unknown;

/**
 * Recompute a value whenever anything reactive inside it changes.
 *
 * The subscriptions are rebuilt every pass, because what is reactive can move: a `theme` that is
 * a cell holding an array holds different cells after it changes.
 */
const track = <T>(compute: (deep: Deep) => T, onChange: (value: T) => void): (() => void) => {
	let stops: (() => void)[] = [];
	let building = false;
	let dead = false;

	const deep: Deep = (value) => {
		if (!isSource(value)) return value;
		stops.push(value.effect(() => { if (!building) run(); }));
		return deep(value.get());
	};

	const run = (): void => {
		if (dead) return;
		building = true;
		for (const stop of stops) stop();
		stops = [];
		const value = compute(deep);
		building = false;
		onChange(value);
	};

	run();
	return () => {
		dead = true;
		for (const stop of stops) stop();
		stops = [];
	};
};

/** A `theme` prop, however it was nested, as a flat list of class segments. */
const flatten = (value: unknown, deep: Deep, out: string[]): void => {
	const held = deep(value);
	if (held === null || held === undefined || held === false || held === '') return;
	if (Array.isArray(held)) {
		for (const item of held) flatten(item, deep, out);
		return;
	}
	out.push(String(held));
};

/** A `style` prop as one declaration string, with `$var` resolved and a bare size given `px`. */
const cssTextOf = (value: unknown, deep: Deep, lookup: Lookup): string => {
	const held = deep(value);
	if (held === null || held === undefined) return '';
	if (typeof held !== 'object') return resolve(parseValue(String(held)), lookup);

	const out: string[] = [];
	for (const key of Object.keys(held as Record<string, unknown>)) {
		const raw = deep((held as Record<string, unknown>)[key]);
		if (raw === null || raw === undefined || raw === false) continue;
		out.push(`${cssName(key)}: ${resolve(parseValue(declarationValue(key, raw)), lookup)};`);
	}
	return out.join(' ');
};

// --- applying --------------------------------------------------------------------------------

interface Listening {
	addEventListener?(type: string, listener: (event: unknown) => void): void;
	removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

const listen = (element: ElementLike, type: string, handler: (event: unknown) => void): (() => void) => {
	const target = element as unknown as Listening;
	if (typeof target.addEventListener !== 'function') return () => undefined;
	target.addEventListener(type, handler);
	return () => { target.removeEventListener?.(type, handler); };
};

/**
 * Do what `ui` claimed, on one element, with the mount context in hand.
 *
 * Params:
 *   element: the element the props were written on
 *   claimed: what `splitProps` took
 *   context: the opaque context `dom` handed the mounter
 *
 * Returns: the teardown: every listener removed and every subscription dropped.
 *
 * Throws: an assert, loud in development and stripped in a release build, when the mount has no
 * `ui` systems, or when a state prop is not a cell.
 *
 * Example:
 *   const stop = applyClaimed(element, claimed, context);
 */
export const applyClaimed = (element: ElementLike, claimed: Claimed, context: unknown): (() => void) => {
	const stops: (() => void)[] = [];

	if (claimed.theme !== undefined) {
		const sheet = use(context).theme;
		const definitions = themeAt(context);
		let classes: readonly string[] = [];
		stops.push(track(
			(deep) => {
				const list: string[] = [];
				flatten(claimed.theme, deep, list);
				classes = list;
				const generated = sheet.classes(definitions, list);
				const own: string[] = [];
				flatten(claimed.class, deep, own);
				return [...own, generated].join(' ');
			},
			// One write per change, so a theme cell moving is one attribute operation on the tree.
			(value) => { setAttribute(element, 'class', value); },
		));

		if (claimed.style !== undefined) {
			// The style resolves against the same chain the class came from, so a `$var` and a
			// theme's own function are both in scope where an element writes an inline value.
			const lookup: Lookup = {
				variable: (name) => sheet.variable(definitions, classes, name),
				call: (name) => sheet.call(definitions, classes, name),
			};
			stops.push(track(
				(deep) => cssTextOf(claimed.style, deep, lookup),
				(css) => { setAttribute(element, 'style', css === '' ? null : css); },
			));
		}
	} else if (claimed.style !== undefined) {
		// No theme means no chain to resolve a `$var` or a `$fn()` against, so a `$name` resolves
		// to nothing, a call is left as written, and `$$` is still an escape.
		stops.push(track(
			(deep) => cssTextOf(claimed.style, deep, NO_THEME),
			(css) => { setAttribute(element, 'style', css === '' ? null : css); },
		));
	}

	for (const name of STATE) {
		const cell = claimed[name];
		if (cell === undefined) continue;
		assert(isWritable(cell),
			`${name} must be a cell this component can write; pass mutable(false) or leave it off`);
		if (!isWritable(cell)) continue;
		const [on, off] = STATE_EVENTS[name]!;
		const write = (value: boolean) => () => { cell.set(value); };
		for (const type of on) stops.push(listen(element, type, write(true)));
		for (const type of off) stops.push(listen(element, type, write(false)));
	}

	for (const [type, handler] of claimed.events ?? []) {
		assert(typeof handler === 'function', `on${type} must be a function; pass the handler itself, not its result`);
		if (typeof handler !== 'function') continue;
		stops.push(listen(element, type, handler as (event: unknown) => void));
	}

	return () => {
		for (const stop of stops) stop();
		stops.length = 0;
	};
};

// --- carrying the claimed props to the mount ---------------------------------------------------

const WRAPPED: unique symbol = Symbol('aweft.ui.wrapped');

/** One element and what `ui` claimed off it. */
export interface Pair {
	readonly element: ElementLike;
	readonly claimed: Claimed;
}

/** What `h` returns for a subtree with claimed props in it: mountable, and still openable. */
export interface Wrapped {
	(...args: never[]): unknown;
	readonly [WRAPPED]: { readonly made: unknown; readonly pairs: Pair[] };
}

/** Whether a value is one of these, so an enclosing `h` can fold it into its own. */
export const isWrapped = (value: unknown): value is Wrapped =>
	typeof value === 'function' && (value as Partial<Wrapped>)[WRAPPED] !== undefined;

/** What is inside one: the item `dom` would have mounted, and the elements still to be dressed. */
export const openWrapped = (value: Wrapped): { made: unknown; pairs: Pair[] } => value[WRAPPED];

const Dress = (props: { made: unknown; pairs: readonly Pair[] }): Mounter =>
	(elem, _item, before, context) => {
		// Before the mount, so a class is on the element as it goes into the document rather than
		// being written onto it afterwards, and so a hydration compares the class the server wrote.
		const stops = props.pairs.map((pair) => applyClaimed(pair.element, pair.claimed, context));
		const remove = mount(elem, props.made, before, context);
		return (arg) => {
			if (arg !== undefined) return remove(arg);
			for (const stop of stops) stop();
			return remove();
		};
	};

/**
 * Wrap an item so the props `ui` claimed are applied when it mounts.
 *
 * Params:
 *   made: what `dom` would have mounted
 *   pairs: the elements inside it and what was claimed off each, in document order
 *
 * Returns: a component's mounter. It is a component rather than a bare mounter because `dom`
 * brackets a component and does not bracket a mounter, and the brackets are what a hydration
 * reads to know a dynamic mount sits between two static siblings.
 *
 * Example:
 *   return pairs.length === 0 ? made : dress(made, pairs);
 */
export const dress = (made: unknown, pairs: Pair[]): Wrapped => {
	const mounter = domH(Dress, { made, pairs }) as (...args: never[]) => unknown;
	return Object.assign(mounter, { [WRAPPED]: { made, pairs } }) as Wrapped;
};

/**
 * Fold any wrapped children into one list of pairs, so a subtree written as nested `h` calls
 * mounts under one bracket rather than one per themed element.
 */
export const foldChildren = (children: unknown[]): { children: unknown[]; pairs: Pair[] } => {
	// Nothing to fold is the common case, and it keeps the array it was given.
	let found = false;
	for (const child of children) {
		if (!isWrapped(child)) continue;
		found = true;
		break;
	}
	if (!found) return { children, pairs: EMPTY };

	const out: unknown[] = [];
	const pairs: Pair[] = [];
	for (const child of children) {
		if (isWrapped(child)) {
			const inner = openWrapped(child);
			out.push(inner.made);
			pairs.push(...inner.pairs);
			continue;
		}
		out.push(child);
	}
	return { children: out, pairs };
};

const EMPTY: Pair[] = [];
