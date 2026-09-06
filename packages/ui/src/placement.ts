// Where a floating box goes next to an anchor (design 113).
//
// A pure function of four numbers and a size, so the geometry is tested exhaustively with no
// browser. Measuring the anchor, and putting the answer on an element, are the browser's half
// and live in `popup.tsx`.

/** A box on the screen, in the coordinates `getBoundingClientRect` uses. */
export interface Rect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

/** How big the floating box wants to be. */
export interface Size {
	readonly width: number;
	readonly height: number;
}

/**
 * The twelve places a popup can go.
 *
 * The eight corner modes put one of the popup's corners on one of the anchor's, so the popup
 * hangs off a corner: `below-start` is under the anchor with their left edges lined up.
 * The four side modes centre the popup on one edge of the anchor.
 */
export type Placement =
	| 'below-start' | 'below-end' | 'above-start' | 'above-end'
	| 'right-start' | 'right-end' | 'left-start' | 'left-end'
	| 'below' | 'above' | 'right' | 'left';

/** The eight corner modes, which is what `Detached` tries when nothing else is asked for. */
export const CORNERS: readonly Placement[] =
	['below-start', 'below-end', 'above-start', 'above-end', 'right-start', 'right-end', 'left-start', 'left-end'];

/** The four side modes. */
export const SIDES: readonly Placement[] = ['below', 'above', 'right', 'left'];

/** Every mode, corners first. */
export const PLACEMENTS: readonly Placement[] = [...CORNERS, ...SIDES];

const isSide = (mode: Placement): boolean => (SIDES as readonly string[]).includes(mode);

/** Where the popup's top-left corner would be for one mode. */
const cornerFor = (mode: Placement, anchor: Rect, popup: Size): { left: number; top: number } => {
	const right = anchor.left + anchor.width;
	const bottom = anchor.top + anchor.height;
	switch (mode) {
		case 'below-start': return { left: anchor.left, top: bottom };
		case 'below-end': return { left: right - popup.width, top: bottom };
		case 'above-start': return { left: anchor.left, top: anchor.top - popup.height };
		case 'above-end': return { left: right - popup.width, top: anchor.top - popup.height };
		case 'right-start': return { left: right, top: anchor.top };
		case 'right-end': return { left: right, top: bottom - popup.height };
		case 'left-start': return { left: anchor.left - popup.width, top: anchor.top };
		case 'left-end': return { left: anchor.left - popup.width, top: bottom - popup.height };
		case 'below': return { left: anchor.left + (anchor.width - popup.width) / 2, top: bottom };
		case 'above': return { left: anchor.left + (anchor.width - popup.width) / 2, top: anchor.top - popup.height };
		case 'right': return { left: right, top: anchor.top + (anchor.height - popup.height) / 2 };
		default: return { left: anchor.left - popup.width, top: anchor.top + (anchor.height - popup.height) / 2 };
	}
};

/** How much room a side mode has in the direction it goes. */
const roomFor = (mode: Placement, anchor: Rect, view: Size): number => {
	switch (mode) {
		case 'below': return view.height - (anchor.top + anchor.height);
		case 'above': return anchor.top;
		case 'right': return view.width - (anchor.left + anchor.width);
		default: return anchor.left;
	}
};

/** The distance from the popup's centre to the midpoint of the anchor edge it faces. */
const reach = (mode: Placement, anchor: Rect, popup: Size): number => {
	const box = cornerFor(mode, anchor, popup);
	const centre = { x: box.left + popup.width / 2, y: box.top + popup.height / 2 };
	const edge = {
		below: { x: anchor.left + anchor.width / 2, y: anchor.top + anchor.height },
		above: { x: anchor.left + anchor.width / 2, y: anchor.top },
		right: { x: anchor.left + anchor.width, y: anchor.top + anchor.height / 2 },
		left: { x: anchor.left, y: anchor.top + anchor.height / 2 },
	}[mode as 'below' | 'above' | 'right' | 'left'];
	return Math.hypot(centre.x - edge.x, centre.y - edge.y);
};

