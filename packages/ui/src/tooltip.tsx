// A label that appears beside the thing it describes (design 135).
//
// Two pieces this package already has: `Detached` places the panel and closes it when the page
// scrolls, and `tooltipTrigger` in `tooltip-trigger.ts` decides when it shows. Nothing here measures
// anything or holds a timer.

import { type ElementLike, type Mounter, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { Detached, mountedElement, runOf } from './popup.tsx';
import { SIDES } from './placement.ts';
import { assert } from './assert.ts';
import { categories, mark } from './mark.ts';
import { h } from './h.ts';
import { isWritable } from './source.ts';
import { tooltipTrigger } from './tooltip-trigger.ts';
import { isStatic, use } from './render.ts';

/** What `Tooltip` takes. Everything not named here goes to the panel. */
export interface TooltipProps {
	/** The text of the tip. A value or a cell. Replaced by a `<mark.popup>` when one is given. */
	readonly label?: unknown;
	/** Whether it is showing, a cell. Absent, the component keeps its own. */
	readonly enabled?: unknown;
	/** The placements to try, in order. The four side modes when omitted. */
	readonly locations?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A tip beside its anchor, on hover and on focus.
 *
 * Params:
 *   props: `label`, `enabled`, `locations`, `type`, and anything else, which goes to the panel
 *   children: the anchor, with an optional `<mark.popup>` holding markup instead of the label
 *
 * Returns: the anchor where it was written, and the panel at the popup sink. The panel is
 * `role="tooltip"` and every element in the anchor carries `aria-describedby` naming it.
 *
 * The pause before a hover shows it belongs to the behaviour, so every tip on a page waits the same
 * amount of time and there is no prop for it. Focus shows it at once.
 *
 * `aria-describedby` is written onto the anchor's nodes when the page comes alive, rather than built
 * into the markup, because those nodes are the caller's. A static render leaves it out, so markup a
 * page is taken over from carries the anchor and the panel with no link between them and the link
 * appears on the first live mount. It is taken off again when this unmounts.
 *
 * Throws: the asserts `Popup` makes for a missing `PopupContext`, and the one `categories` makes for
 * a slot this component does not know.
 *
 * Example:
 *   <Tooltip label="Delete this for good"><Button label="Delete" type="danger" /></Tooltip>
 */
export const Tooltip = (
	props: TooltipProps,
	cleanup: (...fns: (() => void)[]) => void,
	mounted: (...fns: (() => void)[]) => void,
): Mounter => {
	// `mounted` is only taken while the component's own body runs, and the mount context arrives
	// one step later, in the mounter. So the callback is registered here and filled in there.
	let start = (): void => undefined;
	mounted(() => { start(); });
	return (elem, _item, before, context) => {
		const { label, enabled, locations, type, theme, children, ...rest } = props;

		const [popup, anchor] = categories(children ?? [], ['popup', 'anchor'], 'anchor');
		// A state prop is a cell or absent. A plain value looks as though it was honoured and is
		// not, so it is a loud assert rather than a silent fallback, as `Validate`'s `value` was.
		assert(enabled === undefined || isWritable(enabled),
			'Tooltip enabled takes a cell, not a value; pass enabled={cell}, or leave it out and the '
			+ 'component keeps its own');
		const open = isWritable(enabled) ? enabled : mutable(false);
		const render = use(context);
		const id = render.ids.next('tip');

		const stops: (() => void)[] = [];
		// Held by this component rather than read back off the run at the end: the run empties as the
		// anchor unmounts, and the attribute would be left on an element nobody could reach.
		const described: ElementLike[] = [];

		const inside = popup!.items.length > 0 ? popup!.items : [label];

		// The panel, once it is in the document: a hydration keeps the server's element and drops the
		// one the client built, so the element the trigger asks for the top layer comes back out of
		// its own mount rather than being remembered (design 153).
		let panel: () => ElementLike | null = () => null;
		const Panel: Mounter = (parent, _item, at, inner) => {
			const put = mount(parent, h('div', {
				...rest,
				id,
				role: 'tooltip',
				theme: ['tooltip', type, theme],
			}, ...inside), at, inner);
			panel = mountedElement(put, at);
			return put;
		};

		// The end of the anchor's run, one level out from the one `Detached` makes for itself
		// (design 153). It goes in first and everything else goes in against it, so what follows
		// stays in front of it however late it arrives. `Detached` renders the anchor where it was
		// written and its panel at the sink, so the elements between the two are the anchor alone.
		const tail = mount(elem, '', before, context);
		const remove = mount(elem, h(Detached, { enabled: open, locations: locations ?? SIDES },
			...anchor!.items,
			mark('popup', null, Panel)), tail, context);

		const anchorNodes = (): ElementLike[] =>
			runOf(remove, tail).filter((node) => node.nodeType === 1) as unknown as ElementLike[];

		// The anchor is the caller's markup, so the link to the panel is written on it once it exists
		// rather than built into it. Every element in the anchor, because an anchor may be more than
		// one. Not in a static render: nothing on the client can write it before the pairing walk
		// reaches the anchor, so markup carrying it is markup that cannot be taken over (design 153).
		start = () => {
			if (!isStatic(render)) {
				for (const element of anchorNodes()) {
					element.setAttribute('aria-describedby', id);
					described.push(element);
				}
			}
			stops.push(tooltipTrigger({
				nodes: anchorNodes,
				panel: () => panel(),
				open: open as { get(): unknown; set(value: unknown): void },
			}));
		};
		cleanup(() => {
			for (const stop of stops) stop();
			stops.length = 0;
			for (const element of described) element.removeAttribute('aria-describedby');
			described.length = 0;
		});

		return (arg) => {
			if (arg !== undefined) return remove(arg);
			tail();
			return remove();
		};
	};
};
