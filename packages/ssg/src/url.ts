// What a URL is, on the way in and on the way out.
//
// One spelling per page, so `/docs` and `/docs/` are one entry in the walk and one file on disk.
// The matcher strips the slashes either way (`ui`'s `route.ts`), so a walk that kept both would
// render one page twice and write it to two paths.

/** The URL the fallback act is rendered at: a path a site is not expected to declare. */
export const FALLBACK = '/_aweft-404';

/**
 * One URL, spelled the one way: a leading slash, no trailing one, no query and no hash.
 *
 * Params:
 *   url: a path, with or without its slashes
 *
 * Returns: `/` for the site root, and `/a/b` for everything else.
 *
 * Example:
 *   normalise('docs/');  // '/docs'
 */
export const normalise = (url: string): string => {
	const path = url.replace(/[?#].*$/, '').replace(/^\/+/, '').replace(/\/+$/, '');
	return path === '' ? '/' : `/${path}`;
};

/**
 * The URL an act key has under its stage.
 *
 * Params:
 *   prefix: the stage's prefix, as the registry reports it: what its parent matched, not the
 *           pattern (design 126)
 *   key: the act key, relative to the prefix
 *
 * Returns: the normalised URL.
 *
 * Example:
 *   urlOf('posts/3', 'edit');  // '/posts/3/edit'
 */
export const urlOf = (prefix: string, key: string): string =>
	normalise(prefix === '' ? key : key === '' ? prefix : `${prefix}/${key}`);

/** The path under `out` a URL is written to: `<url>/index.html`, and `index.html` for the root. */
export const fileOf = (url: string): string => {
	const path = normalise(url).slice(1);
	return path === '' ? 'index.html' : `${path}/index.html`;
};
