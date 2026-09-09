// A raised block: the `card` entry as a component.

import { h } from './h.ts';
import { through } from './source.ts';

/** What `Paper` takes. Everything not named here goes to the element. */
export interface PaperProps {
	/** The theme variant. */
	readonly type?: unknown;
	/** Drop the padding, for a block whose children own their own edges. A value or a cell. */
	readonly tight?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A raised block.
 *
 * Params:
 *   props: `type`, `tight`, `element`, and anything else, which goes to the element
 *
 * Returns: a `<div>` on the `card` entry: the surface fill, a border, the larger radius and
 * `$space4` of padding, which `tight` takes away.
 *
 * Example:
 *   <Paper><h2>Today</h2><p>Nothing yet.</p></Paper>
 */
export const Paper = (props: PaperProps): unknown => {
	const { type, tight, element, theme, children, ...rest } = props;
	return h(element ?? 'div', {
		...rest,
		theme: ['card', type, through(tight, (held) => (held ? 'tight' : null)), theme],
	}, ...(children ?? []));
};
