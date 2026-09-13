// A site: what it is made of, and the three things a caller does with it.
//
// One render per page, one `context()` per render (design 109), and the page component is handed a
// router built from the URL rather than from a browser, which is what makes a build a build.

import { codecError } from '@aweftjs/codec';
import { createRouter } from '@aweftjs/dom/router';
import type { Router } from '@aweftjs/dom/router';
import { type Catalog, type Render, type StageEntry, context, render, usedText } from '@aweftjs/ui';

import { type Alternate, type DocumentParts, buildDocument, languageOn, noindexOf } from './document.ts';
import { type Language, placeOf, prefixOf, rightToLeft, urlIn } from './language.ts';
import { type SitemapEntry, sitemapOf } from './sitemap.ts';
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
	/** The site's absolute URL, `https://example.com`. Needed for the sitemap and the alternates. */
	readonly base?: string;
	/**
	 * The language the pages are written in, a BCP 47 tag (design 279). Written on every
	 * document's `<html lang>`; its pages stand unprefixed. Needed beside `locales`.
	 */
	readonly locale?: string;
	/**
	 * The other languages: each tag to its catalog, the plain object `ui`'s text tokens read. The
	 * site is written once more per entry, under `/<tag>/`.
	 */
	readonly locales?: Readonly<Record<string, Catalog>>;
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

/** What a language's catalog lacks and holds beyond what the pages looked up. */
export interface TextReport {
	/** The keys the pages looked up that the catalog has no entry for, so those show the source. */
	readonly missing: readonly string[];
	/** The catalog's entries no page looked up. */
	readonly unused: readonly string[];
}

/** What a write did. */
export interface WriteResult {
	/** The files it wrote, relative to `out`, in the order they were written. */
	readonly files: readonly string[];
	/** The URLs it wrote a page for, every language's. */
	readonly urls: readonly string[];
	/** The acts a walk could not enumerate. Empty when a list of URLs was given, because no walk ran. */
	readonly unenumerated: readonly Unenumerated[];
	/** The sitemap's file, or null when none was written. */
	readonly sitemap: string | null;
	/** Per language in `locales`, what its catalog lacks and what it holds that nothing used (design 279). */
	readonly text: Readonly<Record<string, TextReport>>;
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
	 *   url: the page's URL, with or without its slashes. With `locales`, a URL under a
	 *        language's prefix is that page in that language: `/fr/about`
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
	 *   urls: the pages to write. Left off, the whole walk is written, in every language, with
	 *         `404.html`, `shell.html` and, when the site has a `base`, `sitemap.xml`. A listed
	 *         URL under a language's prefix is written in that language; one with no prefix in
	 *         every language
	 *
	 * Returns: what was written, what could not be enumerated, and what each catalog lacks.
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

/** One finished page with what the write needs beside it. */
interface Made extends PageResult {
	readonly language: Language;
	/** The keys the page's text tokens looked up. */
	readonly used: readonly string[];
}

/**
 * Make a site.
 *
 * Params:
 *   page: builds the page from a router. The browser entry calls it with a live router; this
 *         calls it with one made from each URL, with no window anywhere
 *   shell: the page shell the bundler built, as text
 *   out: the directory to write into
 *   base: the site's absolute URL. Without it there is no sitemap and no alternates, and the
 *         write result says so
 *   locale: the language the pages are written in; `locales`: the other languages and their
 *           catalogs (design 279)
 *
 * Returns: the site.
 *
 * Throws: `locale-needed` for `locales` with no `locale`, because the layout needs to know which
 * language stands unprefixed. Otherwise nothing here: `walk`, `page` and `write` throw what a
 * render throws; `page` refuses a shell it cannot read (`shell-head`, `shell-body`,
 * `shell-body-content`) and a URL the site has no page for (`not-a-page`).
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
	const others = Object.keys(options.locales ?? {});
	if (others.length > 0 && options.locale === undefined) {
		throw codecError('locale-needed', `locales names ${others.join(', ')} and locale names nothing`,
			'Name the language the pages are written in as locale; its pages stand unprefixed and every other language under its tag.');
	}
	if (options.locale !== undefined && others.includes(options.locale)) {
		throw codecError('locale-twice', `${options.locale} is the locale and also in locales`,
			'Leave the source language out of locales: its pages stand unprefixed and need no catalog.');
	}
	for (const tag of [...(options.locale === undefined ? [] : [options.locale]), ...others]) {
		let known = true;
		try {
			known = Intl.getCanonicalLocales(tag).length === 1;
		} catch {
			known = false;
		}
		if (!known) {
			throw codecError('locale-invalid', `${JSON.stringify(tag)} is not a language tag`,
				'Write a BCP 47 tag such as fr or fr-CA.');
		}
	}
	// The source language first, then the others in the order they were given. A site with no
	// language at all has one entry with no tag, so every path below still runs once.
	const source = options.locale ?? '';
	const languages: Language[] = [
		{ tag: source, prefix: '' },
		...others.map((tag) => ({ tag, prefix: prefixOf(tag, source) })),
	];
	const catalogOf = (language: Language): Catalog | undefined => options.locales?.[language.tag];

	const renderAt = async (url: string, language: Language): Promise<Rendered> => {
		const catalog = catalogOf(language);
		const own = context({
			...(language.tag === '' ? {} : { locale: language.tag }),
			...(catalog === undefined ? {} : { catalog }),
		});
		// No window, so the router runs from the URL it is given and every browser effect is off.
		// The language's prefix is the router's base, so a link the page writes with `router.base`
		// in front stays in its language.
		const body = await render(options.page(createRouter({ url, base: language.prefix })), { context: own });
		return { body, own };
	};

	/** The absolute URL of a path in a language, for the alternates. */
	const absolute = (language: Language, path: string): string =>
		`${options.base!.replace(/\/+$/, '')}${urlIn(language, path)}`;

