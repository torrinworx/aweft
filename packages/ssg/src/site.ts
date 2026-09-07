// A site: what it is made of, and the three things a caller does with it.
//
// One render per page, one `context()` per render (design 109), and the page component is handed a
// router built from the URL rather than from a browser, which is what makes a build a build.

import { codecError } from '@aweftjs/codec';
import { createRouter } from '@aweftjs/dom/router';
import type { Router } from '@aweftjs/dom/router';
import { type Render, type StageEntry, context, render } from '@aweftjs/ui';

import { type DocumentParts, buildDocument, noindexOf } from './document.ts';
import { sitemapOf } from './sitemap.ts';
import { FALLBACK, fileOf, normalise } from './url.ts';
import { type Unenumerated, type WalkResult, walkSite } from './walk.ts';
import { writeFiles } from './write.ts';

/** What `createSite` takes. */
export interface SiteOptions {
	/**
	 * The whole page, built from the router it is given. The same function a browser entry mounts,
	 * so the markup written here is the markup the client renders.
	 */
	page(router: Router): unknown;
	/** The page shell the bundler built, as text: `dist/index.html`. */
	readonly shell: string;
	/** The directory the files are written to. Usually the same `dist`. */
	readonly out: string;
	/** The site's absolute URL, `https://example.com`. Needed only for the sitemap. */
	readonly base?: string;
}

/** One finished page. */
export interface PageResult {
	/** The whole document. */
	readonly html: string;
	/** The title the page declared, or null when it declared none. */
	readonly title: string | null;
	/** Whether its head asked search engines to leave it out. */
	readonly noindex: boolean;
}

/** What a write did. */
export interface WriteResult {
	/** The files it wrote, relative to `out`, in the order they were written. */
	readonly files: readonly string[];
	/** The URLs it wrote a page for. */
	readonly urls: readonly string[];
	/** The acts a walk could not enumerate. Empty when a list of URLs was given, because no walk ran. */
	readonly unenumerated: readonly Unenumerated[];
	/** The sitemap's file, or null when none was written. */
	readonly sitemap: string | null;
}

/** A site, ready to be walked, rendered or written. */
export interface Site {
	/**
	 * Every URL the site has, found by rendering it.
	 *
	 * Returns: the URLs, `/` first, and the acts that have a parameter and no `entries()`.
	 */
	walk(): Promise<WalkResult>;
	/**
	 * One finished document.
	 *
	 * Params:
	 *   url: the page's URL, with or without its slashes
	 *
	 * Returns: the document, its title and whether it is noindex. For a caller that serves or
	 * stores a page rather than writing it to disk.
	 *
	 * Throws: `not-a-page` for a URL that leaves a stage showing its fallback or showing nothing,
	 * because that page is the site's `404.html` and not a page of its own.
	 */
	page(url: string): Promise<PageResult>;
	/**
	 * Write the site out.
	 *
	 * Params:
	 *   urls: the pages to write. Left off, the whole walk is written, with `404.html`,
	 *         `shell.html` and, when the site has a `base`, `sitemap.xml`
	 *
	 * Returns: what was written and what could not be enumerated.
	 *
	 * Throws: `not-a-page` for a listed URL the site has no page for, before anything is written.
	 */
	write(urls?: readonly string[]): Promise<WriteResult>;
}

/** One render of one URL: the markup, and the render object that holds what it declared. */
interface Rendered {
	readonly body: string;
	readonly own: Render;
}

/**
 * Make a site.
 *
 * Params:
 *   page: builds the page from a router. The browser entry calls it with a live router; this
 *         calls it with one made from each URL, with no window anywhere
 *   shell: the page shell the bundler built, as text
 *   out: the directory to write into
 *   base: the site's absolute URL. Without it there is no sitemap, and the write result says so
 *
 * Returns: the site.
 *
 * Throws: nothing here. `walk`, `page` and `write` throw what a render throws; `page` refuses a
 * shell it cannot read (`shell-head`, `shell-body`, `shell-body-content`) and a URL the site has no
 * page for (`not-a-page`).
 *
 * Example:
 *   const site = createSite({
 *     page: (router) => h(Site, { router }),
 *     shell: readFileSync('dist/index.html', 'utf8'),
 *     out: 'dist',
 *     base: 'https://example.com',
 *   });
 *   const written = await site.write();
 */
export const createSite = (options: SiteOptions): Site => {
	const { shell, out } = options;

	const renderAt = async (url: string): Promise<Rendered> => {
		const own = context();
		// No window, so the router runs from the URL it is given and every browser effect is off.
		const body = await render(options.page(createRouter({ url })), { context: own });
		return { body, own };
	};

	/**
	 * The stage that answered nothing for this URL, or null when every one of them showed an act.
	 *
	 * A stage showing its fallback, or showing nothing at all, is the site saying it has no such
	 * page. A caller asking for one has a typo in a slug, and writing the fallback out at that path
	 * publishes a "not found" page on a URL the site claims to have.
	 */
	const emptyStage = (own: Render): StageEntry | null => {
		for (const entry of own.stage.items) {
			if (entry.current === null || entry.current === entry.fallback) return entry;
		}
		return null;
	};

	const pageAt = async (url: string, showing = false): Promise<PageResult> => {
		const clean = normalise(url);
		const { body, own } = await renderAt(clean);
		if (!showing) {
			const empty = emptyStage(own);
			if (empty !== null) {
				throw codecError('not-a-page', `${clean} left the stage at ${JSON.stringify(empty.prefix)} showing ${empty.current === null ? 'nothing' : JSON.stringify(empty.current)}`,
					'Ask for a URL the site has; walk() answers the list, and the fallback is written once as 404.html.');
			}
		}
		const title = own.head.title();
		const parts: DocumentParts = { body, css: own.theme.markup(), head: own.head.markup(), title };
		return { html: buildDocument(shell, parts), title, noindex: noindexOf(own.head) };
	};

	const walk = (): Promise<WalkResult> =>
		walkSite(async (url) => [...(await renderAt(url)).own.stage.items]);

	const write = async (urls?: readonly string[]): Promise<WriteResult> => {
		if (urls !== undefined) {
			const wanted = urls.map(normalise);
			const files: [string, string][] = [];
			for (const url of wanted) files.push([fileOf(url), (await pageAt(url)).html]);
			await writeFiles(out, files);
			return { files: files.map(([name]) => name), urls: wanted, unenumerated: [], sitemap: null };
		}

		const found = await walk();
		const files: [string, string][] = [];
		const indexable: string[] = [];
		for (const url of found.urls) {
			const made = await pageAt(url);
			files.push([fileOf(url), made.html]);
			if (!made.noindex) indexable.push(url);
		}

		// The fallback is whatever the site puts on a page nothing matched, which is what a host
		// serving 404.html shows. Its URL is not one of the site's, so it is in no sitemap, and this
		// is the one render allowed to end on a stage showing nothing.
		files.push(['404.html', (await pageAt(FALLBACK, true)).html]);
		// The shell as it stands: no stamp, so `attach` mounts live rather than hydrating.
		files.push(['shell.html', shell]);

		const sitemap = options.base === undefined ? null : 'sitemap.xml';
		if (sitemap !== null) files.push([sitemap, sitemapOf(options.base!, indexable)]);

		await writeFiles(out, files);
		return { files: files.map(([name]) => name), urls: found.urls, unenumerated: found.unenumerated, sitemap };
	};

	// `page` takes one argument. The second is how `write` reaches the fallback and is not API.
	return { walk, page: (url) => pageAt(url), write };
};
