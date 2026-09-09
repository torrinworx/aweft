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
	type ElementLike, type Hydrated, type ParentLike, type Remove,
	createElement, hydrate as domHydrate, mount as domMount, render as domRender,
} from '@aweftjs/dom';

import { assert } from './assert.ts';
import { type HeadList, attachHead, createHeadList } from './head-list.ts';
import { type Ids, type Registry, createIds, createRegistry, hold } from './registry.ts';
import { type Sheet, createSheet } from './sheet.ts';
import type { StageEntry } from './stage-entry.ts';

const UI: unique symbol = Symbol('aweft.ui');

/** Everything one render owns. */
export interface Render {
	/** The class cache and the stylesheet for this render. */
	readonly theme: Sheet;
	/** The head tags this render's page declares, and the markup they come out as. */
	readonly head: HeadList;
	/** One entry per live `StageContext`, so a static walk can enumerate the pages. */
	readonly stage: Registry<StageEntry>;
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
	head: createHeadList(),
	stage: createRegistry<StageEntry>(),
	ids: createIds(),
	popups: createRegistry(),
});

/** The context value a fresh render starts from. */
const rooted = (render: Render): Context => ({ [UI]: render });

const STATIC: unique symbol = Symbol('aweft.ui.static');

/**
 * Whether this render only writes markup: the page is serialized and taken down, never touched.
 *
 * A component that decorates a node it did not build asks, because a static render runs its
 * `mounted` callbacks too and what they write ends up in the markup, while a hydration cannot write
 * the same thing before the pairing walk reaches that node (design 153). A symbol rather than a
 * field on `Render`, because only this package's own components may ask.
 */
export const isStatic = (render: Render): boolean =>
	(render as unknown as Record<symbol, boolean | undefined>)[STATIC] === true;

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
	readonly attached: Map<Render, { count: number; detach: () => void }>;
	/** The head elements the renders in this document have taken, so no two adopt the same tag. */
	readonly tags: Set<unknown>;
}

// Kept on the document rather than in a table here, so this file still holds nothing mutable at
// module scope and two documents cannot reach each other's classes (design 109).
const heldBy = (target: ParentLike): Held | null => {
	const document = documentOf(target);
	if (document === null) return null;
	const slot = document as unknown as Record<symbol, Held | undefined>;
	return slot[OWNED] ??= { own: null, attached: new Map(), tags: new Set() };
};

/** The render a mount into this target gets when the caller named none. */
const documentRender = (target: ParentLike): Render => {
	const held = heldBy(target);
	if (held === null) return context();
	return held.own ??= context();
};

/** The render's stylesheet and its head tags, both into the target's document head. */
const attachSystems = (target: ParentLike, render: Render, adopt: boolean, tags: Set<unknown>): (() => void) => {
	const sheet = attachSheet(target, render.theme, adopt);
	const head = headOf(target);
	const tagsOff = head === null
		? () => undefined
		: attachHead(head as unknown as ParentLike, render.head, adopt, tags);
	return () => {
		tagsOff();
		sheet();
	};
};

/**
 * Attach the render's stylesheet and head tags for one mount, and count the mounts that share them.
 *
 * Two mounts sharing a render share its `<style>` and its tags, so the second adds no element and
 * the first to be removed takes none away. The count is per render per document: an explicit
 * `context()` still gets a sheet and a set of tags of its own.
 */
const attachFor = (target: ParentLike, render: Render, adopt: boolean): (() => void) => {
	const held = heldBy(target);
	if (held === null) return attachSystems(target, render, adopt, new Set());

	let entry = held.attached.get(render);
	if (entry === undefined) {
		entry = { count: 0, detach: attachSystems(target, render, adopt, held.tags) };
		held.attached.set(render, entry);
	}
	const state = entry;
	state.count += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		state.count -= 1;
		if (state.count > 0) return;
		held.attached.delete(render);
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
 * Returns: the item's markup. The theme's CSS and the page's head tags are not in it: read
 * `context.theme.markup()` and `context.head.markup()` and put both in the page's own head.
 *
 * The head list and the stage list are both held for the whole render, because a static render
 * takes the page down as soon as it has serialized it and both have to still be there afterwards.
 * So a render object that has been through `render` keeps every tag its page declared and every
 * stage its page mounted; use one per page, as design 109 says. `use(context).stage` after the
 * call is what a static walk reads to learn which URLs the page declares (designs 126, 145).
 *
 * Example:
 *   const ui = context();
 *   const body = await render(h(App, {}), { context: ui });
 *   const head = `<style data-aweft>${ui.theme.markup()}</style>${ui.head.markup()}`;
 *   const page = `<html><head>${head}</head><body>${body}</body></html>`;
 */
export const render = async (item: unknown, options: { context?: Render } = {}): Promise<string> => {
	const own = options.context ?? context();
	// The hold is what keeps the lists after the page comes down, and it is also what makes a
	// second render on one object accumulate: the first page's tags and stages are still in there.
	// A render object is for one page (designs 109, 127, 145), and this is where that is enforced.
	const again = hold(own.head);
	hold(own.stage);
	assert(!again,
		'this render object has already rendered a page, so its head tags and stages are still in it; make one context() per page');
	(own as unknown as Record<symbol, boolean>)[STATIC] = true;
	return domRender(item, { context: rooted(own) });
};

/**
 * Take over markup `render` wrote, with the `ui` systems under it.
 *
 * Params:
 *   target: the element whose children are the server's markup
 *   item: the same item the server rendered
 *   render: the systems to use. Omitted, the target's document is asked for the one every
 *           default mount into it shares, as `mount` does
 *
 * Returns: the remove function with `ready` on it, as `dom` does. The `<style data-aweft>` the
 * server wrote is adopted rather than replaced, so a hydration makes no element for the theme.
 * `ready` resolves once every act, page or panel the page was still loading has arrived and the
 * markup has been checked (design 243).
 *
 * Example:
 *   const page = hydrate(document.body, h(App, {}));
 *   await page.ready;
 */
export const hydrate = (target: ParentLike, item: unknown, render?: Render): Hydrated => {
	const own = render ?? documentRender(target);
	const remove = domHydrate(target, item, rooted(own));
	const detach = attachFor(target, own, true);
	const stop: Remove = (arg) => {
		if (arg !== undefined) return remove(arg);
		detach();
		return remove();
	};
	return Object.assign(stop, { ready: remove.ready });
};
