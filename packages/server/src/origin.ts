// The Origin rule, checked before the gate (design 272): a browser names where a request came
// from, and a state-changing request or a handshake from another site is refused.

import type { Refusal } from '@aweftjs/core';

/** What `origins` on `createServer` takes: more origins a browser may send from, or the rule off. */
export type Origins = readonly string[] | 'any';

// A read changes nothing, and the browser's own rules already keep its answer from another site.
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const hostOf = (origin: string): string | undefined => {
	try {
		return new URL(origin).host;
	} catch {
		// `null`, the opaque origin of a sandboxed frame or a file, is not a host at all.
		return undefined;
	}
};

/**
 * Why a request's Origin is refused, or undefined when it passes.
 *
 * Params:
 *   request: the request or handshake, read for its `Origin` header and its own host
 *   handshake: true for a socket handshake, which is a state change whatever its method
 *   origins: the extra origins allowed, or `'any'`
 *
 * Returns: a refusal with code `origin`, or undefined. A request with no `Origin` header
 * passes; one whose origin's host is the request's own host, port included, passes; one whose
 * origin is in the list passes.
 *
 * Example:
 *   const refused = originRefusal(request, false, []);
 *   if (refused !== undefined) return json(403, { reasons: [refused] });
 */
export const originRefusal = (request: Request, handshake: boolean, origins: Origins): Refusal | undefined => {
	if (origins === 'any') return undefined;
	if (!handshake && SAFE.has(request.method)) return undefined;
	const header = request.headers.get('origin');
	if (header === null) return undefined;
	const host = hostOf(header);
	if (host !== undefined) {
		if (host === new URL(request.url).host) return undefined;
		if (origins.some((one) => hostOf(one) === host)) return undefined;
	}
	return {
		code: 'origin',
		message: `${header} may not ${handshake ? 'open a socket' : request.method} here; the request is for ${new URL(request.url).host}`,
	};
};
