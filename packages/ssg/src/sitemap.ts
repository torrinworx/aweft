// The sitemap, written from the walk (design 150).
//
// Nothing here reads a file back: a sitemap is a statement about every page a site has, so it is
// written whole or not at all.

const ESCAPES: Record<string, string> = {
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;',
};

const escape = (text: string): string => text.replace(/[&<>"']/g, (found) => ESCAPES[found]!);

/**
 * The sitemap for a set of URLs.
 *
 * Params:
 *   base: the site's absolute URL, `https://example.com`, with or without a trailing slash
 *   urls: the URLs to list, each starting with a slash. Give it the indexable ones only
 *
 * Returns: the whole `sitemap.xml`, one `<url>` per entry, in the order they were given.
 *
 * Example:
 *   writeFileSync('dist/sitemap.xml', sitemapOf('https://example.com', ['/', '/about']));
 */
export const sitemapOf = (base: string, urls: readonly string[]): string => {
	const root = base.replace(/\/+$/, '');
	const entries = urls
		.map((url) => `\t<url>\n\t\t<loc>${escape(root + url)}</loc>\n\t</url>`)
		.join('\n');
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
		+ (entries === '' ? '' : `${entries}\n`)
		+ '</urlset>\n';
};
