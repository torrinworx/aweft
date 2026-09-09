// A grey box standing in for something that has not arrived (design 199).

import { h } from './h.ts';

/** What `Skeleton` takes. Everything not named here goes to the element. */
export interface SkeletonProps {
	/** How wide, as a CSS length or a number of pixels. Full width when omitted. */
	readonly width?: unknown;
	/** How tall, as a CSS length or a number of pixels. One line of body text when omitted. */
	readonly height?: unknown;
	/** A circle, for the box standing in for an avatar. */
	readonly round?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * A grey box standing in for something that has not arrived.
 *
 * Params:
 *   props: `width`, `height`, `round`, and anything else, which goes to the `<div>`
 *
 * Returns: a `<div aria-hidden="true">` on the `skeleton` entry: the `$muted` fill, pulsing inside
 * `prefers-reduced-motion: no-preference` and still outside it. `width` and `height` go through
 * `style`, so a bare number is pixels and any CSS length works.
 *
 * It says nothing to a screen reader. The thing that is loading is what announces that, and three
 * boxes announcing it three times is worse than silence.
 *
 * Example:
 *   <Skeleton width="12rem" />
 *   <Skeleton width={40} height={40} round={true} />
 */
export const Skeleton = (props: SkeletonProps): unknown => {
	const { width, height, round, theme, style, ...rest } = props;
	const own: Record<string, unknown> = { ...(style as Record<string, unknown> | undefined) };
	if (width !== undefined && width !== null) own['width'] = width;
	if (height !== undefined && height !== null) own['height'] = height;

	return h('div', {
		...rest,
		theme: ['skeleton', round ? 'round' : null, theme],
		style: own,
		'aria-hidden': 'true',
	});
};
