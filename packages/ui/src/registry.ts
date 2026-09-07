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

const HOLD: unique symbol = Symbol('aweft.ui.registry.hold');

/**
 * Keep a registry's items after the page that added them has been taken down.
 *
 * A static render mounts the page, serializes it and unmounts it, so by the time the caller
 * reads the head tags or the stage list every component that added one has already been
 * removed. `render` holds both lists before it starts, which is why they are still there
 * afterwards (designs 127 and 145).
 *
 * An internal seam behind a symbol rather than a name on `Registry`: only this package's
 * `render` may do it, and a page that mounts has to keep letting go as it navigates.
 *
 * Returns: whether it was already held, so a caller can tell a second use of one render object
 * from the first.
 */
export const hold = <T>(registry: Registry<T>): boolean => {
	const held = (registry as unknown as Record<symbol, (() => boolean) | undefined>)[HOLD];
	return held === undefined ? false : held();
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
	let holding = false;
	const registry = {
		items,
		claim: () => {
			if (taken) return false;
			taken = true;
			return true;
		},
		add: (item: T) => {
			items.push(item);
			return () => {
				if (!holding) drop(items, item);
			};
		},
		[HOLD]: () => {
			const already = holding;
			holding = true;
			return already;
		},
	};
	return registry as Registry<T>;
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
