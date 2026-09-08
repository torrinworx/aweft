// Where the server is: the page this code runs in, and nowhere else (design 183).
//
// Sniffing a backend out of anything but the page's own origin is how a build ends up with a
// staging address baked into it, so there is one default and everything else is declared.

import { codecError } from '@aweftjs/codec';

/** The two fields read off `globalThis.location`, stated here so no DOM types come in with them. */
interface Origin {
	readonly protocol?: unknown;
	readonly host?: unknown;
}

const NO_URL_FIX = 'Pass url to createClient; outside a page there is no origin to read one from.';

/**
 * The page's own origin as a WebSocket address.
 *
 * Params: none.
 *
 * Returns: the page's host with the `wss` scheme under `https` and `ws` otherwise, path `/`
 * and no query.
 *
 * Throws: `no-url` when there is no `location`, which is every runtime that is not a page.
 *
 * Example:
 *   const url = options.url ?? pageUrl();
 */
export const pageUrl = (): string => {
	const origin = (globalThis as { location?: Origin }).location;
	const protocol = origin?.protocol;
	const host = origin?.host;
	if (typeof protocol !== 'string' || typeof host !== 'string' || host === '') {
		throw codecError('no-url', 'there is no page origin to take the server address from', NO_URL_FIX);
	}
	return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/`;
};
