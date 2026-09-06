// The two modes, as themes a page swaps at its root (design 117).
//
// Each is a partial theme holding the thirty-six scale steps and the seventeen roles of one mode
// and nothing else. `Theme` already merges a partial theme onto whatever is above it and already
// gives its subtree its own generated classes, so swapping the page is one provider and nesting
// one mode inside the other works with no further mechanism.

import { type Definitions } from './sheet.ts';
import { darkRoles, lightRoles } from './roles.ts';
import { darkScale, lightScale } from './scales.ts';

/**
 * The light mode: the values the default theme already starts from.
 *
 * It exists so a light island can sit inside a dark page, which is the same need read the other
 * way round. A page that is light throughout needs no provider at all.
 *
 * Example:
 *   <Theme value={dark}><App><Theme value={light}><Preview /></Theme></App></Theme>
 */
export const light: Definitions = { '*': { ...lightScale, ...lightRoles } };

/**
 * The dark mode.
 *
 * Params: none. It is data, handed to the `Theme` provider.
 *
 * Returns: a partial theme redefining every scale step and every role. Everything else, the type
 * scale, the sizes, the motion, the component entries, is shared with the light mode.
 *
 * Example:
 *   mount(document.body, <Theme value={dark}><App /></Theme>);
 *
 *   // following the operating system is the application's call, in its own theme:
 *   Theme.define({ '*': { '_media_(prefers-color-scheme: dark)': { colorScheme: 'dark' } } });
 */
export const dark: Definitions = { '*': { ...darkScale, ...darkRoles } };
