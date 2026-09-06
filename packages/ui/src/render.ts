// One object per render, and the three entry points that make one (design 109).
//
// `dom` threads an opaque value down every mount and never reads it. `ui` puts one object on
// that value carrying everything that would otherwise be a module singleton: the theme's class
// cache and stylesheet, the id counter, the popup sink, the head tags the page declares, and one
// entry per live `StageContext`.
//
// Nothing in this package holds mutable state at module scope except the theme definitions,
// which are data written once at import and never per render.

import type { Derived } from '@aweftjs/core';
import {
	type ElementLike, type ParentLike, type Remove,
	createElement, hydrate as domHydrate, mount as domMount, render as domRender,
} from '@aweftjs/dom';

import { assert } from './assert.ts';
import { type Ids, type Registry, createIds, createRegistry } from './registry.ts';
import { type Sheet, createSheet } from './sheet.ts';

const UI: unique symbol = Symbol('aweft.ui');

/**
 * Everything one render owns.
 *
 * `head` and `stage` are reserved: they are registries this step never writes to, and step 18
 * fills them without changing anything a caller does.
 */
export interface Render {
	/** The class cache and the stylesheet for this render. */
	readonly theme: Sheet;
	/** Reserved for the head system (step 18). */
	readonly head: Registry;
	/** Reserved for the router's act registry (step 18). */
	readonly stage: Registry;
	/** The counter behind an `aria-labelledby` and its friends. */
	readonly ids: Ids;
	/** Where a popup mounts: `PopupContext` renders what is in here, after everything else. */
	readonly popups: Registry;
}

/** The context value `ui` threads: the render, plus one slot per live context provider. */
export type Context = Readonly<Record<symbol, unknown>>;

/**
 * Make the systems for one render.
 *
 * Returns: a fresh object sharing nothing with any other render. Hand it to `mount`, `render`
 * or `hydrate`, or let those make their own.
 *
 * Example:
 *   const ui = context();
 *   const markup = await render(h(App, {}), { context: ui });
 *   const css = ui.theme.markup();
 */
export const context = (): Render => ({
	theme: createSheet(),
	head: createRegistry(),
	stage: createRegistry(),
	ids: createIds(),
	popups: createRegistry(),
});

/** The context value a fresh render starts from. */
const rooted = (render: Render): Context => ({ [UI]: render });

/**
 * The render a mount belongs to.
 *
 * Params:
 *   value: the opaque context `dom` handed the mounter
 *
 * Returns: the render's systems.
 *
 * Throws: an assert, loud in development and stripped in a release build, when the mount was
 * not started by one of `ui`'s entry points, naming what to call instead.
 *
 * Example:
 *   const sheet = use(context).theme;
 */
export const use = (value: unknown): Render => {
	const held = value === null || value === undefined
		? undefined
		: (value as Record<symbol, unknown>)[UI];
	assert(held !== undefined,
		'this needs the ui systems and the mount has none; mount with ui\'s mount, render or hydrate, or pass a context() as the context to dom\'s');
	return held as Render;
};

/** Whether a context carries the ui systems at all, for a caller that wants to ask rather than assert. */
export const has = (value: unknown): boolean =>
	value !== null && value !== undefined && (value as Record<symbol, unknown>)[UI] !== undefined;

/** A context with one more slot on it. Providers make the next context this way. */
export const withSlot = (value: unknown, key: symbol, slot: unknown): Context => {
	const base = (value === null || value === undefined ? {} : value) as Record<symbol, unknown>;
	return { ...base, [key]: slot };
};

/** What a context holds under one key, or undefined. */
export const slotOf = (value: unknown, key: symbol): unknown =>
	(value === null || value === undefined ? undefined : (value as Record<symbol, unknown>)[key]);

// --- the stylesheet element ----------------------------------------------------------------

const MARKER = 'data-aweft';

interface WithHead {
	readonly head?: { firstChild: unknown; insertBefore(node: unknown, before: unknown): unknown } | null;
}

const documentOf = (target: ParentLike): (WithHead & object) | null => {
	const own = target.ownerDocument as (WithHead & object) | null | undefined;
	const page = (globalThis as { document?: WithHead & object }).document;
	return own ?? page ?? null;
};

const headOf = (target: ParentLike): ElementLike | null => {
	const head = documentOf(target)?.head;
	return head === null || head === undefined ? null : head as unknown as ElementLike;
};

const existingSheet = (head: ElementLike): ElementLike | null => {
	for (let node = head.firstChild; node !== null; node = node.nextSibling) {
		const element = node as ElementLike;
		if (element.nodeType === 1 && element.localName === 'style' && element.hasAttribute(MARKER)) return element;
	}
	return null;
};

/**
 * Put the render's stylesheet in the document head and keep it up to date.
 *
 * A hydration adopts the one the server wrote rather than making a second, so hydrating a page
 * creates no element for the theme at all. Writing `textContent` rather than mounting a text
 * node keeps this out of the mount entirely: the sheet is not part of the item, and a page that
 * renders to markup puts the CSS in its own head with `theme.markup()`.
 *
 * Called after the mount, never before, so the first write is the whole stylesheet rather than
 * one write per class the page asked for. On an adopted sheet that first write usually finds the
 * text already right and does nothing at all. A mount is synchronous, so nothing is painted
 * unstyled in between.
 */
