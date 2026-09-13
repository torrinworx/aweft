// The browser half: two functions, and nothing that reads a disk (design 151).
//
// Its own subpath, and the only values it imports are `ui`'s `mount` and `hydrate` and the two
// `dom` needs to read an item, so a page bundle that reaches for it carries the walk, the
// document builder and `node:fs` nowhere. `languageOf` reads the language the site wrote on the
// page back, by the one prefix rule the site wrote it with (design 279).

import { type ParentLike, type Remove, h, isComponentCall } from '@aweftjs/dom';
import { type Render, hydrate, mount } from '@aweftjs/ui';

// The only file this half imports besides `ui`, and it holds one string. Nothing in it reads a
// disk, so a page bundle still carries no Node module through this door.
import { STAMP } from './stamp.ts';

/**
 * Take over a generated page, or mount a live one, whichever this document is.
 *
 * Params:
 *   target: the element the page lives in, `document.body` for a page `ssg` wrote
 *   item: the same item the site was rendered from. A component call, `h(Site, props)`, or a
 *         function that makes it, which is mounted as a component with no props either way
 *   render: the `ui` systems to use. Omitted, the document's shared render is used, as
 *           `mount` and `hydrate` do
 *
 * Returns: the removal, exactly as `mount` and `hydrate` answer it.
 *
 * A page `ssg` wrote carries `data-aweft-ssg` on its body and is hydrated: the server's elements
 * are adopted in place and nothing flashes. Anything else is mounted. The choice cannot be left to
 * the application, because both mistakes are silent in a different way: mounting over server
 * markup renders the page twice, and hydrating an empty body says the markup ran out.
 *
 * Example:
 *   const router = createRouter();
 *   attach(document.body, h(Site, { router }));
 *   router.links(document.body);
 */
export const attach = (target: ParentLike, item: unknown, render?: Render): Remove => {
	// A mount target is anything with the three node operations, and only an element can carry an
	// attribute, so a target that is not one is the mounting case by construction.
	const element = target as { hasAttribute?(name: string): boolean };
	const generated = typeof element.hasAttribute === 'function' && element.hasAttribute(STAMP);
	// A bare function means the same thing on both branches, so it is wrapped here rather than
	// left to `hydrate`, which does its own wrapping, and to `mount`, which would read it as a
	// mounter and render nothing. `mount`'s own contract is untouched.
	const mounted = typeof item === 'function' && !isComponentCall(item) ? h(item) : item;
	return generated ? hydrate(target, mounted, render) : mount(target, mounted, undefined, render);
};

/** Where a page stands: its language, and the router base its URLs carry. */
export interface PageLanguage {
	/** The tag on `<html lang>`, or `''` for a page with none. */
	readonly locale: string;
	/** `/<tag>` when the address is under the language's prefix, and `''` otherwise, which is the
	 * source language and a site with one language alike. What `createRouter({ base })` takes. */
	readonly base: string;
}

/**
 * The language a generated page is in, and the base its router needs.
 *
 * Params:
 *   document: the page's document, or anything with a `documentElement` carrying `lang` and a
 *             `location` with a `pathname`; the browser's `document` and `window` are read when
 *             the argument has no location of its own
 *
 * Returns: the tag on `<html lang>` and the prefix the address carries when its first segment is
 * that tag. A site with one language answers `''` for both, so an entry written this way works
 * before the site has a second language.
 *
 * Example:
 *   const { locale, base } = languageOf(document);
 *   const catalog = locale === 'en' ? undefined : (await import(`./text/${locale}.json`)).default;
 *   attach(document.body, h(Site, { router: createRouter({ base }) }), context({ locale, catalog }));
 */
export const languageOf = (document: {
	readonly documentElement?: { getAttribute?(name: string): string | null } | null;
	readonly location?: { readonly pathname?: string } | null;
}): PageLanguage => {
	const root = document.documentElement;
	const locale = (root !== null && root !== undefined && typeof root.getAttribute === 'function' ? root.getAttribute('lang') : null) ?? '';
	if (locale === '') return { locale: '', base: '' };
	const location = document.location ?? (globalThis as { location?: { pathname?: string } }).location;
	const path = location?.pathname ?? '/';
	const prefix = `/${locale}`;
	return { locale, base: path === prefix || path.startsWith(`${prefix}/`) ? prefix : '' };
};
