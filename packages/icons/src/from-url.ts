// A name resolved over the network, for names that are only known when the page runs (design 143).
//
// It speaks the URL and the answer shape the public icon APIs already use, so the default base is
// a real service and an application's own route is a mirror rather than a port. A drawing that
// arrives this way is somebody else's markup, and one that can run is refused (design 274).

import { codecError } from '@aweftjs/codec';
import type { IconData } from '@aweftjs/ui';

import { type IconSet, pickIcon } from './set.ts';

// What runs, or reaches out, once a body is written into the page: a script element, an event
// attribute, HTML carried in through foreignObject, a javascript: URL, and a reference to
// anything but the document itself. An attribute name can follow whitespace, a slash or a
// quote, since the parser takes each as the end of what came before. The href pattern names
// the quoted and unquoted spellings apart, because an optional quote before the lookahead
// would step back and match `"#`.
const RUNS: readonly RegExp[] = [
	/<script/i, /[\s/"']on[a-z]+\s*=/i, /<foreignObject/i, /javascript:/i,
	/(?:xlink:)?href\s*=\s*(?:"(?!#)|'(?!#)|(?!["'#]))/i,
];

/**
 * A resolver that fetches one icon at a time from an icon API.
 *
 * Nothing installs this. Add it to `Icons` where you want it, and a page that does not stays a
 * page that makes no requests.
 *
 * The request is `<base>/<set>.json?icons=<name>` and the answer is
 * `{ prefix, icons: { <name>: data }, aliases?, width?, height? }`. A root size in the answer
 * applies to an icon that carries none, and an alias is followed once.
 *
 * Params:
 *   base: where the API lives, with no trailing slash, such as `https://api.iconify.design`
 *
 * Returns: a resolver `Icons` takes. It answers null for a name with no set in it, for a set that
 * does not know the name, and for an answer that is not the shape above, whether it fails to parse
 * at all or parses to something else, so the next source in the stack is asked. A request that
 * fails to reach the far end rejects, and `Icon` reports that naming the icon and the reason.
 *
 * Throws: `unsafe-body` when the drawing carries a `<script`, an event attribute, a
 * `<foreignObject`, a `javascript:` URL, or an `href` that does not begin with `#`. The next
 * source is not asked: the page hears which source refused and why.
 *
 * Example:
 *   <Icons value={[myPack, fromUrl('https://api.iconify.design')]}><App /></Icons>
 */
export const fromUrl = (base: string): (name: string) => Promise<IconData | null> => async (name) => {
	const at = name.indexOf(':');
	// No set in the name means there is nowhere to send it. Guessing one would answer a standard
	// name with a drawing from whichever set was guessed.
	if (at < 1 || at === name.length - 1) return null;
	const set = name.slice(0, at);
	const icon = name.slice(at + 1);

	const answer = await fetch(`${base}/${set}.json?icons=${encodeURIComponent(icon)}`);
	if (!answer.ok) return null;
	let body: unknown;
	try {
		body = await answer.json();
	} catch {
		// A 200 carrying a proxy's HTML, an empty body or a truncated answer is a lookup that
		// failed, the same as a 404. Letting it reject would stop the stack on a source it was
		// only asking.
		return null;
	}
	if (body === null || typeof body !== 'object') return null;
	const held = body as IconSet;
	if (typeof held.icons !== 'object' || held.icons === null) return null;
	const data = pickIcon(held, icon);
	if (data !== null && RUNS.some((runs) => runs.test(data.body))) {
		throw codecError('unsafe-body', `${name}: the drawing carries markup that can run or reach out of the page`, 'Serve icons from a source you trust, or take that icon out of the set it came from.');
	}
	return data;
};
