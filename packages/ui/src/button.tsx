// A button, or a link that looks like one (design 128).
//
// One native element either way, so the keyboard, the role and the form participation are the
// platform's. What this adds is the theme, the three state segments, the pending state a promise
// puts it in, and the one analytics event a click is worth.

import { type Derived, all, mutable } from '@aweftjs/core';
import { type Mounter, mount } from '@aweftjs/dom';

import { h } from './h.ts';
import { InputContext } from './input.ts';
import { LoaderContext } from './suspend.tsx';
import { LoadingDots } from './loading-dots.tsx';
import { controlStates, elementFor } from './control.ts';
import { isWritable, through } from './source.ts';

/** What `Button` takes. Everything not named here goes to the element. */
export interface ButtonProps {
	/** The text inside it. Children work too, and both together put the label first. */
	readonly label?: unknown;
	/** The theme variant: nothing, `quiet` or `danger`. */
	readonly type?: unknown;
	/** An icon beside the label. Anything mountable; usually an `Icon`. */
	readonly icon?: unknown;
	/** Which side the icon goes: `left` (the default) or `right`. */
	readonly iconPosition?: string;
	/** A value or a cell. A disabled button fires nothing. */
	readonly disabled?: unknown;
	/** A cell, or absent. Also true while a promise `onClick` returned is still pending. */
	readonly loading?: unknown;
	/** Draw it as a circle: an icon on its own. */
	readonly round?: unknown;
	/** Drop the fill and the padding: a button that sits inside a line of text. */
	readonly inline?: unknown;
	/** Make it an `<a>` at this address instead of a `<button>`. */
	readonly href?: unknown;
	/** With an `href`, open it in a new tab. True unless it is set false. */
	readonly hrefNewTab?: unknown;
	/** Called with the event. A promise it returns drives `loading`. */
	readonly onClick?: (event: unknown) => unknown;
	/** Set false to fire no `InputContext` event for this button. */
	readonly track?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

const isPromise = (value: unknown): value is Promise<unknown> =>
	typeof (value as Promise<unknown> | null)?.then === 'function';

/**
 * A button, or a link drawn as one.
 *
 * Params:
 *   props: `label`, `type`, `icon`, `iconPosition`, `disabled`, `loading`, `round`, `inline`,
 *          `href`, `hrefNewTab`, `onClick`, `track`, `element`, and anything else, which goes to
 *          the element
 *
 * Returns: a `<button type="button">`, or an `<a>` when `href` is given. With `href` and
 * `hrefNewTab` left alone it also carries `target="_blank"` and `rel="noopener noreferrer"`,
 * because a new tab that can reach back at the page it came from is a hole nobody meant to open.
 *
 * While it is loading it is disabled and shows the `LoaderContext` loader in place of its icon, so
 * a form that would submit twice on a double click cannot.
 *
 * Fires the `InputContext` `click` event with `{ component: 'Button', label, href }`, unless
 * `track` is false.
 *
 * Example:
 *   <Button label="Save" onClick={() => save(form)} />
 *   <Button label="Docs" href="https://example.com/docs" type="quiet" />
 */
export const Button = (props: ButtonProps): Mounter => (elem, _item, before, context) => {
	const {
		label, type, icon, iconPosition, disabled, loading, round, inline,
		href, hrefNewTab, onClick, track, element, theme, children, ...rest
	} = props;

	const busy: Derived<boolean> = isWritable(loading)
		? (loading as unknown as Derived<boolean>)
		: mutable(false);
	// Disabled or loading is one cell, because the element takes one attribute and the theme takes
	// one segment.
	const off = all([disabled ?? false, busy]).map(([stopped, pending]) => Boolean(stopped) || Boolean(pending));
	const states = controlStates(off, props);

	const spinner = LoaderContext.read(context).loading ?? LoadingDots;

	const press = (event: unknown): void => {
		if (off.get()) return;
		if (track !== false) {
			InputContext.fire(context, 'click', { component: 'Button', label, href });
		}
		const answer = onClick?.(event);
		if (!isPromise(answer)) return;
		// A promise the handler returned is what says the button is busy. It is cleared however the
		// promise ends, so a save that fails does not leave a button nobody can press again;
		// reporting the rejection is the handler's own business.
		busy.set(true);
		answer.then(() => { busy.set(false); }, () => { busy.set(false); });
	};

	const linked = href !== undefined && href !== null;
	const mark = through(busy, (pending) => (pending ? h(spinner, {}) : (icon ?? null)));
	// The icon slot is first in the array whichever side it is drawn on, so the reading order for
	// a screen reader stays icon then label and only the flex order moves.
	const body = iconPosition === 'right'
		? [label ?? null, mark, ...(children ?? [])]
		: [mark, label ?? null, ...(children ?? [])];

	const shared: Record<string, unknown> = {
		...rest,
		theme: ['button', type, round ? 'round' : null, inline ? 'inline' : null, theme, ...states.segments],
		isHovered: states.isHovered,
		isClicked: states.isClicked,
		onClick: press,
	};

	const own: Record<string, unknown> = linked
		? {
			href: through(off, (stopped) => (stopped ? null : href)),
			target: hrefNewTab === false ? null : '_blank',
			rel: hrefNewTab === false ? null : 'noopener noreferrer',
			'aria-disabled': through(off, (stopped) => (stopped ? 'true' : null)),
		}
		: { type: 'button', disabled: off };

	const node = h(elementFor(element, ...(linked ? ['a', 'button'] : ['button', 'a'])), { ...shared, ...own }, ...body);
	return mount(elem, node, before, context);
};
