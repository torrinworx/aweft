// Popups: where one goes in the tree, where it goes on the screen, and how it gets above
// everything without a z-index (design 113).
//
// A popup renders nothing where it is written. It pushes its element into a sink `PopupContext`
// renders after the rest of the page, and asks for the top layer with the `popover` attribute
// where the host has one. There is no z-index in this file, or anywhere in this package.

import { type MutableArray, mutable, mutableArray } from '@aweftjs/core';
import {
	type ElementLike, type Mounter, type NodeLike, type ParentLike, type Remove,
	createElement, getFirst, mount,
} from '@aweftjs/dom';

import { assert } from './assert.ts';
import { dismiss } from './dismiss.ts';
import { h } from './h.ts';
import { categories } from './mark.ts';
import { type Placed, type Placement, type Rect, CORNERS, place } from './placement.ts';
import { type Registry, createRegistry } from './registry.ts';
import { slotOf, use, withSlot } from './render.ts';
import { isSource } from './source.ts';

// --- reaching children a component does not own ---------------------------------------------

/**
 * Mount children into a target that only records them.
 *
 * Params:
 *   nothing
 *
 * Returns: the array the real nodes appear in, and a mounter to render where the children
 * belong. The caller renders the mounter and then the array, so the nodes still land in the
 * document and the caller also has them, which is what measuring or listening on children you
 * did not build needs.
 *
 * Example:
 *   const [nodes, virtual] = trackedMount();
 *   return [h(virtual, {}, ...props.children), nodes];
 */
export const trackedMount = (): [MutableArray<NodeLike>, (props: { children?: unknown[] }) => unknown] => {
	const nodes = mutableArray<NodeLike>();

	const target: ParentLike = {
		insertBefore: (node, before) => {
			const at = before === null ? nodes.length : nodes.indexOf(before);
			nodes.splice(at < 0 ? nodes.length : at, 0, node);
			return node;
		},
		removeChild: (node) => {
			const at = nodes.indexOf(node);
			if (at >= 0) nodes.splice(at, 1);
			return node;
		},
		replaceChild: (node, old) => {
			const at = nodes.indexOf(old);
			if (at >= 0) nodes.splice(at, 1, node);
			return old;
		},
	};

	// No anchor from outside. The anchor a mounter is handed names a node in the real document,
	// and handing it to this target would have the children line themselves up against a node that
	// is not in it, which puts them in the wrong order.
	const virtual = (props: { children?: unknown[] }): Mounter => (_elem, _item, _before, context) =>
		mount(target, props.children ?? [], undefined, context);

	return [nodes, virtual];
};

/**
 * The nodes one mount put in its element: from its first node up to the node that ends its run.
 *
 * A mount answers `getFirst` with its own first node, or with the anchor it was given when it made
 * none, so a mount that rendered nothing gives an empty run rather than an unbounded one.
 */
export const runOf = (from: Remove, to: Remove): NodeLike[] => {
	const end = to(getFirst) ?? null;
	const found: NodeLike[] = [];
	for (let node = from(getFirst) ?? null; node !== null && node !== end; node = node.nextSibling) {
		found.push(node);
	}
	return found;
};

/**
 * The element one mount put in the document, worked out on first use and then kept.
 *
 * Not when the mount returns: a component's body is queued, so a mount of one has no node yet at
 * that point. Under a hydration the answer is the server's element and not the one this package
 * built, which is why it is asked for at all (designs 133, 153).
 */
export const mountedElement = (from: Remove, to: Remove): (() => ElementLike | null) => {
	let found: ElementLike | null = null;
	return () => {
		if (found === null) {
			found = (runOf(from, to).find((node) => node.nodeType === 1) as ElementLike | undefined) ?? null;
		}
		return found;
	};
};

// --- the sink ---------------------------------------------------------------------------------

const SINK: unique symbol = Symbol('aweft.ui.popups');

/**
 * Where every popup below mounts.
 *
 * Renders its children, then the popups, so a popup is after the page in DOM order. Together with
 * the `popover` attribute that is the whole of the stacking story: no z-index anywhere.
 *
 * Params:
 *   popups: a registry to share with something else. Omitted, this render's own is used by the
 *           first `PopupContext` to ask for it and a fresh one by every later one
 *   children: the page
 *
 * Example:
 *   mount(document.body, h(PopupContext, {}, h(App, {})));
 */
