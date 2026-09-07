// The theme in effect where an element sits.
//
// `Theme` is a context whose value is a partial theme merged onto whatever is above it, so a
// page can put two themes side by side and each subtree generates its own classes. Definitions
// themselves are static (design 111); this is only about which of them apply where.

import { type Definitions, contentKey, mergeTheme } from './sheet.ts';
import { createContext } from './contexts.ts';
import { use } from './render.ts';
import { isSource } from './source.ts';

// One shared empty object, so the no-provider case is an identity test rather than a merge.
const NONE: Definitions = {};

/**
 * A partial theme for everything below it.
 *
 * Params:
 *   value: entries by `_`-joined selector path, merged onto the theme above
 *   children: the subtree the merged theme applies to
 *
 * A cell here keeps the theme live, which is what a light and dark switch is: the transform runs
 * again on every write and this reads the cell's value each time. Merging the cell object itself
 * would take its own properties for theme entries and leave the page on the theme above.
 *
 * Example:
 *   <Theme value={{ button: { background: 'rebeccapurple' } }}>
 *     <Button label="Go" />
 *   </Theme>
 *
 *   const mode = mutable(light);
 *   <Theme value={mode}><Page /></Theme>
 */
// What each provider was given, before the cell was read through, keyed on the node's own children
// list, which is the one object the transform and the node both hold. An element below has to
// follow those cells to keep its class up to date, and the resolved value it reads through
// `Theme.read` says nothing about which cells it came from.
const raws = new WeakMap<object, unknown>();

export const Theme = createContext<Definitions>(NONE, (raw, parent, children) => {
	raws.set(children as unknown as object, raw);
	const held = isSource(raw) ? raw.get() : raw;
	return held === null || held === undefined ? parent : mergeTheme(parent, held as Definitions);
});

/**
 * Every `Theme` value above a point, as each provider was given it, innermost first.
 *
 * For a caller that has to notice when one of them moves: the resolved theme is a plain object
 * whichever way it was written, so following it means following the cells it came from.
 *
 * Params:
 *   context: the opaque context `dom` handed the mounter
 *
 * Returns: the raw values, cells included. Empty above every provider.
 *
 * Example:
 *   for (const raw of themeRaws(context)) deep(raw);
 */
export const themeRaws = (context: unknown): unknown[] => {
	const out: unknown[] = [];
	for (let node = Theme.node(context); node !== null; node = node.parent) {
		out.push(raws.get(node.children as unknown as object));
	}
	return out;
};

// The merge of the render's base with a provider's overrides, cached by the render's base and by
// what the overrides say. Keyed on the overrides' identity instead, a `<Theme value={{...}}>`
// written inline would be a new theme on every mount, and every mount would mint a class and
// append its rules to a list nothing ever shortens.
const merges = new WeakMap<Definitions, Map<string, Definitions>>();

/**
 * The theme that applies at a point in the tree.
 *
 * Params:
 *   context: the opaque context `dom` handed the mounter
 *
 * Returns: the render's own definitions with every `Theme` above merged onto them. The same
 * object for any two places that say the same thing, so a provider written inline is one theme
 * rather than one per mount.
 *
 * Throws: an assert when the mount has no `ui` systems (design 109).
 *
 * Example:
 *   const classes = use(context).theme.classes(themeAt(context), ['button']);
 */
export const themeAt = (context: unknown): Definitions => {
	const base = use(context).theme.base();
	const over = Theme.read(context);
	if (over === NONE) return base;

	let byOverride = merges.get(base);
	if (byOverride === undefined) {
		byOverride = new Map();
		merges.set(base, byOverride);
	}
	const key = contentKey(over);
	let held = byOverride.get(key);
	if (held === undefined) {
		held = mergeTheme(base, over);
		byOverride.set(key, held);
	}
	return held;
};
