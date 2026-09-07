// Showing something on hover and on focus, after a pause (design 129).
//
// Hover and focus both, because a tooltip only a pointer can reach is a tooltip a keyboard cannot
// read. The pause is what stops a row of buttons flashing tips at somebody moving the pointer
// across it, and it is skipped on focus, where the person has already arrived deliberately.
//
// This is not exported. `Tooltip` calls it, and `internal.tooltip.test.ts` drives it directly.

import { dismiss } from './dismiss.ts';

/** The cell a trigger writes. */
interface Switchable {
	get(): unknown;
	set(value: unknown): void;
}

/** What a caller tells the trigger. */
export interface TooltipOptions {
	/** The nodes that show it. Read when the listeners go on. */
	readonly nodes: () => readonly unknown[];
	/** The element being shown, asked for the top layer once it is there. Optional. */
	readonly panel?: () => unknown;
	/** Written true when it should show and false when it should not. */
	readonly open: Switchable;
	/** The pause before a hover shows it, in milliseconds. 400 when omitted. */
	readonly delay?: number;
}

interface Listening {
	addEventListener?(type: string, listener: (event: unknown) => void): void;
	removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

interface Popoverish {
	togglePopover?(force: boolean): boolean;
	setAttribute?(name: string, value: string): void;
	readonly isConnected?: boolean;
}

/** How long a pointer rests on something before it is asking about it. */
const DELAY = 400;

/** How many frames a panel gets to join the document before the ask is dropped. */
const FRAMES = 10;

/**
 * Show something while the pointer is on a trigger, or the keyboard is.
 *
 * Params:
 *   options: the trigger nodes, the panel, the cell to write, and the pause before a hover
 *            shows it
 *
 * Returns: the teardown, as every registration in this stack does: every listener off, and the
 * pending timer and the pending frame both cancelled.
 *
 * What shows it: `mouseenter` after the pause, and `focusin` at once. What hides it: `mouseleave`,
 * `focusout`, and Escape. Escape comes through `dismiss`, so there is one implementation of it in
 * this package rather than two.
 *
 * Where the host has the Popover API the panel is asked for `popover="hint"` and put in the top
 * layer with it, which is the hint type: it does not close a menu that is already open, and it is
 * closed by anything that opens over it. Where the host has none, the panel is left as it is and
 * the page's own order decides, which is what design 113 already says about a popup.
 *
 * Example:
 *   const stop = tooltipTrigger({ nodes: () => anchor, panel: () => tip, open: shown });
 */
export const tooltipTrigger = (options: TooltipOptions): (() => void) => {
	const wait = options.delay ?? DELAY;
	const stops: (() => void)[] = [];
	let timer: ReturnType<typeof setTimeout> | null = null;
	let frame: number | null = null;
	let tries = 0;
	let dead = false;

	const cancel = (): void => {
		if (timer === null) return;
		clearTimeout(timer);
		timer = null;
	};

	const cancelFrame = (): void => {
		if (frame === null) return;
		(globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame?.(frame);
		frame = null;
	};

	const show = (): void => {
		cancel();
		tries = 0;
		options.open.set(true);
		hint(true);
	};

	const hide = (): void => {
		cancel();
		tries = 0;
		options.open.set(false);
		hint(false);
	};

	// The top layer, asked for on the element rather than won with a number, and only once the
	// element is in the document: a panel asked before it is there throws, so the ask waits for
	// the frame that puts it in.
	const hint = (on: boolean): void => {
		if (dead) return;
		const panel = options.panel?.() as Popoverish | undefined | null;
		if (panel === undefined || panel === null) return;
		if (typeof panel.togglePopover !== 'function') return;
		panel.setAttribute?.('popover', 'hint');
		if (panel.isConnected === false) {
			// Bounded, because a panel that is not in the document after a few frames is not on
			// its way there, and an unbounded retry is a loop that runs for the life of the page.
			const request = (globalThis as { requestAnimationFrame?: (fn: () => void) => number }).requestAnimationFrame;
			if (request === undefined || tries >= FRAMES) return;
			tries += 1;
			frame = request(() => { frame = null; hint(Boolean(options.open.get())); });
			return;
		}
		tries = 0;
		panel.togglePopover(on);
	};

	const listen = (node: Listening, type: string, handler: (event: unknown) => void): void => {
		if (typeof node.addEventListener !== 'function') return;
		node.addEventListener(type, handler);
		stops.push(() => { node.removeEventListener?.(type, handler); });
	};

	const onEnter = (): void => {
		cancel();
		timer = setTimeout(show, wait);
	};

	for (const node of options.nodes()) {
		const target = node as Listening;
		listen(target, 'mouseenter', onEnter);
		listen(target, 'mouseleave', hide);
		// A keyboard has already arrived on purpose, so it does not wait.
		listen(target, 'focusin', show);
		listen(target, 'focusout', hide);
	}

	// A mousedown on the trigger is what a person does before reading the thing they clicked, so
	// the trigger counts as inside and everything else dismisses.
	stops.push(dismiss({
		inside: options.nodes,
		active: () => Boolean(options.open.get()),
		escape: true,
		onDismiss: hide,
	}));

	return () => {
		dead = true;
		cancel();
		cancelFrame();
		for (const stop of stops) stop();
		stops.length = 0;
	};
};