export const PopupContext = (props: { popups?: Registry; children?: unknown[] }): Mounter =>
	(elem, _item, before, context) => {
		// The first one takes the render's own sink, so a page with one `PopupContext` has its
		// popups where the render object says. Every one after gets its own, whether it is nested
		// or a sibling, because two providers rendering one list would mount every popup twice.
		const own = use(context).popups;
		const sink = props.popups ?? (own.claim() ? own : createRegistry());
		const inner = withSlot(context, SINK, sink);

		// Two mounts, not one, so this can take the popups down before the page. A popup drops
		// itself out of the sink as it unmounts, and that reaches the list on the next delivery: if
		// the list were still live by then, it would try to take nodes out of a tree that had
		// already gone.
		//
		// The page mounts first, and both mount against the same anchor, so the popups land after
		// it. Mounting the popups first put them first in the order the mounts run and last in the
		// order they appear, and a hydration hands out the server's marker regions in the order
		// the mounts ask for them: the sink took the region belonging to the first popup written
		// beside the page, and the page's popup then found none left.
		//
		// The page ends at a node of its own rather than at this component's anchor, so something it
		// renders long after the first mount still lands in front of the popups. Sharing the anchor
		// put it after them, and the sink's list then took it for one of its own when a popup left,
		// which is how opening one act over another that held a popup rendered nothing at all.
		let tail: Remove | null = null;
		const end: Remove = (arg) => (arg === getFirst ? (tail ?? before)(getFirst) : undefined);
		const page = mount(elem, props.children ?? [], end, inner);
		const popups = mount(elem, sink.items, before, inner);
		// `''` renders to no characters, so no markup carries it, and a hydration inserts it rather
		// than pairing it (design 146). Against the popups' mount, which is what puts it directly
		// after the page in a mount, a static render and a hydration alike.
		tail = mount(elem, '', popups, inner);

		return (arg) => {
			if (arg !== undefined) return page(arg);
			popups();
			tail!();
			page();
			return undefined;
		};
	};

// --- the popup itself ---------------------------------------------------------------------------

/** Where a popup sits, as `Popup` takes it. `null` hides it. */
export type PopupPlacement = Placed | null;

interface Popoverish {
	togglePopover?(force: boolean): boolean;
	readonly isConnected?: boolean;
}

const supportsPopover = (element: unknown): boolean =>
	typeof (element as Popoverish).togglePopover === 'function';

const boxOf = (at: Placed): Record<string, unknown> => ({
	position: 'fixed',
	left: at.left,
	top: at.top,
	maxWidth: at.maxWidth,
	maxHeight: at.maxHeight,
	transformOrigin: at.transformOrigin,
	margin: 0,
});

/**
 * A floating box, rendered at the popup sink rather than where it is written.
 *
 * Params:
 *   placement: where it goes, a cell so it can move; `null` hides it
 *   canClose: given the event, whether an outside click should close it. Omitted, any outside
 *             click closes it by setting `placement` to null
 *   style: merged onto the popup's own box
 *   children: what is inside
 *
 * Returns: nothing where it is written. The element is in the sink until this unmounts.
 *
 * Throws: an assert, loud in development and stripped in a release build, when there is no
 * `PopupContext` above it, naming what to wrap the page in.
 *
 * Example:
 *   <Popup placement={where}><Menu /></Popup>
 */