const attachSheet = (target: ParentLike, sheet: Sheet, adopt: boolean): (() => void) => {
	const head = headOf(target);
	if (head === null) return () => undefined;

	const found = adopt ? existingSheet(head) : null;
	const element = found ?? createElement('style');
	if (found === null) {
		element.setAttribute(MARKER, '');
		head.insertBefore(element, null);
	}
	const stop = (sheet.text as Derived<string>).effect((css) => {
		if (element.textContent !== css) element.textContent = css;
	});
	return () => {
		stop();
		if (found === null) element.parentNode?.removeChild(element);
	};
};

// --- what one document holds -----------------------------------------------------------------

const OWNED: unique symbol = Symbol('aweft.ui.document');

/** The render a document's mounts share, and the live mounts each render has in it. */
interface Held {
	own: Render | null;
	readonly sheets: Map<Render, { count: number; detach: () => void }>;
}

// Kept on the document rather than in a table here, so this file still holds nothing mutable at
// module scope and two documents cannot reach each other's classes (design 109).
const heldBy = (target: ParentLike): Held | null => {
	const document = documentOf(target);
	if (document === null) return null;
	const slot = document as unknown as Record<symbol, Held | undefined>;
	return slot[OWNED] ??= { own: null, sheets: new Map() };
};

/** The render a mount into this target gets when the caller named none. */
const documentRender = (target: ParentLike): Render => {
	const held = heldBy(target);
	if (held === null) return context();
	return held.own ??= context();
};

/**
 * Attach the render's stylesheet for one mount, and count the mounts that share it.
 *
 * Two mounts sharing a render share its `<style>`, so the second adds no element and the first
 * to be removed takes none away. The count is per render per document: an explicit `context()`
 * still gets a sheet of its own.
 */
const attachFor = (target: ParentLike, render: Render, adopt: boolean): (() => void) => {
	const held = heldBy(target);
	if (held === null) return attachSheet(target, render.theme, adopt);

	let sheet = held.sheets.get(render);
	if (sheet === undefined) {
		sheet = { count: 0, detach: attachSheet(target, render.theme, adopt) };
		held.sheets.set(render, sheet);
	}
	const state = sheet;
	state.count += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		state.count -= 1;
		if (state.count > 0) return;
		held.sheets.delete(render);
		state.detach();
	};
};

// --- the entry points ------------------------------------------------------------------------

/**
 * Mount an item, with the `ui` systems under it.
 *
 * Params:
 *   target: an element, or anything `dom`'s `mount` takes
 *   item: anything `dom`'s `mount` takes
 *   before: the anchor, as `dom` means it
 *   render: the systems to use. Omitted, the target's document is asked for the one every
 *           default mount into it shares, so two widgets on one page cannot mint the same class
 *           name for two different themes
 *
 * Returns: the remove function, as `dom` does. It also takes the stylesheet back out of the
 * document head, once the last mount sharing it has gone.
 *
 * Example:
 *   const stop = mount(document.body, h(App, {}));
 */
export const mount = (target: ParentLike, item: unknown, before?: Remove, render?: Render): Remove => {
	const own = render ?? documentRender(target);
	const remove = domMount(target, item, before, rooted(own));
	const detach = attachFor(target, own, false);
	return (arg) => {
		if (arg !== undefined) return remove(arg);
		detach();
		return remove();
	};
};

/**
 * Render an item to markup, with the `ui` systems under it and no browser.
 *
 * Params:
 *   item: anything `dom`'s `render` takes
 *   options: `context`, the systems to use. Omitted, a fresh set is made and the CSS it
 *            generated is unreachable, so pass one whenever the page needs its stylesheet
 *
 * Returns: the item's markup. The theme's CSS is not in it: read `context.theme.markup()` and
 * put it in the page's own head.
 *
 * Example:
 *   const ui = context();
 *   const body = await render(h(App, {}), { context: ui });
 *   const page = `<html><head><style data-aweft>${ui.theme.markup()}</style></head><body>${body}</body></html>`;
 */
export const render = async (item: unknown, options: { context?: Render } = {}): Promise<string> =>
	domRender(item, { context: rooted(options.context ?? context()) });

/**
 * Take over markup `render` wrote, with the `ui` systems under it.
 *
 * Params:
 *   target: the element whose children are the server's markup
 *   item: the same item the server rendered
 *   render: the systems to use. Omitted, the target's document is asked for the one every
 *           default mount into it shares, as `mount` does
 *
 * Returns: the remove function, as `dom` does. The `<style data-aweft>` the server wrote is
 * adopted rather than replaced, so a hydration makes no element for the theme.
 *
 * Example:
 *   hydrate(document.body, h(App, {}));
 */
export const hydrate = (target: ParentLike, item: unknown, render?: Render): Remove => {
	const own = render ?? documentRender(target);
	const remove = domHydrate(target, item, rooted(own));
	const detach = attachFor(target, own, true);
	return (arg) => {
		if (arg !== undefined) return remove(arg);
		detach();
		return remove();
	};
};
