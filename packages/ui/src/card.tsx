// A raised block with parts in it (design 200).
//
// `Paper` is still the bare block on the same `card` entry. What this adds is the head, the body
// and the foot, and the column that spaces them, which is the modifier `card_stack` rather than a
// change to `card`: a `Paper` renders exactly what it rendered before this component existed.

import { h } from './h.ts';
import { through } from './source.ts';

/** What `Card` takes. Everything not named here goes to the element. */
export interface CardProps {
	/** The heading. A value or a cell. */
	readonly title?: unknown;
	/** A line under the heading. A value or a cell. */
	readonly description?: unknown;
	/** The row along the bottom, usually buttons. Anything mountable. */
	readonly foot?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Drop the padding, for a card whose children own their own edges. A value or a cell. */
	readonly tight?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A raised block with a heading, a body and a foot.
 *
 * Params:
 *   props: `title`, `description`, `foot`, `type`, `tight`, `element`, and anything else, which
 *          goes to the element
 *   children: the body
 *
 * Returns: a `<div>` on the `card` entry with the `stack` segment: the surface fill, a border, the
 * larger radius, and `$space4` between the head, the body and the foot. The title is on
 * `card_title`, the description on `card_description` in `$mutedForeground`, and the foot is a
 * row. Each part renders only where it was given something.
 *
 * `Paper` is the same block with nothing in it.
 *
 * Example:
 *   <Card title="Today" description="What is due" foot={<Button label="Add" />}>
 *     <p theme="text">Nothing yet.</p>
 *   </Card>
 */
export const Card = (props: CardProps): unknown => {
	const { title, description, foot, type, tight, element, theme, children, ...rest } = props;
	const body = children ?? [];
	const titled = title !== undefined && title !== null;
	const described = description !== undefined && description !== null;

	return h(element ?? 'div', {
		...rest,
		theme: ['card', type, through(tight, (held) => (held ? 'tight' : null)), 'stack', theme],
	},
	titled || described
		? h('div', { theme: ['card_head'] },
			titled ? h('p', { theme: ['card_title'] }, title) : null,
			described ? h('p', { theme: ['card_description'] }, description) : null)
		: null,
	body.length === 0 ? null : h('div', { theme: ['card_body'] }, ...body),
	foot === undefined || foot === null ? null : h('div', { theme: ['card_foot'] }, foot));
};
