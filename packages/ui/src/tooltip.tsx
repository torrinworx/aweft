// A label that appears beside the thing it describes (design 135).
//
// Two pieces this package already has: `Detached` places the panel and closes it when the page
// scrolls, and `tooltipTrigger` in `tooltip-trigger.ts` decides when it shows. Nothing here measures
// anything or holds a timer.

import { type ElementLike, type Mounter, createElement, mount } from '@aweftjs/dom';
import { mutable } from '@aweftjs/core';

import { Detached, trackedMount } from './popup.tsx';
import { SIDES } from './placement.ts';
import { assert } from './assert.ts';
import { categories, mark } from './mark.ts';
import { h } from './h.ts';
import { isWritable } from './source.ts';
import { tooltipTrigger } from './tooltip-trigger.ts';
import { use } from './render.ts';

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
 * `aria-describedby` is written onto the anchor's nodes when this mounts, rather than built into the
 * markup, because those nodes are the caller's. A static render mounts too, so the attribute is in
 * the server's markup as well. It is taken off again when this unmounts.
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
		const id = use(context).ids.next('tip');

		const [nodes, virtual] = trackedMount();
		const panel = createElement('div') as ElementLike;

		const stops: (() => void)[] = [];
		// Held by this component rather than read back off `nodes` at the end: the array empties as
		// the anchor unmounts, and the attribute would be left on an element nobody could reach.
		const described: ElementLike[] = [];

		// The anchor is the caller's markup, so the link to the panel is written on it once it exists
		// rather than built into it. Every element in the anchor, because an anchor may be more than
		// one. This runs at mount, which a static render also does, so it is in that markup too.
		start = () => {
			for (const node of nodes) {
				if (node.nodeType !== 1) continue;
				const element = node as unknown as ElementLike;
				element.setAttribute('aria-describedby', id);
				described.push(element);
			}
			stops.push(tooltipTrigger({
				nodes: () => [...nodes],
				panel: () => panel,
				open: open as { get(): unknown; set(value: unknown): void },
			}));
		};
		cleanup(() => {
			for (const stop of stops) stop();
			stops.length = 0;
			for (const element of described) element.removeAttribute('aria-describedby');
			described.length = 0;
		});

		const inside = popup!.items.length > 0 ? popup!.items : [label];

		const item = [
			// Mounted into the recorder, so the anchor's real nodes are in hand; `Detached` is what puts
			// them in the document, as its own anchor.
			h(virtual, {}, ...anchor!.items),
			h(Detached, { enabled: open, locations: locations ?? SIDES },
				nodes,
				mark('popup', null, h(panel, {
					...rest,
					id,
					role: 'tooltip',
					theme: ['tooltip', type, theme],
				}, ...inside))),
		];

		return mount(elem, item, before, context);
	};
};
