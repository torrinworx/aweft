// A picture of a person, and the letters shown while it is not there (design 199).
//
// Both children stay in the tree and one of them carries `hidden`, so the image is loading while
// the fallback shows and a screen reader is never handed both.

import { mutable } from '@aweftjs/core';

import { h } from './h.ts';
import { sizeSegments } from './control.ts';
import { through } from './source.ts';

/** What `Avatar` takes. Everything not named here goes to the outer `<span>`. */
export interface AvatarProps {
	/** Where the picture is. Nothing, or a name nothing answers, leaves the fallback showing. */
	readonly src?: unknown;
	/** What the picture is of, for a screen reader. */
	readonly alt?: unknown;
	/** What to show until the picture arrives, and again if it never does. Usually initials. */
	readonly fallback?: unknown;
	/** How big it is: `sm`, `lg`, or nothing. A value or a cell. */
	readonly size?: unknown;
	/** A circle. True unless it is set false, which gives the `$radius` corner instead. */
	readonly round?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

const empty = (value: unknown): boolean =>
	value === undefined || value === null || value === false || value === '';

/**
 * A picture of a person.
 *
 * Params:
 *   props: `src`, `alt`, `fallback`, `size`, `round`, and anything else, which goes to the
 *          outer `<span>`
 *
 * Returns: a `<span>` on the `avatar` entry holding an `<img>` on `avatar_image` and a `<span>` on
 * `avatar_fallback`. The fallback shows until the image fires `load` and shows again if it fires
 * `error`; with no `src` there is no image at all and the fallback is what renders. Whichever of
 * the two is not showing carries `hidden`, so it is out of the accessibility tree as well as off
 * the screen.
 *
 * `size` is `sm` (`$controlSm`), nothing (`$control`) or `lg` (`$controlLg`), the same axis every
 * control has.
 *
 * Example:
 *   <Avatar src={person.photo} alt={person.name} fallback="TL" />
 *   <Avatar fallback="AB" size="sm" round={false} />
 */
export const Avatar = (props: AvatarProps): unknown => {
	const { src, alt, fallback, size, round, theme, ...rest } = props;

	// False until the picture is on the screen, and back to false if it fails after it was. The two
	// events are the only thing that writes it, so an avatar whose `src` never resolves keeps its
	// letters rather than showing an empty box.
	const shown = mutable(false);

	const picture = empty(src) ? null : h('img', {
		theme: ['avatar_image'],
		src,
		alt: alt ?? '',
		hidden: through(shown, (on) => (on ? null : 'true')),
		onLoad: () => { shown.set(true); },
		onError: () => { shown.set(false); },
	});

	return h('span', {
		...rest,
		theme: ['avatar', sizeSegments(size), round === false ? null : 'round', theme],
	},
	picture,
	// No `aria-hidden` on it: while it is showing it is the only thing there is to read, and while
	// the picture is showing `hidden` has already taken it out of the tree.
	h('span', {
		theme: ['avatar_fallback'],
		hidden: through(shown, (on) => (on ? 'true' : null)),
	}, fallback ?? null));
};