export const Popup = (props: {
	placement?: unknown;
	canClose?: (event: unknown) => boolean;
	style?: Record<string, unknown>;
	ref?: (element: unknown) => void;
	children?: unknown[];
}): Mounter => (_elem, _item, _before, context) => {
	const sink = (slotOf(context, SINK) as Registry | undefined) ?? null;
	assert(sink !== null, 'a Popup needs a PopupContext above it; wrap the page in h(PopupContext, {}, app)');
	if (sink === null) return () => undefined;

	const held = props.placement;
	const at = (): PopupPlacement => (isSource(held) ? held.get() : held) as PopupPlacement;

	const element = createElement('div');
	const style = mutable<Record<string, unknown>>({ display: 'none' });
	// Handed to `dom` rather than written here, as design 133 says everything on an element is. A
	// host with no Popover API writes no attribute, so markup from one and a browser that has it
	// disagree, and a reactive attribute is the one kind a pairing walk tolerates that from.
	const popover = mutable<string | null>(supportsPopover(element) ? 'manual' : null);
	const node = h(element, { style, popover }, ...(props.children ?? []));

	// The box on the page, which under a hydration is the server's element and not this one: `dom`
	// keeps the server's node and drops the fresh one, so a component that drives an element reads
	// it back out of the mount rather than remembering what it made (designs 133, 153).
	let live: () => ElementLike | null = () => null;
	let reported: ElementLike | null = null;
	const box = (): ElementLike => {
		const found = live();
		if (found !== null && found !== reported) {
			reported = found;
			props.ref?.(found);
		}
		return found ?? element;
	};
	const item: Mounter = (parent, _item, at, inner) => {
		const remove = mount(parent, node, at, inner);
		live = mountedElement(remove, at);
		return remove;
	};
	props.ref?.(element);

	// The top layer, asked for on the element rather than won with a number. It can only be asked
	// for once the element is in the document, and a popup that is already open when it mounts is
	// asked before the sink has put it there, so this waits for the frame that does.
	const toggle = (open: boolean): void => {
		const target = box() as unknown as Popoverish;
		if (typeof target.togglePopover !== 'function') return;
		if (target.isConnected === false) {
			const request = (globalThis as { requestAnimationFrame?: (fn: () => void) => number }).requestAnimationFrame;
			if (request !== undefined) request(() => { toggle(at() !== null); });
			return;
		}
		target.togglePopover(open);
	};

	const apply = (): void => {
		const where = at();
		if (where === null || where === undefined) {
			style.set({ display: 'none' });
			toggle(false);
			return;
		}
		style.set({ ...boxOf(where), ...(props.style ?? {}) });
		toggle(true);
	};

	const stops: (() => void)[] = [];
	if (isSource(held)) stops.push(held.effect(() => apply()));
	else apply();

	// Closing on an outside click is the dismiss behaviour (design 129), asked for its mousedown
	// half only: a `Popup` is a box somebody put on the screen, and swallowing an Escape the page
	// wanted is not this component's to do. It is a no-op with no page, so a static render and the
	// light tree install nothing.
	if (isSource(held)) {
		stops.push(dismiss({
			inside: () => [box()],
			active: () => at() !== null,
			canClose: props.canClose,
			onDismiss: () => { held.set?.(null); },
		}));
	}

	const drop = sink.add(item);
	return (arg) => {
		// Asked for its first node rather than told to go: it has none here, because it renders
		// nothing where it was written. Answering without checking would unmount it every time
		// something upstream worked out an anchor.
		if (arg !== undefined) return null;
		for (const stop of stops) stop();
		drop();
		return undefined;
	};
};

// --- the anchored popup ----------------------------------------------------------------------

interface Measurable {
	getBoundingClientRect?(): Rect;
}

const measure = (nodes: readonly NodeLike[]): Rect | null => {
	let box: { left: number; top: number; right: number; bottom: number } | null = null;
	for (const node of nodes) {
		const rect = (node as unknown as Measurable).getBoundingClientRect?.();
		if (rect === undefined) continue;
		const next = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
		box = box === null ? next : {
			left: Math.min(box.left, next.left), top: Math.min(box.top, next.top),
			right: Math.max(box.right, next.right), bottom: Math.max(box.bottom, next.bottom),
		};
	}
	return box === null ? null : { left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top };
};

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
	a !== null && b !== null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/**
 * A popup placed next to its own children.
 *
 * Params:
 *   enabled: the open state, a cell. Setting it false closes the popup, and so does scrolling
 *   locations: the placements to consider, in order of preference. Omitted, the eight corner
 *              modes
 *   onResize: called when the anchor changes size and the popup is re-placed
 *   style: merged onto the popup's box
 *   children: the anchor, with `<mark.popup>` for what floats
 *
 * Returns: the anchor where it was written, and the popup at the sink. The anchor is an ordinary
 * mount, so a page taken over from a server adopts the nodes the server sent (design 153).
 *
 * Throws: the asserts `Popup` makes, and the one `categories` makes for a slot it does not know.
 *
 * Example:
 *   <Detached enabled={open}>
 *     <button onClick={() => open.set(!open.get())}>menu</button>
 *     <mark.popup><Menu /></mark.popup>
 *   </Detached>
 */
