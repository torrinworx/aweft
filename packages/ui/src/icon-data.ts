// What an icon is, and how a name is looked up in a stack of packs (design 131).
//
// The shape is the one the icon sets already publish, so an application installs a pack and hands
// it over with no converter in between.

/** One icon, in the shape the icon sets publish. */
export interface IconData {
	/** What goes inside the `<svg>`: paths, groups, whatever the glyph is drawn from. */
	readonly body: string;
	/** The drawing's own box. 16 when it says nothing, which is what the sets default to. */
	readonly width?: number;
	readonly height?: number;
	/** Where that box starts. 0 when it says nothing. */
	readonly left?: number;
	readonly top?: number;
	/** Quarter turns, applied before the `rot` prop. */
	readonly rotate?: number;
	readonly hFlip?: boolean;
	readonly vFlip?: boolean;
}

/** One name pointing at another, with its own turns and flips on top. */
export interface IconAlias {
	readonly parent: string;
	readonly rotate?: number;
	readonly hFlip?: boolean;
	readonly vFlip?: boolean;
}

/** A set of icons under one prefix. */
export interface IconPack {
	/** The prefix the set publishes under. A `prefix:name` lookup matches on it. */
	readonly prefix?: string;
	readonly icons: Readonly<Record<string, IconData>>;
	readonly aliases?: Readonly<Record<string, IconAlias>>;
}

/** A function that finds an icon, or answers null so the next source in the stack is asked. */
export type IconResolver = (name: string) => IconData | Promise<IconData | null> | null;

/** What `Icons` holds: packs and resolvers, newest first. */
export type IconSource = IconPack | IconResolver;

/** Whether a source is a pack rather than a resolver. */
export const isPack = (source: IconSource): source is IconPack =>
	typeof source === 'object' && source !== null && 'icons' in source;

/** The name a pack is asked for, once its own prefix is off the front, or null when the name
 * names another pack. */
const withoutPrefix = (pack: IconPack, name: string): string | null => {
	if (pack.prefix === undefined) return name;
	const at = name.indexOf(':');
	if (at < 0) return name;
	return name.slice(0, at) === pack.prefix ? name.slice(at + 1) : null;
};

/** One pack's answer, following an alias once. */
export const fromPack = (pack: IconPack, name: string): IconData | null => {
	const key = withoutPrefix(pack, name);
	if (key === null) return null;
	const found = pack.icons[key];
	if (found !== undefined) return found;

	const alias = pack.aliases?.[key];
	if (alias === undefined) return null;
	const parent = pack.icons[alias.parent];
	if (parent === undefined) return null;
	// An alias is its parent with the alias's own turns and flips on top, which is the shape the
	// sets publish and the reason an alias is not simply a second name for one object.
	const over: IconData = { ...parent };
	return {
		...over,
		...(alias.rotate === undefined ? {} : { rotate: alias.rotate }),
		...(alias.hFlip === undefined ? {} : { hFlip: alias.hFlip }),
		...(alias.vFlip === undefined ? {} : { vFlip: alias.vFlip }),
	};
};

/**
 * Ask a stack of packs and resolvers for one name.
 *
 * Params:
 *   name: what to look for, with or without a pack's prefix
 *   stack: the sources, newest first
 *
 * Returns: the first answer that is not null, which may be a promise a resolver made, or null
 * when nothing in the stack knows the name.
 */
export const lookupIcon = (
	name: string,
	stack: readonly IconSource[],
): IconData | Promise<IconData | null> | null => {
	for (const source of stack) {
		const found = isPack(source) ? fromPack(source, name) : source(name);
		if (found !== null && found !== undefined) return found;
	}
	return null;
};

/** The turns and flips of the data, as one SVG transform, or null when it is the identity. */
export const transformOf = (data: IconData, width: number, height: number): string | null => {
	const parts: string[] = [];
	const turns = (((data.rotate ?? 0) % 4) + 4) % 4;
	if (turns !== 0) parts.push(`rotate(${String(turns * 90)} ${String(width / 2)} ${String(height / 2)})`);
	if (data.hFlip === true) parts.push(`translate(${String(width)} 0) scale(-1 1)`);
	if (data.vFlip === true) parts.push(`translate(0 ${String(height)}) scale(1 -1)`);
	return parts.length === 0 ? null : parts.join(' ');
};
