// Nothing here yet, and what to do about it (design 199).

import { h } from './h.ts';

/** What `Empty` takes. Everything not named here goes to the element. */
export interface EmptyProps {
	/** Something above the title. Anything mountable; usually an `Icon`. */
	readonly icon?: unknown;
	/** What is not here. A value or a cell. */
	readonly title?: unknown;
	/** A line under it saying more. A value or a cell. */
	readonly description?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * Nothing here yet, and what to do about it.
 *
 * Params:
 *   props: `icon`, `title`, `description`, `element`, and anything else, which goes to the element
 *   children: the action row, usually one or two `Button`s
 *
 * Returns: a `<div>` on the `empty` entry: a centred column with `$space6` of padding, holding
 * `empty_symbol`, `empty_title`, `empty_description` and `empty_actions`. Each part renders only
 * where it was given something.
 *
 * Example:
 *   <Empty icon={<Icon name="inbox" />} title="No messages" description="They will show up here.">
 *     <Button label="Refresh" onClick={reload} />
 *   </Empty>
 */
export const Empty = (props: EmptyProps): unknown => {
	const { icon, title, description, element, theme, children, ...rest } = props;
	const actions = children ?? [];
	return h(element ?? 'div', { ...rest, theme: ['empty', theme] },
		icon === undefined || icon === null ? null : h('span', { theme: ['empty_symbol'] }, icon),
		title === undefined || title === null ? null : h('p', { theme: ['empty_title'] }, title),
		description === undefined || description === null
			? null
			: h('p', { theme: ['empty_description'] }, description),
		actions.length === 0 ? null : h('div', { theme: ['empty_actions'] }, ...actions));
};
