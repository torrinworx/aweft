// The theme in effect where an element sits.
//
// `Theme` is a context whose value is a partial theme merged onto whatever is above it, so a
// page can put two themes side by side and each subtree generates its own classes. Definitions
// themselves are static (design 111); this is only about which of them apply where.

import { type Definitions, contentKey, mergeTheme } from './sheet.ts';
import { createContext } from './contexts.ts';
import { use } from './render.ts';

// One shared empty object, so the no-provider case is an identity test rather than a merge.
const NONE: Definitions = {};

/**
 * A partial theme for everything below it.
 *
 * Params:
 *   value: entries by `_`-joined selector path, merged onto the theme above
 *   children: the subtree the merged theme applies to
 *
 * Example:
 *   <Theme value={{ button: { background: 'rebeccapurple' } }}>
 *     <Button label="Go" />
 *   </Theme>
 */
export const Theme = createContext<Definitions>(NONE, (raw, parent) =>
	(raw === null || raw === undefined ? parent : mergeTheme(parent, raw as Definitions)));

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
