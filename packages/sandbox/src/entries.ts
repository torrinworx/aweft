// The room's history: where the router's URL and its entries live when the page's history
// is out of reach (design 282). An `Entries` over the route document the host shared.
//
// `current` reads the document's `url`. `push`, `replace` and `back` write `url`, `move` and
// `seq`, and the host applies them on the page; `seq` counts up on every write so that a push
// of the URL already showing is still a commit. The host answers every entry change with
// `url` and `key`, and that is when `listen` fires. The router stamps a state per entry and
// reads it back through `state`; this keeps each one by the page key the host answers with,
// so back and forward hand the router its own key back.

import { atomic, observer } from '@aweftjs/core';
import type { Entries } from '@aweftjs/dom/router';

import { sandboxError } from './contract.ts';
import { type RouteDocument, isTailPath } from './route.ts';

/** The room's entries, with the way to stop following the document. */
export interface RoomEntries extends Entries {
	stop(): void;
}

/**
 * Make the entries a room's router runs over.
 *
 * Params:
 *   route: the room's copy of the route document, as `enter` answered it
 *
 * Returns: the entries. `push` and `replace` refuse a `url` that is not a tail path, because
 * the host would refuse the commit and the router would be left showing a URL the page never
 * took.
 *
 * Throws: from `push` and `replace`, a `SandboxError` with reason `outside-tail`.
 *
 * Example:
 *   const router = createRouter({ entries: routeEntries(entered.route) });
 */
export const routeEntries = (route: RouteDocument): RoomEntries => {
	const states = new Map<string, unknown>();
	/** The state of the room's last push, until the host answers with the key it landed on. */
	let pending: { readonly state: unknown } | null = null;
	const listeners = new Set<() => void>();
	let writing = false;

	const write = (fn: () => void): void => {
		writing = true;
		try {
			atomic(fn);
		} finally {
			writing = false;
		}
	};

	const check = (href: string): void => {
		if (isTailPath(href)) return;
		throw sandboxError('outside-tail', `${href} is not a path inside the room's tail`,
			'Push a path starting with / and no . or .. segment; a room moves the page under the host act and nowhere else.');
	};

	// Deliveries are synchronous, so a write made here is heard while `writing` holds and
	// everything else is the host's: the page's entry changed under the act.
	const stop = observer(route).watch(() => {
		if (writing) return;
		if (pending !== null) {
			states.set(route.key, pending.state);
			pending = null;
		}
		for (const fn of [...listeners]) fn();
	});

	return {
		current: () => route.url,
		state: () => states.get(route.key) ?? null,
		push: (state, href) => {
			check(href);
			pending = { state };
			write(() => {
				route.url = href;
				route.move = 'push';
				route.seq += 1;
			});
		},
		replace: (state, href) => {
			check(href);
			// The entry showing keeps its page key under a replace, so the state is its own at once.
			// The router replaces the URL it is already on to stamp an entry it did not write, and
			// that needs no trip across the wall.
			states.set(route.key, state);
			if (href === route.url) return;
			write(() => {
				route.url = href;
				route.move = 'replace';
				route.seq += 1;
			});
		},
		back: () => {
			write(() => {
				route.move = 'back';
				route.seq += 1;
			});
		},
		listen: (fn) => {
			listeners.add(fn);
			return () => { listeners.delete(fn); };
		},
		stop,
	};
};
