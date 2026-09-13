// The sitemap, written from the walk (design 150).
//
// Nothing here reads a file back: a sitemap is a statement about every page a site has, so it is
// written whole or not at all.

const ESCAPES: Record<string, string> = {
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;',
};

const escape = (text: string): string => text.replace(/[&<>"']/g, (found) => ESCAPES[found]!);

/** One page in the sitemap: its URL, and the same page in every language when the site has more than one. */
export interface SitemapEntry {
	/** The URL, starting with a slash. */
	readonly url: string;
	/** Each language's URL, the `x-default` among them, as `xhtml:link` alternates (design 279). */
	readonly alternates?: readonly { readonly hreflang: string; readonly href: string }[];
}

/**
 * The sitemap for a set of URLs.
 *
 * Params:
 *   base: the site's absolute URL, `https://example.com`, with or without a trailing slash
 *   entries: the pages to list, each URL starting with a slash, with its alternates when the
 *            site has languages. Give it the indexable ones only
 *
 * Returns: the whole `sitemap.xml`, one `<url>` per entry, in the order they were given, with
 * the `xhtml` namespace declared when any entry has alternates.
 *
 * Example:
 *   writeFileSync('dist/sitemap.xml', sitemapOf('https://example.com', [{ url: '/' }, { url: '/about' }]));
 */
export const sitemapOf = (base: string, entries: readonly (SitemapEntry | string)[]): string => {
	const root = base.replace(/\/+$/, '');
	const pages = entries.map((entry) => (typeof entry === 'string' ? { url: entry } : entry));
	const withAlternates = pages.some((page) => page.alternates !== undefined && page.alternates.length > 0);
	const lines = pages
		.map((page) => {
			const links = (page.alternates ?? [])
				.map((one) => `\n\t\t<xhtml:link rel="alternate" hreflang="${escape(one.hreflang)}" href="${escape(one.href)}"/>`)
				.join('');
			return `\t<url>\n\t\t<loc>${escape(root + page.url)}</loc>${links}\n\t</url>`;
		})
		.join('\n');
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${withAlternates ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}>\n`
		+ (lines === '' ? '' : `${lines}\n`)
		+ '</urlset>\n';
};
