// The props `ui` claims off an element, and what it does with them when the element mounts.
//
// The split happens where `h` runs; the work happens where the mount context is in hand, which
// is a mounter (design 107). Both `h` and the hoisted template go through here, so an element
// written by hand and the same element compiled into a template do the same thing.

import { type Mounter, h as domH, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { assert } from './assert.ts';
import { use } from './render.ts';
import { isSource, isWritable } from './source.ts';
import { type TextToken, isText, textIn } from './text.ts';
import { themeAt, themeRaws } from './theme.ts';
import type { Definitions } from './sheet.ts';
import { type Lookup, NO_THEME, cssName, declarationValue, parseValue, resolve } from './values.ts';

const STATE = ['isHovered', 'isFocused', 'isClicked', 'isTouched'] as const;

/**
 * A state prop, the events that turn it on, and the events that turn it off.
 *
 * Every event here is one the platform keeps an `on<type>` property for, which is what makes it
 * survive a hydration (design 133). So `focus` and `blur` rather than `focusin` and `focusout`,
 * which means `isFocused` is the element's own focus and a block that wants focus-within asks the
 * theme for `:focus-within`; and pointer events rather than touch events, with the pointer type
 * saying it was a finger.
 */
const STATE_EVENTS: Record<string, readonly [on: string[], off: string[]]> = {
	isHovered: [['mouseenter'], ['mouseleave']],
	isFocused: [['focus'], ['blur']],
	isClicked: [['mousedown'], ['mouseup', 'mouseleave']],
	isTouched: [['pointerdown'], ['pointerup', 'pointercancel']],
};

/** A finger, rather than a mouse or a pen. */
const isTouch = (event: unknown): boolean =>
	(event as { pointerType?: unknown }).pointerType === 'touch';

const isEventProp = (name: string): boolean =>
	name.length > 2 && name.startsWith('on') && name[2]! >= 'A' && name[2]! <= 'Z';

/** Where a computed string goes: an attribute cell `dom` bound on the element. */
export interface Attribute {
	set(value: unknown): void;
}

/**
 * What `ui` took off an element's props and can only do with the mount context in hand, and the
 * two cells those answers are written into.
 *
 * The answers go into cells rather than onto the element because a hydration keeps the server's
 * node and drops the one these props were written on. `dom` re-targets a bound attribute onto the
 * node it adopted; a `setAttribute` here would land on the node it dropped (design 133).
 */
export interface Claimed {
	theme?: unknown;
	class?: unknown;
	style?: unknown;
	/** Required beside a `theme`: the `class` attribute cell. */
	classInto?: Attribute;
	/** Required beside a `style`: the `style` attribute cell. */
	styleInto?: Attribute;
	/** Each prop that held a text token, and the cell its resolved string goes into (design 278). */
	text?: { readonly token: TextToken; readonly into: Attribute }[];
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
 * writes and costs nothing. Every handler this package owns leaves in `rest`, as one `$on<type>`
 * property per event type, because that is what survives a hydration (design 133).
 *
 * Throws: an assert, loud in development and stripped in a release build, for a state prop that
 * is not a writable cell, an `onXxx` that is not a function, and a caller's own `$on<type>` that
 * is not a function beside one of those.
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
		if (key === 'style' ? typeof value !== 'string' : claims(key, themes) || isText(value)) {
			anything = true;
			break;
		}
	}
	if (!anything) return { rest: props, claimed: null };

	const keys = Object.keys(props);

	const rest: Record<string, unknown> = {};
	const claimed: Claimed = {};
	const themed = themes && props['theme'] !== undefined && props['theme'] !== null;

	// Event type to the handlers that run for it, in the order they are found here: what this
	// call claimed, then the cells the state props name. The caller's own `$on<type>` goes in
	// front of both below, once every key has been read.
	const handlers = new Map<string, ((event: unknown) => void)[]>();
	const forType = (type: string): ((event: unknown) => void)[] => {
		let list = handlers.get(type);
		if (list === undefined) {
			list = [];
			handlers.set(type, list);
		}
		return list;
	};

	for (const key of keys) {
		const value = props[key];
		if (key === 'theme') {
			if (themes && value !== undefined && value !== null) claimed.theme = value;
			continue;
		}
		// A token in any prop: the string it resolves to is written into a cell `dom` binds under
		// the same name, so the attribute or property carries the translation.
		if (isText(value)) {
			const cell = mutable<unknown>('');
			(claimed.text ??= []).push({ token: value, into: cell });
			rest[key] = cell;
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
			if (value === undefined || value === null) continue;
			assert(isWritable(value),
				`${key} must be a cell this component can write; pass mutable(false) or leave it off`);
			if (!isWritable(value)) continue;
			const [on, off] = STATE_EVENTS[key]!;
			// A finger is what `isTouched` is about, and a pointer event says which it was. The
			// events that clear it are not gated: whatever ended the press, the press is over.
			const gated = key === 'isTouched';
			for (const type of on) forType(type).push((event) => { if (!gated || isTouch(event)) value.set(true); });
			for (const type of off) forType(type).push(() => { value.set(false); });
			continue;
		}
		if (isEventProp(key)) {
			if (value === undefined || value === null) continue;
			assert(typeof value === 'function', `${key} must be a function; pass the handler itself, not its result`);
			if (typeof value !== 'function') continue;
			forType(key.slice(2).toLowerCase()).push(value as (event: unknown) => void);
			continue;
		}
		rest[key] = value;
	}

	// One property per event type. A property is what a hydration replays onto the node it
	// adopted, and a listener registered with `addEventListener` leaves nothing for it to find,
	// so a page that came from a server was inert until this was a property (design 133).
	// The two attribute cells, handed to `dom` in the props so it binds them on the element and
	// re-targets them onto the node a hydration adopts.
	if (claimed.theme !== undefined) {
		const cell = mutable<unknown>(null);
		claimed.classInto = cell;
		rest['class'] = cell;
	}
	if (claimed.style !== undefined) {
		const cell = mutable<unknown>(null);
		claimed.styleInto = cell;
		rest['style'] = cell;
	}

	for (const [type, list] of handlers) {
		const name = `$on${type}`;
		const own = rest[name];
		if (own !== undefined && own !== null) {
			assert(typeof own === 'function',
				`${name} must be a function beside an on${type} or a state prop that uses ${type}`);
			// The caller's own handler runs first: theirs is the one that may want to stop the
			// event before this package's own reads it.
			if (typeof own === 'function') list.unshift(own as (event: unknown) => void);
		}
		rest[name] = list.length === 1
			? list[0]
			: (event: unknown) => { for (const fn of list) fn(event); };
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

/**
 * Do what `ui` claimed for one element, with the mount context in hand.
 *
 * Params:
 *   claimed: what `splitProps` took, and the two attribute cells its answers go into
 *   context: the opaque context `dom` handed the mounter
 *
 * Returns: the teardown: every subscription dropped. The handlers are properties of the element
 * by now and the class and the style are cells `dom` writes (design 133), so nothing here touches
 * a node at all.
 *
 * Throws: an assert, loud in development and stripped in a release build, when the mount has no
 * `ui` systems, or when a claim arrived without the cell its answer goes into.
 *
 * Example:
 *   const stop = applyClaimed(claimed, context);
 */
export const applyClaimed = (claimed: Claimed, context: unknown): (() => void) => {
	const stops: (() => void)[] = [];
	assert(claimed.theme === undefined || claimed.classInto !== undefined,
		'a claimed theme needs the class cell dom bound on the element; pass it as classInto');
	assert(claimed.style === undefined || claimed.styleInto !== undefined,
		'a claimed style needs the style cell dom bound on the element; pass it as styleInto');

	if (claimed.theme !== undefined) {
		const sheet = use(context).theme;
		// The theme in effect is read inside the pass, following whatever cell a `Theme` above was
		// given, so a light and dark switch moves the class on an element that is already on the
		// page (design 117). A provider written with a plain object subscribes to nothing.
		const themeNow = (deep: Deep): Definitions => {
			// Resolved first: the chain records what each provider was given while it resolves, and
			// a provider whose value has never been read has nothing to follow yet.
			const held = themeAt(context);
			for (const raw of themeRaws(context)) deep(raw);
			return held;
		};
		let definitions: Definitions = {};
		let classes: readonly string[] = [];
		stops.push(track(
			(deep) => {
				definitions = themeNow(deep);
				const list: string[] = [];
				flatten(claimed.theme, deep, list);
				classes = list;
				const generated = sheet.classes(definitions, list);
				const own: string[] = [];
				flatten(claimed.class, deep, own);
				return [...own, generated].join(' ');
			},
			// One write per change, so a theme cell moving is one attribute operation on the tree.
			(value) => { claimed.classInto?.set(value); },
		));

		if (claimed.style !== undefined) {
			// The style resolves against the same chain the class came from, so a `$var` and a
			// theme's own function are both in scope where an element writes an inline value.
			const lookup: Lookup = {
				variable: (name) => sheet.variable(definitions, classes, name),
				call: (name) => sheet.call(definitions, classes, name),
			};
			stops.push(track(
				(deep) => {
					// Following the same cells, because a theme swap moves what a `$var` resolves to.
					themeNow(deep);
					return cssTextOf(claimed.style, deep, lookup);
				},
				(css) => { claimed.styleInto?.set(css === '' ? null : css); },
			));
		}
	} else if (claimed.style !== undefined) {
		// No theme means no chain to resolve a `$var` or a `$fn()` against, so a `$name` resolves
		// to nothing, a call is left as written, and `$$` is still an escape.
		stops.push(track(
			(deep) => cssTextOf(claimed.style, deep, NO_THEME),
			(css) => { claimed.styleInto?.set(css === '' ? null : css); },
		));
	}

	for (const { token, into } of claimed.text ?? []) {
		// Resolved here, where the render's catalog is, and followed through the cells among the
		// token's values so a plural over a count moves with it.
		stops.push(track((deep) => textIn(context, token, deep), (value) => { into.set(value); }));
	}

	return () => {
		for (const stop of stops) stop();
		stops.length = 0;
	};
};

// --- carrying the claimed props to the mount ---------------------------------------------------

const WRAPPED: unique symbol = Symbol('aweft.ui.wrapped');

/** What `h` returns for a subtree with claimed props in it: mountable, and still openable. */
export interface Wrapped {
	(...args: never[]): unknown;
	readonly [WRAPPED]: { readonly made: unknown; readonly claims: Claimed[] };
}

/** Whether a value is one of these, so an enclosing `h` can fold it into its own. */
export const isWrapped = (value: unknown): value is Wrapped =>
	typeof value === 'function' && (value as Partial<Wrapped>)[WRAPPED] !== undefined;

/** What is inside one: the item `dom` would have mounted, and the claims still to be applied. */
export const openWrapped = (value: Wrapped): { made: unknown; claims: Claimed[] } => value[WRAPPED];

const Dress = (props: { made: unknown; claims: readonly Claimed[] }): Mounter =>
	(elem, _item, before, context) => {
		// Before the mount, so every cell holds its string before `dom` binds it, and the class the
		// server wrote is the class the element carries as it goes into the document.
		const stops = props.claims.map((claimed) => applyClaimed(claimed, context));
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
 *   claims: what was claimed off each element inside it, in document order
 *
 * Returns: a component's mounter. It is a component rather than a bare mounter because `dom`
 * brackets a component and does not bracket a mounter, and the brackets are what a hydration
 * reads to know a dynamic mount sits between two static siblings.
 *
 * Example:
 *   return claims.length === 0 ? made : dress(made, claims);
 */
export const dress = (made: unknown, claims: Claimed[]): Wrapped => {
	const mounter = domH(Dress, { made, claims }) as (...args: never[]) => unknown;
	return Object.assign(mounter, { [WRAPPED]: { made, claims } }) as Wrapped;
};

/**
 * Fold any wrapped children into one list of claims, so a subtree written as nested `h` calls
 * mounts under one bracket rather than one per themed element.
 */
export const foldChildren = (children: unknown[]): { children: unknown[]; claims: Claimed[] } => {
	// Nothing to fold is the common case, and it keeps the array it was given.
	let found = false;
	for (const child of children) {
		if (!isWrapped(child)) continue;
		found = true;
		break;
	}
	if (!found) return { children, claims: EMPTY };

	const out: unknown[] = [];
	const claims: Claimed[] = [];
	for (const child of children) {
		if (isWrapped(child)) {
			const inner = openWrapped(child);
			out.push(inner.made);
			claims.push(...inner.claims);
			continue;
		}
		out.push(child);
	}
	return { children: out, claims };
};

const EMPTY: Claimed[] = [];
