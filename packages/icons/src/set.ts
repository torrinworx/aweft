// What a published icon set looks like, and how one icon comes out of it (design 141).
//
// The shape is written here from the format the sets and the public icon APIs use, not read off
// any package: nothing in this repo imports a set as a module, so nothing here needs a set's own
// declarations to compile. The same shape covers a set read off disk and an answer fetched from
// a URL, which is why both readers share this file.

import type { IconData, IconPack } from '@aweftjs/ui';

/** One icon as a set publishes it: the drawing, and its box only where it differs from the set's. */
export interface SetIcon {
	readonly body: string;
	readonly width?: number;
	readonly height?: number;
	readonly left?: number;
	readonly top?: number;
	readonly rotate?: number;
	readonly hFlip?: boolean;
	readonly vFlip?: boolean;
}

/** One name pointing at another in the same set, with its own turns and flips on top. */
export interface SetAlias {
	readonly parent: string;
	readonly rotate?: number;
	readonly hFlip?: boolean;
	readonly vFlip?: boolean;
}

/** A whole set, or the part of one an API answered with. */
export interface IconSet {
	readonly prefix?: string;
	readonly icons?: Readonly<Record<string, SetIcon>>;
	readonly aliases?: Readonly<Record<string, SetAlias>>;
	/** The set's own box. Every icon in it that declares none is drawn in this one. */
	readonly width?: number;
	readonly height?: number;
}

/** The icon with the set's box on it where it states none of its own. */
const sized = (set: IconSet, icon: SetIcon): IconData => {
	const width = icon.width ?? set.width;
	const height = icon.height ?? set.height;
	return {
		...icon,
		...(width === undefined ? {} : { width }),
		...(height === undefined ? {} : { height }),
	};
};

/**
 * One icon out of a set, with the set's box applied and an alias followed once.
 *
 * Params:
 *   set: the set, as read off disk or answered by an API
 *   name: the icon's name inside the set, with no prefix on it
 *
 * Returns: the icon, or null when the set has neither an icon nor an alias under that name.
 *
 * Example:
 *   const data = pickIcon(set, 'check');
 */
export const pickIcon = (set: IconSet, name: string): IconData | null => {
	const found = set.icons?.[name];
	if (found !== undefined) return sized(set, found);

	const alias = set.aliases?.[name];
	if (alias === undefined) return null;
	const parent = set.icons?.[alias.parent];
	if (parent === undefined) return null;
	return {
		...sized(set, parent),
		...(alias.rotate === undefined ? {} : { rotate: alias.rotate }),
		...(alias.hFlip === undefined ? {} : { hFlip: alias.hFlip }),
		...(alias.vFlip === undefined ? {} : { vFlip: alias.vFlip }),
	};
};

/**
 * A whole set as a pack `Icons` takes.
 *
 * The root size stays on the pack rather than being written onto every icon, because that is
 * what the pack carries it for and it is 1865 copies of one number otherwise.
 *
 * Params:
 *   set: the set
 *
 * Returns: the pack: the prefix, the icons, the aliases, and the set's box.
 *
 * Example:
 *   const pack = packOf(set);
 */
export const packOf = (set: IconSet): IconPack => ({
	...(set.prefix === undefined ? {} : { prefix: set.prefix }),
	icons: set.icons ?? {},
	...(set.aliases === undefined ? {} : { aliases: set.aliases }),
	...(set.width === undefined ? {} : { width: set.width }),
	...(set.height === undefined ? {} : { height: set.height }),
});

/**
 * A few names out of a set, as a pack.
 *
 * Params:
 *   set: the set
 *   names: the names wanted
 *
 * Returns: a pack holding only the names the set has, each with the set's box already on it, so
 * the pack needs no root size and no aliases. A name the set lacks is left out.
 *
 * Example:
 *   const pack = selectionOf(set, standardIcons);
 */
export const selectionOf = (set: IconSet, names: readonly string[]): IconPack => {
	const icons: Record<string, IconData> = {};
	for (const name of names) {
		const found = pickIcon(set, name);
		if (found !== null) icons[name] = found;
	}
	return { ...(set.prefix === undefined ? {} : { prefix: set.prefix }), icons };
};
