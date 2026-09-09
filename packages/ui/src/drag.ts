// Turning a pointer or a key into a place in a box (design 221).
//
// The place is two fractions, 0 at one edge and 1 at the other, so it survives a resize and a
// caller turns it into whatever it is measuring. What the numbers mean is the caller's.
//
// This is not exported. `ColorPicker`'s plane calls it.

/** A place in the box, each number 0 to 1. `y` grows downward, the way a box is measured. */
export interface DragPlace {
	readonly x: number;
	readonly y: number;
}

/** What a caller tells `drag`. */
export interface DragOptions {
	/** Which axes move. `xy` when omitted. */
	readonly axes?: 'x' | 'y' | 'xy';
	/** Where it is now. Read on every key, and on a press for the axis that is not moving. */
	readonly at: () => DragPlace;
	/** Called with the new place. Both numbers, whatever the axes are. */
	readonly onMove: (to: DragPlace) => void;
	/** One arrow press, as a fraction of the whole range. A hundredth when omitted. */
	readonly step?: number;
	/** One arrow press with Shift held. Ten steps when omitted. */
	readonly coarse?: number;
	/** Nothing moves while this answers true. */
	readonly disabled?: () => boolean;
}

/** The props a caller writes on its elements. */
export interface DragGrip {
	/** Goes on the element whose box is being measured. */
	readonly pointer: {
		onPointerDown(event: unknown): void;
		onPointerMove(event: unknown): void;
		onPointerUp(event: unknown): void;
		onPointerCancel(event: unknown): void;
	};
	/** Goes on the element the keyboard lands on, which may be the same one. */
	readonly keys: {
		onKeyDown(event: unknown): void;
	};
}

interface Boxed {
	getBoundingClientRect?(): { left: number; top: number; width: number; height: number };
	setPointerCapture?(id: number): void;
	releasePointerCapture?(id: number): void;
}

const STEP = 0.01;

const clamp = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Where along one side, as a fraction. A side of nothing is the near end, not a division by it. */
const along = (position: number, start: number, span: number): number =>
	(span > 0 ? clamp((position - start) / span) : 0);

// The element the handler was written on. A host sends both; a light tree sends the target alone.
const boxOf = (event: unknown): Boxed | null => {
	const held = event as { currentTarget?: unknown; target?: unknown };
	const node = (held.currentTarget ?? held.target ?? null) as Boxed | null;
	return node !== null && typeof node.getBoundingClientRect === 'function' ? node : null;
};

/**
 * A drag on an element's box, and the keys that do the same job.
 *
 * Params:
 *   options: the axes, where it is now, what to do with a new place, the two step sizes, and
 *            whether it is disabled
 *
 * Returns: two sets of props. `pointer` goes on the element being measured and `keys` on whatever
 * takes focus; spread both onto one element where that is the same element.
 *
 * A press captures the pointer, so a drag that leaves the box keeps reporting, and a release gives
 * it back. A touch and a stylus are pointers too and take the same path. The element wants
 * `touch-action: none` in its theme entry, or the host scrolls instead of dragging.
 *
 * Example:
 *   const grip = drag({ axes: 'xy', at: () => place, onMove: (to) => { place = to; } });
 *   h('div', { ...grip.pointer }, h('span', { ...grip.keys, role: 'slider', tabindex: '0' }));
 */
export const drag = (options: DragOptions): DragGrip => {
	const axes = options.axes ?? 'xy';
	const movesX = axes !== 'y';
	const movesY = axes !== 'x';
	const step = options.step ?? STEP;
	const coarse = options.coarse ?? step * 10;

	// The drag in progress, by the pointer that started it. A second finger carries another id and
	// is not this drag, and a move with nothing held is a pointer passing over the box.
	let holding: number | null = null;

	const off = (): boolean => options.disabled?.() === true;

	const goTo = (event: unknown): void => {
		const node = boxOf(event);
		if (node === null) return;
		const box = node.getBoundingClientRect!();
		const held = options.at();
		const point = event as { clientX?: number; clientY?: number };
		options.onMove({
			x: movesX ? along(point.clientX ?? 0, box.left, box.width) : held.x,
			y: movesY ? along(point.clientY ?? 0, box.top, box.height) : held.y,
		});
	};

	const release = (event: unknown): void => {
		if (holding === null) return;
		boxOf(event)?.releasePointerCapture?.(holding);
		holding = null;
	};

	const move = (by: number, axis: 'x' | 'y'): void => {
		const held = options.at();
		options.onMove(axis === 'x'
			? { x: clamp(held.x + by), y: held.y }
			: { x: held.x, y: clamp(held.y + by) });
	};

	const end = (to: number): void => {
		const held = options.at();
		options.onMove(movesX ? { x: to, y: held.y } : { x: held.x, y: to });
	};

	return {
		pointer: {
			onPointerDown: (event: unknown) => {
				if (off()) return;
				const id = (event as { pointerId?: number }).pointerId ?? 0;
				holding = id;
				boxOf(event)?.setPointerCapture?.(id);
				// A press is a move: pressing in the box puts the thing where the press landed
				// rather than waiting for the pointer to travel first.
				(event as { preventDefault?: () => void }).preventDefault?.();
				goTo(event);
			},
			onPointerMove: (event: unknown) => {
				if (off() || holding === null) return;
				if (((event as { pointerId?: number }).pointerId ?? 0) !== holding) return;
				goTo(event);
			},
			onPointerUp: release,
			onPointerCancel: release,
		},
		keys: {
			onKeyDown: (event: unknown) => {
				if (off()) return;
				const held = event as { key?: string; shiftKey?: boolean; preventDefault?: () => void };
				const by = held.shiftKey === true ? coarse : step;
				const name = held.key;

				if (name === 'ArrowLeft' && movesX) move(-by, 'x');
				else if (name === 'ArrowRight' && movesX) move(by, 'x');
				else if (name === 'ArrowUp' && movesY) move(-by, 'y');
				else if (name === 'ArrowDown' && movesY) move(by, 'y');
				else if (name === 'Home') end(0);
				else if (name === 'End') end(1);
				else return;

				held.preventDefault?.();
			},
		},
	};
};
