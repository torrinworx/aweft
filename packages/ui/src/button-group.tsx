// A run of buttons drawn as one control (design 200).
//
// The joining is the theme's, through `_children_` rules on the `buttongroup` entry. There is no
// `size` here: a class list is written by the element that wears it, so a group has no way to put
// a segment in its children's lists, and the only thing the theme could do instead is say what
// `button_sm` already says a second time. Each button carries its own `size`.

import { h } from './h.ts';

/** What `ButtonGroup` takes. Everything not named here goes to the element. */
export interface ButtonGroupProps {
	/** What the group is, read out by a screen reader. */
	readonly label?: unknown;
	/** Stack them down the page instead of across it. */
	readonly vertical?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A run of buttons drawn as one control.
 *
 * Params:
 *   props: `label`, `vertical`, `element`, and anything else, which goes to the element
 *   children: the `Button`s
 *
 * Returns: a `<div role="group">` on the `buttongroup` entry. The inner corners come off, the two
 * ends keep theirs, and each button after the first is pulled back by `$borderWidth` so two
 * adjacent borders read as one line. `vertical` says the same thing down the page.
 *
 * Give each button its own `size`. A size on the group would have to restate the size axis on the
 * group's children, which is the same numbers written in a second place.
 *
 * Example:
 *   <ButtonGroup label="Alignment">
 *     <Button label="Left" type="quiet" />
 *     <Button label="Centre" type="quiet" />
 *     <Button label="Right" type="quiet" />
 *   </ButtonGroup>
 */
export const ButtonGroup = (props: ButtonGroupProps): unknown => {
	const { label, vertical, element, theme, children, ...rest } = props;
	return h(element ?? 'div', {
		role: 'group',
		...rest,
		'aria-label': label ?? null,
		theme: ['buttongroup', vertical ? 'vertical' : null, theme],
	}, ...(children ?? []));
};
