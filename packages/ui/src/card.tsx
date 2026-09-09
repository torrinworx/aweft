// A raised block, with parts in it where it was given any (designs 200, 211).
//
// Given no title, no description and no foot it is the bare block: the children inside the `card`
// entry and nothing else. The head, the body, the foot and the column that spaces them arrive
// together, and the column is the modifier `card_stack` rather than a change to `card`, so the
// bare block is the same markup a `<div theme="card">` is.

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
 * Returns: a `<div>` on the `card` entry: the surface fill, a border, the larger radius and
 * `$space4` of padding, which `tight` takes away.
 *
 * Given a `title`, a `description` or a `foot` it also takes the `stack` segment and builds the
 * parts: the title on `card_title`, the description on `card_description` in `$mutedForeground`,
 * the children in a `card_body`, and the foot as a row, with `$space4` between them. Each part
 * renders only where it was given something. Given none of the three it is the bare block and the
 * children are its own children (design 211).
 *
 * Example:
 *   <Card title="Today" description="What is due" foot={<Button label="Add" />}>
 *     <p theme="text">Nothing yet.</p>
 *   </Card>
 *
 *   <Card><h2 theme={['text', 'lg']}>Today</h2><p theme="text">Nothing yet.</p></Card>
 */
export const Card = (props: CardProps): unknown => {
	const { title, description, foot, type, tight, element, theme, children, ...rest } = props;
	const body = children ?? [];
	const titled = title !== undefined && title !== null;
	const described = description !== undefined && description !== null;
	const footed = foot !== undefined && foot !== null;
	// The parts and the column between them arrive together: a block with nothing but children has
	// nothing to space, so it is the bare block a `<div theme="card">` is (design 211).
	const parted = titled || described || footed;

	const box = {
		...rest,
		theme: ['card', type, through(tight, (held) => (held ? 'tight' : null)), parted ? 'stack' : null, theme],
	};
	if (!parted) return h(element ?? 'div', box, ...body);

	return h(element ?? 'div', box,
		titled || described
			? h('div', { theme: ['card_head'] },
				titled ? h('p', { theme: ['card_title'] }, title) : null,
				described ? h('p', { theme: ['card_description'] }, description) : null)
			: null,
		body.length === 0 ? null : h('div', { theme: ['card_body'] }, ...body),
		footed ? h('div', { theme: ['card_foot'] }, foot) : null);
};
