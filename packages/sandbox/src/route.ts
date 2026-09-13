// The route document: the tail the room's stage runs over, crossing the wall (design 279).
//
// The host writes `url` and `key` when the page's entry changes under the act; the room writes
// `url`, `move` and `seq` to move. `seq` is what makes a room write a commit even when the
// URL is the one already showing. The guard here is the host's, against a room that is not
// running this package's far end: a `url` that could leave the tail never applies.

import type { Commit } from '@aweftjs/codec';
import type { ShareHandlers } from '@aweftjs/sync';

/** What the route document holds. Flat, so every field is one slot. */
export interface RouteDocument extends Record<string, unknown> {
	/** The tail showing now, a path starting with `/`. */
	url: string;
	/** The page's history entry key for `url`. The host writes it; the room reads it. */
	key: string;
	/** How the room's last write is applied. */
	move: 'push' | 'replace' | 'back';
	/** Counts the room's writes, so a push of the URL already showing is still a commit. */
	seq: number;
}

/** The name the route document crosses under. Reserved, with the three of design 066. */
export const ROUTE = 'route';

const MOVES: readonly string[] = ['push', 'replace', 'back'];

// A dot segment, in any spelling the URL parser treats as one. The browser resolves these
// against the host act's prefix, which is how `/app/3/../../x` would leave the tail.
const DOT_SEGMENT = /^(?:\.|%2e)(?:\.|%2e)?$/i;

/** The most a room `url` may hold: a history entry is not the place for a room's data. */
const MOST = 8192;

// The browser strips a control character out of a URL it is handed, so the router's cell and
// the address bar would disagree about what the room pushed.
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Whether a room `url` is a path that stays inside the tail: it starts with one `/`, not
 * with `//` or `/\`, no segment of its path part is `.` or `..` in any spelling, it holds no
 * control character, and it is at most 8192 characters.
 */
export const isTailPath = (url: string): boolean => {
	if (url.length > MOST || CONTROL.test(url)) return false;
	if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) return false;
	const path = url.replace(/[?#].*$/, '');
	return path.split(/[/\\]/).every((segment) => !DOT_SEGMENT.test(segment));
};

/** The host's rules for a room commit on the route document: the room writes three slots, and `url` stays a tail path. */
export const routeGuard: ShareHandlers = {
	accept: (commit: Commit) => {
		for (const delta of commit.deltas) {
			if (delta.ref.kind !== 'object' || delta.type !== 'replace') {
				return [{ code: 'read-only', message: 'the route document holds four slots and gains none' }];
			}
			const { key } = delta.ref;
			if (key === 'url') {
				if (typeof delta.value !== 'string' || !isTailPath(delta.value)) {
					return [{ code: 'outside-tail', message: 'a room url is a path starting with / and stays inside the tail' }];
				}
			} else if (key === 'move') {
				if (typeof delta.value !== 'string' || !MOVES.includes(delta.value)) {
					return [{ code: 'malformed', message: 'move is push, replace or back' }];
				}
			} else if (key === 'seq') {
				if (typeof delta.value !== 'number') return [{ code: 'malformed', message: 'seq is a number' }];
			} else {
				return [{ code: 'read-only', message: `the room does not write ${key} on the route document` }];
			}
		}
		return [];
	},
};
