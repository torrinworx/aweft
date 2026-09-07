// A name resolved over the network, for names that are only known when the page runs (design 143).
//
// It speaks the URL and the answer shape the public icon APIs already use, so the default base is
// a real service and an application's own route is a mirror rather than a port.

import type { IconData } from '@aweftjs/ui';

import { type IconSet, pickIcon } from './set.ts';

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
	return pickIcon(held, icon);
};