/** How much of the popup would be on the screen. */
const visible = (box: { left: number; top: number }, popup: Size, view: Size): number => {
	const across = Math.max(0, Math.min(box.left + popup.width, view.width) - Math.max(box.left, 0));
	const down = Math.max(0, Math.min(box.top + popup.height, view.height) - Math.max(box.top, 0));
	return across * down;
};

/** Where the popup ends up, and what it may grow to. */
export interface Placed {
	readonly mode: Placement;
	readonly left: number;
	readonly top: number;
	readonly maxWidth: number;
	readonly maxHeight: number;
	/** What a scale or fade animation should grow from. */
	readonly transformOrigin: string;
}

/** Whether one candidate beats another: more of it showing, then closer, then asked for first. */
const wins = (
	found: { area: number; side: boolean; reach: number; at: number },
	held: { area: number; side: boolean; reach: number; at: number },
): boolean => {
	if (found.area !== held.area) return found.area > held.area;
	if (found.side && held.side) return found.reach < held.reach;
	return found.at < held.at;
};

const ORIGIN: Record<string, string> = {
	'below-start': 'top left', 'below-end': 'top right', 'above-start': 'bottom left',
	'above-end': 'bottom right', 'right-start': 'top left', 'right-end': 'bottom left',
	'left-start': 'top right', 'left-end': 'bottom right',
	below: 'top center', above: 'bottom center', right: 'center left', left: 'center right',
};

/**
 * Pick a place for a popup and work out its box.
 *
 * Params:
 *   anchor: the thing the popup hangs off, as measured
 *   popup: how big the popup wants to be
 *   view: the visible area
 *   locations: the modes to consider, in the caller's order of preference. Empty means every
 *              corner mode
 *
 * Returns: the winner, or null when every mode was rejected. A side mode with less room in its
 * direction than the popup needs is rejected before scoring, because putting it there means
 * putting it off the screen. What is left is ranked by how much of the popup shows; among modes
 * showing the same amount, two side modes are separated by how close they sit to the edge they
 * face, and anything else by the caller's order. The box is then nudged back onto the screen, and
 * `maxWidth` and `maxHeight` say what is left in that direction.
 *
 * Example:
 *   place({ left: 10, top: 10, width: 100, height: 30 }, { width: 200, height: 120 },
 *         { width: 800, height: 600 }, ['below-start', 'above-start']);
 */
export const place = (
	anchor: Rect,
	popup: Size,
	view: Size,
	locations: readonly Placement[] = CORNERS,
): Placed | null => {
	const modes = locations.length === 0 ? CORNERS : locations;

	interface Candidate {
		readonly mode: Placement;
		readonly box: { left: number; top: number };
		readonly area: number;
		readonly reach: number;
		readonly side: boolean;
		readonly at: number;
	}

	let best: Candidate | null = null;
	for (let at = 0; at < modes.length; at += 1) {
		const mode = modes[at]!;
		const side = isSide(mode);
		if (side && roomFor(mode, anchor, view) < (mode === 'below' || mode === 'above' ? popup.height : popup.width)) {
			continue;
		}
		const box = cornerFor(mode, anchor, popup);
		const found: Candidate = {
			mode, box, side, at,
			area: visible(box, popup, view),
			reach: side ? reach(mode, anchor, popup) : 0,
		};
		if (best === null || wins(found, best)) best = found;
	}

	if (best === null) return null;

	const left = Math.max(0, Math.min(best.box.left, view.width - popup.width));
	const top = Math.max(0, Math.min(best.box.top, view.height - popup.height));
	return {
		mode: best.mode,
		left,
		top,
		maxWidth: view.width - left,
		maxHeight: view.height - top,
		transformOrigin: ORIGIN[best.mode]!,
	};
};
