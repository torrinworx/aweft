// A key on the keyboard, on the element the platform has for one (design 199).

import { h } from './h.ts';

/** What `Kbd` takes. Everything not named here goes to the element. */
export interface KbdProps {
	/** The key's name. Children work too, and both together put the label first. */
	readonly label?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A key on the keyboard.
 *
 * Params:
 *   props: `label`, and anything else, which goes to the `<kbd>`
 *   children: the key's name, if it was not given as a label
 *
 * Returns: a `<kbd>` on the `kbd` entry: `$fontMono` at `$textXs` on the `$muted` fill, at least
 * `$target` wide so one letter is still something a finger could have hit.
 *
 * Example:
 *   Press <Kbd label="Esc" /> to close it.
 */
export const Kbd = (props: KbdProps): unknown => {
	const { label, theme, children, ...rest } = props;
	return h('kbd', { ...rest, theme: ['kbd', theme] }, label ?? null, ...(children ?? []));
};
