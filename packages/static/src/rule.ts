// The URL rule, and there is no other (design 249).
//
// The path is decoded before it is split, so an encoded slash cannot smuggle a segment past
// the check: `/..%2Fsecret` is one segment to a URL parser and two to this.

/**
 * The path a URL asks for, under the served directory, or undefined when the rule says it is
 * not a file.
 *
 * Params:
 *   url: the request's URL, absolute, as a `Request` carries it
 *
 * Returns: the path with its leading slash and its query removed, so `/` is `''` and
 * `/docs/install` is `docs/install`. Undefined for a path this module will not look up: one
 * whose escapes do not decode, or with a segment that is `..` or begins with a dot.
 *
 * Example:
 *   pathOf('http://app.test/docs/?v=2');   // 'docs/'
 *   pathOf('http://app.test/.env');        // undefined
 */
export const pathOf = (url: string): string | undefined => {
	let path: string;
	try {
		path = decodeURIComponent(new URL(url).pathname);
	} catch {
		return undefined;
	}
	// `..` begins with a dot, so one check covers the traversal and the dotfile alike.
	for (const segment of path.split('/')) {
		if (segment.startsWith('.')) return undefined;
	}
	return path.replace(/^\/+/, '');
};