export const Detached = (props: {
	enabled?: unknown;
	locations?: readonly Placement[];
	onResize?: (rect: Rect) => void;
	style?: Record<string, unknown>;
	children?: unknown[];
}, cleanup: (...fns: (() => void)[]) => void): unknown => {
	const [popup, anchor] = categories(props.children ?? [], ['popup', 'anchor'], 'anchor');
	const open = props.enabled;
	const placement = mutable<PopupPlacement>(null);

	// The anchor's nodes, read from the document rather than recorded as they mount, so an anchor
	// that changes is measured as it is now. The mounter below fills this in, and only a frame ever
	// asks, so nothing reads it before there is something to read.
	let nodes: () => readonly NodeLike[] = () => [];

	let floating: Measurable | null = null;
	let frame: number | null = null;
	let last: Rect | null = null;
	// Hidden rather than gone, for the one frame between opening and knowing where to put it: a
	// popup that is not laid out has no size, and a popup with no size cannot be placed.
	const hidden = mutable<string | null>(null);

	const view = (): { width: number; height: number } => {
		const win = globalThis as { innerWidth?: number; innerHeight?: number };
		return { width: win.innerWidth ?? 0, height: win.innerHeight ?? 0 };
	};

	const sizeOf = (): { width: number; height: number } => {
		const rect = floating?.getBoundingClientRect?.();
		return rect === undefined ? { width: 0, height: 0 } : { width: rect.width, height: rect.height };
	};

	const stop = (): void => {
		const cancel = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame;
		if (frame !== null && cancel !== undefined) cancel(frame);
		frame = null;
		last = null;
	};

	const schedule = (): void => {
		const request = (globalThis as { requestAnimationFrame?: (fn: () => void) => number }).requestAnimationFrame;
		if (request === undefined) return;
		frame = request(step);
	};

	const step = (): void => {
		const rect = measure(nodes());
		if (rect === null) return;
		if (last !== null && !sameRect(last, rect)) {
			if (last.width === rect.width && last.height === rect.height) {
				// The anchor moved without changing size, so the page scrolled, and a popup whose
				// anchor has moved has usually had its moment.
				if (isSource(open)) open.set?.(false);
				placement.set(null);
				stop();
				return;
			}
			// A handler the page wrote is not the placement loop's to die on. Reported where a
			// rejected loader is reported (design 112), and the next frame is still asked for.
			try {
				props.onResize?.(rect);
			} catch (error) {
				queueMicrotask(() => { throw error; });
			}
		}
		last = rect;
		placement.set(place(rect, sizeOf(), view(), props.locations ?? CORNERS));
		hidden.set(null);
		schedule();
	};

	const track = (on: unknown): void => {
		if (!on) {
			stop();
			hidden.set(null);
			placement.set(null);
			return;
		}
		last = null;
		// One frame laid out and out of sight, so the next one has a size to work with.
		hidden.set('hidden');
		const room = view();
		placement.set({
			mode: 'below-start', left: 0, top: 0,
			maxWidth: room.width, maxHeight: room.height, transformOrigin: 'top left',
		});
		schedule();
	};

	if (isSource(open)) cleanup(open.effect(track));
	else track(open);
	cleanup(stop);

	const mounter: Mounter = (elem, _item, before, context) => {
		let tail: Remove | null = null;
		// The anchor goes in against the node below rather than against this component's own anchor,
		// so an anchor that renders nothing answers with that node and its run is empty.
		const end: Remove = (arg) => (arg === getFirst ? (tail ?? before)(getFirst) : undefined);

		const items = mount(elem, anchor!.items, end, context);
		const floater = mount(elem, h(Popup, {
			placement,
			style: { visibility: hidden, ...props.style },
			ref: (element: unknown) => { floating = element as Measurable; },
			...popup!.props,
		}, ...popup!.items), before, context);
		// What ends the anchor's run. Stopping at this component's own anchor would be wrong: the
		// popup sink mounts into the same element as the page, so a `Detached` written last has the
		// popup it is placing as its next sibling. `''` renders to no characters, so it is in no
		// markup, and a hydration inserts it rather than pairing it (design 146). Against the popup's
		// mount, because that is what puts it directly after the anchor in all three modes.
		tail = mount(elem, '', floater, context);

		nodes = () => runOf(items, tail!);

		return (arg) => {
			if (arg !== undefined) return items(arg);
			floater();
			tail!();
			items();
			return undefined;
		};
	};
	return mounter;
};
