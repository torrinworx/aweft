// A language on a URL (design 279).
//
// The source language stands where the site stood: `/about`. Every other language stands under
// its tag: `/fr/about`. One rule, written here and read by the site on the way out and by the
// client half on the way in, so the two halves cannot disagree about which page is in which
// language.

import { normalise } from './url.ts';

/** One language a site is written in. */
export interface Language {
	/** The BCP 47 tag. */
	readonly tag: string;
	/** The prefix its URLs carry: `''` for the source language, `/fr` for every other. */
	readonly prefix: string;
}

/** A URL taken apart: the language it names and the path under it. */
export interface Placed {
	readonly language: Language;
	/** The path relative to the language's prefix, normalised. */
	readonly path: string;
}

/** The prefix a tag's URLs carry. */
export const prefixOf = (tag: string, source: string): string => (tag === source ? '' : `/${tag}`);

/**
 * Where a URL belongs.
 *
 * Params:
 *   url: a path, with or without its slashes
 *   languages: every language the site has, the source one included
 *   source: the source language's tag
 *
 * Returns: the language whose prefix the URL carries, and the path under it. A URL whose first
 * segment is no language's tag is the source language's.
 *
 * Example:
 *   placeOf('/fr/about', languages, 'en');  // { language: { tag: 'fr', prefix: '/fr' }, path: '/about' }
 */
export const placeOf = (url: string, languages: readonly Language[], source: string): Placed => {
	const clean = normalise(url);
	for (const language of languages) {
		if (language.tag === source) continue;
		if (clean === language.prefix) return { language, path: '/' };
		if (clean.startsWith(`${language.prefix}/`)) return { language, path: clean.slice(language.prefix.length) };
	}
	const own = languages.find((language) => language.tag === source);
	return { language: own ?? { tag: source, prefix: '' }, path: clean };
};

/** The URL a path has in a language. */
export const urlIn = (language: Language, path: string): string =>
	normalise(`${language.prefix}${normalise(path)}`);

/**
 * Whether a language's script runs right to left, as the host's own tables say.
 *
 * Returns: true for `ar`, `he`, `fa`, `ur` and the rest, and false for everything else and for a
 * host without `Intl.Locale.prototype.getTextInfo`, which then writes no `dir` at all.
 */
export const rightToLeft = (tag: string): boolean => {
	const Locale = (Intl as unknown as { Locale?: new (tag: string) => { getTextInfo?(): { direction: string } } }).Locale;
	if (Locale === undefined) return false;
	try {
		const info = new Locale(tag);
		return typeof info.getTextInfo === 'function' && info.getTextInfo().direction === 'rtl';
	} catch {
		return false;
	}
};
