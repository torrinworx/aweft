// A short label on a fill: a count, a state, a tag (design 199).
//
// One `<span>` and nothing else. It answers to nothing, so there is no handler, no `disabled` and
// no `href` here: a badge somebody presses is a small `Button`.

import { h } from './h.ts';
import { sizeSegments } from './control.ts';

/** What `Badge` takes. Everything not named here goes to the element. */
export interface BadgeProps {
	/** The text inside it. Children work too, and both together put the label first. */
	readonly label?: unknown;
	/** The theme variant: nothing, `quiet`, `danger`, `success` or `outline`. */
	readonly type?: unknown;
	/** How big it is: `sm`, `lg`, or nothing. A value or a cell. */
	readonly size?: unknown;
	/** Something before the label. Anything mountable; usually an `Icon`. */
	readonly icon?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A short label on a fill.
 *
 * Params:
 *   props: `label`, `type`, `size`, `icon`, `element`, and anything else, which goes to the
 *          element
 *
 * Returns: a `<span>` on the `badge` entry: the accent fill at `$textXs`, or the `quiet`, `danger`,
 * `success` and `outline` variants of it. Its size axis is padding and text rather than a control
 * height, because a badge is not a control and a row of 36px blocks is not what a caller asked for.
 *
 * It is never interactive. A badge somebody presses is a `Button` with `size="sm"`.
 *
 * Example:
 *   <Badge label="New" />
 *   <Badge label="3 failed" type="danger" size="sm" />
 */
export const Badge = (props: BadgeProps): unknown => {
	const { label, type, size, icon, element, theme, children, ...rest } = props;
	return h(element ?? 'span', {
		...rest,
		theme: ['badge', type, sizeSegments(size), theme],
	}, icon ?? null, label ?? null, ...(children ?? []));
};
