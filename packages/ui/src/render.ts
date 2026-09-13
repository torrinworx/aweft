// One object per render, and the three entry points that make one (design 109).
//
// `dom` threads an opaque value down every mount and never reads it. `ui` puts one object on
// that value carrying everything that would otherwise be a module singleton: the theme's class
// cache and stylesheet, the id counter, the popup sink, the head tags the page declares, and one
// entry per live `StageContext`.
//
// Nothing in this package holds mutable state at module scope except the theme definitions,
// which are data written once at import and never per render.

import {
	type ElementLike, type Hydrated, type ParentLike, type Remove,
	createElement, hydrate as domHydrate, mount as domMount, render as domRender,
} from '@aweftjs/dom';

import { pageLanguage, pageTitle } from './access.ts';
import { assert } from './assert.ts';
import { type HeadList, attachHead, createHeadList } from './head-list.ts';
import { type Ids, type Registry, createIds, createRegistry, hold } from './registry.ts';
import { type Sheet, createSheet } from './sheet.ts';
import type { StageEntry } from './stage-entry.ts';

const UI: unique symbol = Symbol('aweft.ui');

/** A language's translations: the key a text token looks up, to the message to show for it. */
export type Catalog = Readonly<Record<string, string>>;

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
	/** The language this render shows, a BCP 47 tag, when the page named one (design 278). */
	readonly locale?: string;
	/** The translations a text token looks up, when the page handed any. */
	readonly catalog?: Catalog;
}

/**
 * What a page may say about the language a render shows. Both take `undefined` as well as
 * nothing, so an entry writes `context({ locale, catalog })` whether or not this page has a
 * catalog.
 */
export interface ContextOptions {
	/** A BCP 47 tag, `fr` or `fr-CA`. Plural rules, numbers and `localeOf` follow it. */
	readonly locale?: string | undefined;
	/** The translations for that language. A key with no entry shows its source. */
	readonly catalog?: Catalog | undefined;
}

/** The context value `ui` threads: the render, plus one slot per live context provider. */
export type Context = Readonly<Record<symbol, unknown>>;

const USED: unique symbol = Symbol('aweft.ui.text.used');

/**
 * Make the systems for one render.
 *
 * Params:
 *   options: `locale`, the language the render shows, and `catalog`, its translations. Both
 *            optional; a render with neither shows every text token's source
 *
 * Returns: a fresh object sharing nothing with any other render. Hand it to `mount`, `render`
 * or `hydrate`, or let those make their own.
 *
 * Example:
 *   const ui = context({ locale: 'fr', catalog: fr });
 *   const markup = await render(h(App, {}), { context: ui });
 *   const css = ui.theme.markup();
 */
export const context = (options: ContextOptions = {}): Render => {
	// An empty tag is no tag: `languageOf` on a page with no `lang` answers `''`, and an entry
	// hands that straight in.
	const locale = options.locale === undefined || options.locale === '' ? undefined : options.locale;
	const render: Render = {
		theme: createSheet(),
		head: createHeadList(),
		stage: createRegistry<StageEntry>(),
		ids: createIds(),
		popups: createRegistry(),
		...(locale === undefined ? {} : { locale }),
		...(options.catalog === undefined ? {} : { catalog: options.catalog }),
	};
	// Symbol slots rather than fields: a page reads the keys through `usedText` and never writes
	// into the set, and the brand is what lets `textOf` take a render as well as a mount context.
	const slots = render as unknown as Record<symbol, unknown>;
	slots[USED] = new Set<string>();
	slots[RENDER] = true;
	return render;
};

const RENDER: unique symbol = Symbol('aweft.ui.render');

/** Whether a value is a render `context()` made, rather than the opaque value a mount threads. */
export const isRender = (value: unknown): value is Render =>
	value !== null && typeof value === 'object' && (value as Record<symbol, unknown>)[RENDER] === true;

/**
 * The render a value names: the render itself when handed one, and otherwise the one a mount
 * context carries, or null for a context with no `ui` systems.
 */
export const renderOf = (value: unknown): Render | null =>
	(isRender(value) ? value : has(value) ? use(value) : null);

/** Record a key a text token looked up in this render, so a walk can say what a catalog lacks. */
export const recordText = (render: Render, key: string): void => {
	(render as unknown as Record<symbol, Set<string> | undefined>)[USED]?.add(key);
};

