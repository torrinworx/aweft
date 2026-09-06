// The two shapes every per-render system is made of: a list something pushes into, and a
// counter that starts at zero for each render.

import { type MutableArray, mutableArray } from '@aweftjs/core';

/** A list a component pushes into and something else renders. */
export interface Registry<T = unknown> {
	/** What is in it now, in the order it was added. Watch it to follow the list. */
	readonly items: MutableArray<T>;
	/**
	 * Add one item.
	 *
	 * Returns: the removal, as every registration in this stack does. Calling it twice, or
	 * after the item has gone, does nothing.
	 */
	add(item: T): () => void;
	/**
	 * Claim this registry as the one place rendering it.
	 *
	 * Returns: true the first time, and false to everyone after. A registry rendered in two places
	 * mounts every item in it twice, and `dom` refuses to mount a node that is already mounted, so
	 * the second caller makes its own instead.
	 */
	claim(): boolean;
}

/**
 * Take one item out of a list, by identity.
 *
 * By identity and guarded, never by a remembered index: an index goes stale as soon as anything
 * else in the list is removed, and `splice(-1, 1)` takes the last item out instead of nothing.
 * Both the registry below and a context's children list remove this way, so the rule is written
 * once.
 */
export const drop = <T>(items: MutableArray<T>, item: T): void => {
	const at = items.indexOf(item);
	if (at >= 0) items.splice(at, 1);
};

/**
 * Make an empty registry.
 *
 * Example:
 *   const stop = render.popups.add(node);
 */
export const createRegistry = <T>(): Registry<T> => {
	const items = mutableArray<T>();
	let taken = false;
	return {
		items,
		claim: () => {
			if (taken) return false;
			taken = true;
			return true;
		},
		add: (item) => {
			items.push(item);
			return () => { drop(items, item); };
		},
	};
};

/** The id source behind an `aria-labelledby` and its friends. */
export interface Ids {
	/**
	 * The next id for this render.
	 *
	 * Params:
	 *   prefix: what to put in front of the number, `aw` when omitted
	 *
	 * Returns: a fresh id. The sequence depends only on the order things mount, so a server
	 * and a browser walking the same item mint the same ids and a hydration matches.
	 */
	next(prefix?: string): string;
}

/** Make a counter that starts at zero. */
export const createIds = (): Ids => {
	let at = 0;
	return {
		next: (prefix = 'aw') => {
			const id = `${prefix}-${at}`;
			at += 1;
			return id;
		},
	};
};
