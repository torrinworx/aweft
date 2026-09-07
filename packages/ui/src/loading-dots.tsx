// Three dots that pulse: what the `LoaderContext` shows when nothing else was named.
//
// The motion is declared only inside `prefers-reduced-motion: no-preference` (design 118), so a
// person who asked for less motion gets three still dots and no rule to override.

import { h } from './h.ts';

/** What `LoadingDots` takes. Everything not named here goes to the element. */
export interface LoadingDotsProps {
	/** The theme variant. */
	readonly type?: unknown;
	/** How big one dot is. A CSS length; `$dotSize` when omitted. */
	readonly size?: unknown;
	/** What it is waiting for, read out by a screen reader. Without one it is hidden from
	 * assistive technology, because a spinner beside a message that already says "loading" is
	 * read out twice. */
	readonly label?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * Three pulsing dots.
 *
 * Params:
 *   props: `type`, `size`, `label`, and anything else, which goes to the `<span>`
 *
 * Returns: a `<span>` holding three more. With a `label` it is a polite live region carrying that
 * text; without one it is `aria-hidden`.
 *
 * Example:
 *   <LoaderContext value={{ loading: LoadingDots }}><App /></LoaderContext>
 */
export const LoadingDots = (props: LoadingDotsProps): unknown => {
	const { type, size, label, theme, ...rest } = props;
	const named = label !== undefined && label !== null && label !== '';
	const style = size === undefined || size === null ? null : { width: size, height: size };
	return h('span', {
		...rest,
		theme: ['dots', type, theme],
		role: named ? 'status' : null,
		'aria-label': named ? label : null,
		'aria-hidden': named ? null : 'true',
	},
	h('span', { theme: ['dot'], style }),
	h('span', { theme: ['dot', 'second'], style }),
	h('span', { theme: ['dot', 'third'], style }));
};