/**
 * The keys the text tokens of a render looked up, in the order they were first asked for.
 *
 * Params:
 *   render: a render that has mounted or rendered a page
 *
 * Returns: the keys. A key is here whether or not the catalog had an entry for it, which is
 * what lets a static walk report the entries a catalog lacks and the ones nothing uses.
 *
 * Example:
 *   const missing = usedText(ui).filter((key) => catalog[key] === undefined);
 */
export const usedText = (render: Render): readonly string[] =>
	[...((render as unknown as Record<symbol, Set<string> | undefined>)[USED] ?? [])];

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
// The elements a class compiled after the mount goes into (design 257). Beside MARKER, not
// instead of it: a reader after the whole sheet wants both, and `existingSheet` wants the first.
const GROWN = 'data-aweft-grown';

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

// A `<style>` written before it enters the head. A stylesheet the document already holds cannot be
// changed, even an empty one and even one that is not the sheet declaring a face, without dropping
// every `@font-face` on the page and registering it again (design 257); writing the text first
// leaves no moment where this element is one of those.
const appended = (head: ElementLike, css: string, ...markers: readonly string[]): ElementLike => {
	const element = createElement('style');
	for (const marker of markers) element.setAttribute(marker, '');
	element.textContent = css;
	head.insertBefore(element, null);
	return element;
};

/**
 * Put the render's stylesheet in the document head and keep it up to date.
 *
 * A hydration adopts the one the server wrote rather than making a second, so hydrating a page
 * creates no element for the theme at all. Writing `textContent` rather than mounting a text
 * node keeps this out of the mount entirely: the sheet is not part of the item, and a page that
 * renders to markup puts the CSS in its own head with `theme.markup()`.
 *
 * Called after the mount, never before, so the element carries the whole stylesheet rather than
 * one write per class the page asked for. A mount is synchronous, so nothing is painted unstyled
 * in between.
 *
 * Every class compiled after that goes into a `<style>` of its own, and no element the document
 * holds is ever written (design 257). A browser registers an `@font-face` by name when it parses
 * the sheet declaring it, and changing a sheet the document holds drops every face on the page and
 * registers them again, so its text has no webfont until the data is back. That is true of an
 * empty element as much as a full one, and of a face declared somewhere else entirely, which is
 * why even the sheet's first CSS arrives in an element of its own.
 *
 * The one exception is an adopted element whose text the client disagrees with, which the client
 * owns and overwrites once, saying nothing (`README.md`, The per-render object).
 */
const attachSheet = (target: ParentLike, sheet: Sheet, adopt: boolean): (() => void) => {
	const head = headOf(target);
	if (head === null) return () => undefined;

	const found = adopt ? existingSheet(head) : null;
	const css = sheet.markup();
	const element = found ?? appended(head, css, MARKER);
	if (found !== null && found.textContent !== css) found.textContent = css;
	const grown: ElementLike[] = [];
	// Subscribed after the sheet is read rather than before. Nothing can compile in between, the
	// three DOM calls above being all that separates them, and this way round the element holds
	// every rule that existed when it was written.
	const stop = sheet.watch((added) => {
		// A grown element carries MARKER as well, because that attribute is how the rest of this
		// stack tells its own style elements from a page's head tags, and the second one is beside
		// it so `existingSheet` still takes the element the page loaded with.
		grown.push(appended(head, added, MARKER, GROWN));
	});
	return () => {
		stop();
		for (const own of grown) own.parentNode?.removeChild(own);
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

const LANGUAGE = 'the page declares no language: put lang="en", or the language it is written in, on its <html> element';
const TITLE = 'the page has no title: put a <title> in its head, or a <Title> on the page';

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
	// Dev only: each statement leaves a release build (designs 097, 266).
	assert(pageLanguage(target) !== '', LANGUAGE);
	assert(pageTitle(target) !== '', TITLE);
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
	assert(pageLanguage(target) !== '', LANGUAGE);
	assert(pageTitle(target) !== '', TITLE);
	const stop: Remove = (arg) => {
		if (arg !== undefined) return remove(arg);
		detach();
		return remove();
	};
	return Object.assign(stop, { ready: remove.ready });
};
