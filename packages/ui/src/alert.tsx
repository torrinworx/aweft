// A message about the page, on the two live-region roles the platform has for one (design 199).

import { h } from './h.ts';

/** What `Alert` takes. Everything not named here goes to the element. */
export interface AlertProps {
	/** The heading line. A value or a cell. */
	readonly title?: unknown;
	/** Something in the first column. Anything mountable; usually an `Icon`. */
	readonly icon?: unknown;
	/** The theme variant: nothing, or `danger`. */
	readonly type?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A message about the page.
 *
 * Params:
 *   props: `title`, `icon`, `type`, `element`, and anything else, which goes to the element
 *   children: the body
 *
 * Returns: a `<div>` on the `alert` entry, `role="alert"` when `type` is `danger` and
 * `role="status"` otherwise, so a message that matters interrupts a screen reader and a message
 * that does not waits its turn. The title is on `alert_title`, the body on `alert_body`, and an
 * icon on `alert_symbol` in a first column the box grows only when it was given one.
 *
 * The icon is yours. This package ships no drawings (design 144), so an `Icon` by name needs an
 * `Icons` provider above it, and there is no default icon here.
 *
 * Example:
 *   <Alert title="Saved" icon={<Icon name="check" />}>Everything went through.</Alert>
 *   <Alert type="danger" title="Nothing was saved">The server refused the write.</Alert>
 */
export const Alert = (props: AlertProps): unknown => {
	const { title, icon, type, element, theme, children, ...rest } = props;
	const led = icon !== undefined && icon !== null && icon !== false;
	const body = children ?? [];
	return h(element ?? 'div', {
		role: type === 'danger' ? 'alert' : 'status',
		...rest,
		theme: ['alert', type, led ? 'lead' : null, theme],
	},
	led ? h('span', { theme: ['alert_symbol'] }, icon) : null,
	title === undefined || title === null ? null : h('span', { theme: ['alert_title'] }, title),
	body.length === 0 ? null : h('div', { theme: ['alert_body'] }, ...body));
};
