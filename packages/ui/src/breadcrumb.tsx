// The trail of where a page sits, one level at a time (design 201).
//
// A `<nav>` around an `<ol>`, which is what a screen reader reads as a list of levels, and a plain
// `<a href>` per level. Plain is the point: `createRouter`'s `links(root)` takes over same-origin
// anchor clicks and leaves alone any anchor with a `target`, so a breadcrumb inside a routed page
// navigates with no reload and nothing here writes a click handler.
//
// The list is mapped rather than run through `each`, because the last item is a different element
// from the ones before it and a component under `each` renders one node shape for every item.

import { type Mounter, mount } from '@aweftjs/dom';

import { elementFor } from './control.ts';
import { h } from './h.ts';
import { text } from './text.ts';
import { through } from './source.ts';

/** One level of the trail. */
export interface BreadcrumbItem {
	/** What it is called. */
	readonly label?: unknown;
	/** Where it goes. The last item never gets one, because it is where you already are. */
	readonly href?: unknown;
}

/** What `Breadcrumb` takes. Everything not named here goes to the `<nav>`. */
export interface BreadcrumbProps {
	/** The levels, outermost first: a list of `{ label, href }`, or a cell holding one. */
	readonly items?: unknown;
	/** What the nav is called. `Breadcrumb` when it is left off. */
	readonly label?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * Where a page sits, as a trail of links.
 *
 * Params:
 *   props: `items`, `label`, `element`, and anything else, which goes to the `<nav>`
 *
 * Returns: a `<nav aria-label>` holding an `<ol>`. Every item but the last is an `<a href>`; the
 * last is a `<span aria-current="page">`, because you do not link to the page you are on. A
 * `<span aria-hidden="true">` sits between them, drawn by the theme as a chevron, so no icon pack
 * is needed to render one.
 *
 * An item before the last with no `href` renders as a span too: it reads as a level with nowhere
 * to go rather than as a link that does nothing.
 *
 * Example:
 *   <Breadcrumb items={[{ label: 'Home', href: '/' }, { label: 'Files', href: '/files' },
 *     { label: 'shot.png' }]} />
 */
export const Breadcrumb = (props: BreadcrumbProps): Mounter => (elem, _item, before, context) => {
	const { items, label, element, theme, ...rest } = props;

	const trail = through(items, (held) => {
		const list = Array.isArray(held) ? held as BreadcrumbItem[] : [];
		return list.map((item, at) => {
			const last = at === list.length - 1;
			const linked = !last && item.href !== undefined && item.href !== null;
			return h('li', { theme: ['breadcrumb_item'] },
				at === 0 ? null : h('span', { theme: ['breadcrumb_separator'], 'aria-hidden': 'true' }),
				linked
					? h('a', { theme: ['breadcrumb_link'], href: item.href }, item.label)
					: h('span', {
						theme: [last ? 'breadcrumb_current' : 'breadcrumb_link'],
						'aria-current': last ? 'page' : null,
					}, item.label));
		});
	});

	const node = h(elementFor(element, 'nav'), {
		...rest,
		'aria-label': label ?? text('Breadcrumb'),
		theme: ['breadcrumb', theme],
	}, h('ol', { theme: ['breadcrumb_list'] }, trail));

	return mount(elem, node, before, context);
};
