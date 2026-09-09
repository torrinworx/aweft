// How far along something is, on the platform's own progress element (design 199).
//
// The value is written as the attribute rather than as the `$value` property `Slider` writes.
// Nobody types into a `<progress>`, so there is no starting value to distinguish from a current
// one, and the property cannot say indeterminate: its setter writes the content attribute, so no
// value it takes unsets one. An attribute following a cell is removed when the cell answers null,
// and a `<progress>` with no `value` attribute is what indeterminate means.

import { h } from './h.ts';
import { elementFor, sizeSegments } from './control.ts';
import { through } from './source.ts';

/** What `Progress` takes. Everything not named here goes to the element. */
export interface ProgressProps {
	/** How far along, from 0 to 1, clamped to it. A value or a cell; anything that is not a finite
	 * number is indeterminate. */
	readonly value?: unknown;
	/** What is going on, read out by a screen reader. */
	readonly label?: unknown;
	/** How thick it is: `sm`, `lg`, or nothing. A value or a cell. */
	readonly size?: unknown;
	/** Decorate this `<progress>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * How far along something is.
 *
 * Params:
 *   props: `value`, `label`, `size`, `element`, and anything else, which goes to the `<progress>`
 *
 * Returns: a `<progress max="1">` on the `progress` entry: a `$muted` track and an `$accent` bar,
 * `$space2` thick. `value` is a fraction of 1, so nothing has to divide; `null` or nothing leaves
 * the attribute off, which is what the platform reads as indeterminate and draws as the moving
 * bar.
 *
 * A number outside 0 to 1 is clamped to it, and anything that is not a finite number, `NaN` and a
 * string included, is indeterminate.
 *
 * Throws: an assert, loud in development and stripped in a release build, when `element` is
 * anything but a `<progress>`.
 *
 * Example:
 *   <Progress value={done} label="Uploading" />
 *   <Progress label="Working" />
 */
export const Progress = (props: ProgressProps): unknown => {
	const { value, label, size, element, theme, ...rest } = props;
	return h(elementFor(element, 'progress'), {
		...rest,
		theme: ['progress', sizeSegments(size), theme],
		max: 1,
		// Clamped, and anything that is not a finite number is indeterminate. The attribute is what
		// the element reads, and one holding `1.5`, `-0.2` or `lots` is a bar drawn past its own
		// track on one host and drawn as nothing on the next.
		value: through(value, (held) => (typeof held === 'number' && Number.isFinite(held)
			? String(Math.min(1, Math.max(0, held)))
			: null)),
		'aria-label': label ?? null,
	});
};
