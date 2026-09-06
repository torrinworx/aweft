// `Theme`, as a page reaches it: the provider, plus `define`.
//
// The provider and the resolution live in `theme.ts`, which `h` reaches through `wrapper.ts`.
// Hanging `define` on it here keeps that file free of the public shape and this one free of the
// resolution, so neither has to import the other.

import { type Context } from './contexts.ts';
import { type Definitions, defineTheme } from './sheet.ts';
import { Theme as provider } from './theme.ts';

/** The provider, and the one call that writes definitions. */
export interface ThemeApi extends Context<Definitions> {
	/**
	 * Add entries to the theme every render starts from.
	 *
	 * Params:
	 *   entries: entries by `_`-joined selector path. A key's segments match an element's
	 *            `theme` list with gaps allowed and order enforced, so `button_hovered` matches
	 *            an element themed `button primary hovered`
	 *
	 * Returns: nothing. Called at import time, from the module that owns the component the
	 * entries are for. Defining a key twice with a deep-equal body is a no-op.
	 *
	 * Throws: an assert, loud in development and stripped in a release build, when a key is
	 * defined twice with different bodies, and when a key has an empty segment (`a__b`, `a_`),
	 * which no element's `theme` list can ever match.
	 *
	 * Example:
	 *   Theme.define({
	 *     card: { background: '$surface', padding: 16, borderRadius: '$radius$px' },
	 *     card_hovered: { background: '$shiftBrightness($surface, -0.04)' },
	 *   });
	 */
	define(entries: Definitions): void;
}

/**
 * A partial theme for everything below, and the registry every render starts from.
 *
 * Example:
 *   Theme.define({ card: { padding: 16 } });
 *   mount(document.body, h(Theme, { value: { card: { padding: 24 } } }, h(App, {})));
 */
export const Theme: ThemeApi = Object.assign(provider, { define: defineTheme }) as ThemeApi;