	/** Every language's URL for a path, with the source language as the default, or none without a `base`. */
	const alternatesOf = (path: string): Alternate[] => {
		if (options.base === undefined || languages.length < 2) return [];
		return [
			...languages.map((language) => ({ hreflang: language.tag, href: absolute(language, path) })),
			{ hreflang: 'x-default', href: absolute(languages[0]!, path) },
		];
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

	/** The document's language parts, or none for a site with no language. The fallback page has no alternates: it is no URL of the site's. */
	const languageParts = (language: Language, path: string | null): Pick<DocumentParts, 'lang' | 'rtl' | 'alternates'> => {
		if (language.tag === '') return {};
		const alternates = path === null ? [] : alternatesOf(path);
		return {
			lang: language.tag,
			...(rightToLeft(language.tag) ? { rtl: true } : {}),
			...(alternates.length > 0 ? { alternates } : {}),
		};
	};

	/** The file a name that is not a page, `404.html` or `shell.html`, is written to in a language. */
	const fileIn = (language: Language, name: string): string =>
		(language.prefix === '' ? name : `${language.prefix.slice(1)}/${name}`);

	/** One page of one path in one language. */
	const madeAt = async (path: string, language: Language, showing = false): Promise<Made> => {
		const clean = normalise(path);
		const { body, own } = await renderAt(clean, language);
		if (!showing) {
			const empty = emptyStage(own);
			if (empty !== null) {
				throw codecError('not-a-page', `${urlIn(language, clean)} left the stage at ${JSON.stringify(empty.prefix)} showing ${empty.current === null ? 'nothing' : JSON.stringify(empty.current)}`,
					'Ask for a URL the site has; walk() answers the list, and the fallback is written once as 404.html.');
			}
		}
		const title = own.head.title();
		const parts: DocumentParts = {
			body, css: own.theme.markup(), head: own.head.markup(), title,
			...languageParts(language, showing ? null : clean),
		};
		return { html: buildDocument(shell, parts), title, noindex: noindexOf(own.head), language, used: usedText(own) };
	};

	/** The page a URL names, in the language its prefix names. */
	const pageAt = (url: string): Promise<Made> => {
		const placed = placeOf(url, languages, source);
		return madeAt(placed.path, placed.language);
	};

	const walk = (): Promise<WalkResult> =>
		walkSite(async (url) => [...(await renderAt(url, languages[0]!)).own.stage.items]);

	/** The shell in a language: `lang` on `<html>`, and no stamp, so `attach` mounts it live. */
	const shellIn = (language: Language): string =>
		(language.tag === '' ? shell : languageOn(shell, languageParts(language, null)));

	/** What each catalog lacks and holds beyond what the pages looked up. */
	const reportOf = (used: ReadonlyMap<string, Set<string>>): Record<string, TextReport> => {
		const report: Record<string, TextReport> = {};
		for (const language of languages.slice(1)) {
			const catalog = catalogOf(language) ?? {};
			const keys = used.get(language.tag) ?? new Set<string>();
			report[language.tag] = {
				missing: [...keys].filter((key) => !Object.hasOwn(catalog, key)).sort(),
				unused: Object.keys(catalog).filter((key) => !keys.has(key)).sort(),
			};
		}
		return report;
	};

	const write = async (urls?: readonly string[]): Promise<WriteResult> => {
		const used = new Map<string, Set<string>>();
		const note = (made: Made): void => {
			let keys = used.get(made.language.tag);
			if (keys === undefined) {
				keys = new Set();
				used.set(made.language.tag, keys);
			}
			for (const key of made.used) keys.add(key);
		};

		if (urls !== undefined) {
			const files: [string, string][] = [];
			const written: string[] = [];
			// One spelling per page, so `/fr` and `/fr/` in one list are one write.
			for (const url of [...new Set(urls.map(normalise))]) {
				const placed = placeOf(url, languages, source);
				// A URL with no prefix is the page in every language; a prefixed one is that language's.
				const wanted = placed.language.tag === source && normalise(url) === placed.path ? languages : [placed.language];
				for (const language of wanted) {
					const made = await madeAt(placed.path, language);
					note(made);
					const at = urlIn(language, placed.path);
					files.push([fileOf(at), made.html]);
					written.push(at);
				}
			}
			await writeFiles(out, files);
			return { files: files.map(([name]) => name), urls: written, unenumerated: [], sitemap: null, text: reportOf(used) };
		}

		const found = await walk();
		const files: [string, string][] = [];
		const written: string[] = [];
		const indexable: SitemapEntry[] = [];
		for (const language of languages) {
			for (const path of found.urls) {
				const made = await madeAt(path, language);
				note(made);
				const at = urlIn(language, path);
				files.push([fileOf(at), made.html]);
				written.push(at);
				if (!made.noindex) indexable.push({ url: at, ...(languages.length < 2 ? {} : { alternates: alternatesOf(path) }) });
			}
			// The fallback is whatever the site puts on a page nothing matched, which is what a host
			// serving 404.html shows. Its URL is not one of the site's, so it is in no sitemap, and
			// this is the one render allowed to end on a stage showing nothing.
			const fallback = await madeAt(FALLBACK, language, true);
			note(fallback);
			files.push([fileIn(language, '404.html'), fallback.html]);
			// The shell as it stands: no stamp, so `attach` mounts live rather than hydrating.
			files.push([fileIn(language, 'shell.html'), shellIn(language)]);
		}

		const sitemap = options.base === undefined ? null : 'sitemap.xml';
		if (sitemap !== null) files.push([sitemap, sitemapOf(options.base!, indexable)]);

		await writeFiles(out, files);
		return { files: files.map(([name]) => name), urls: written, unenumerated: found.unenumerated, sitemap, text: reportOf(used) };
	};

	return {
		walk,
		page: async (url) => {
			const { html, title, noindex } = await pageAt(url);
			return { html, title, noindex };
		},
		write,
	};
};
