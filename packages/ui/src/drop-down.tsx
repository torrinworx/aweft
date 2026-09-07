// A disclosure: a button that opens what is under it, in the page's flow (design 136).
//
// A native `<details>` and its `<summary>`, which is where Space, Enter, the `button` role and the
// expanded state all come from. Nothing here writes `aria-expanded` or a key handler, because
// writing either would be writing over what the element already says.

import { type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { Icon } from './icon.tsx';
import { assert } from './assert.ts';
import { controlStates, elementFor } from './control.ts';
import { h } from './h.ts';
import { isWritable, through } from './source.ts';

/** What `DropDown` takes. Everything not named here goes to the `<details>`. */
export interface DropDownProps {
	/** Whether it is open, a cell, written by the element's `toggle`. Absent, it keeps its own. */
	readonly open?: unknown;
	/** The words on the summary. */
	readonly label?: unknown;
	/** An icon beside the label. Anything mountable. */
	readonly icon?: unknown;
	/** What shows on the chevron's side while it is open. An `Icon` `chevron-up` by default. */
	readonly iconOpen?: unknown;
	/** What shows there while it is closed. An `Icon` `chevron-down` by default. */
	readonly iconClose?: unknown;
	/** Which side the chevron goes: `right` (the default) or `left`. */
	readonly arrow?: unknown;
	/** The summary's button variant. */
	readonly type?: unknown;
	/** A value or a cell. */
	readonly disabled?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A button and the block it shows.
 *
 * Params:
 *   props: `open`, `label`, `icon`, `iconOpen`, `iconClose`, `arrow`, `type`, `disabled`,
 *          `element`, and anything else, which goes to the `<details>`
 *   children: what shows while it is open, in the page's flow
 *
 * Returns: a `<details>` with a `<summary>` wearing the `button` theme. Space and Enter toggle it,
 * a screen reader reads it as a button and says whether it is expanded, and none of that is written
 * here.
 *
 * The `open` cell goes both ways: writing it opens and closes the element, and a person opening it
 * writes the cell.
 *
 * A floating menu is not this: that is `Detached` with a `Button` anchor (design 136).
 *
 * Throws: the assert `elementFor` makes for an `element` that is not a `<details>`.
 *
 * Example:
 *   <DropDown label="Filters" open={shown}><Filters /></DropDown>
 */
export const DropDown = (props: DropDownProps): Mounter => (elem, _item, before, context) => {
	const {
		open, label, icon, iconOpen, iconClose, arrow, type, disabled, element, theme, children, ...rest
	} = props;

	// A state prop is a cell or absent. A plain value looks as though it was honoured and is not,
	// so it is a loud assert rather than a silent fallback, as `Validate`'s `value` already was.
	assert(open === undefined || isWritable(open),
		'DropDown open takes a cell, not a value; pass open={cell}, or leave it out and the '
		+ 'component keeps its own');
	const cell = isWritable(open) ? open : mutable(false);
	const states = controlStates(disabled, props);

	// One `Icon` whose `name` follows the cell, rather than two icons swapped: `Icon` keeps its
	// element for the life of the component and changes the drawing inside it (design 131), so
	// opening this touches one attribute on the details and the icon's own body. A caller who names
	// their own two gets those swapped whole, because they may not be icons at all.
	const chevron = iconOpen === undefined && iconClose === undefined
		? h(Icon, { name: through(cell, (on) => (on ? 'chevron-up' : 'chevron-down')) })
		: through(cell, (on) => (on ? iconOpen ?? null : iconClose ?? null));

	const head = arrow === 'left'
		? [chevron, icon ?? null, label ?? null]
		: [icon ?? null, label ?? null, chevron];

	const summary = h('summary', {
		theme: ['button', type, 'disclosure', 'summary', arrow === 'left' ? 'left' : null, ...states.segments],
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		// The element keeps the role and the expanded state. These two are what `disabled` means on
		// an element the platform has no `disabled` for: out of the focus order, and the theme takes
		// the pointer away.
		'aria-disabled': through(disabled, (value) => (value ? 'true' : null)),
		tabindex: through(disabled, (value) => (value ? '-1' : null)),
	}, ...head);

	const node = h(elementFor(element, 'details'), {
		...rest,
		theme: ['disclosure', type, theme],
		// The attribute is what a static render writes, so a server page shows it open; the property
		// is what a live element answers to.
		open: through(cell, (on) => (on ? '' : null)),
		$open: through(cell, (on) => Boolean(on)),
		onToggle: (event: unknown) => {
			cell.set(Boolean((event as { target?: { open?: unknown } }).target?.open));
		},
	}, summary, ...(children ?? []));

	return mount(elem, node, before, context);
};
