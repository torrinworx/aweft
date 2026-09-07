// A modal dialog on the platform's own `<dialog>` (design 129).
//
// The element does the hard parts: the top layer with no z-index, the backdrop, a focus trap, and
// Escape through its own `cancel` event. What it does not do is take the rest of the page out of
// the reading order, or put the keyboard back where it came from, so this does those two.
//
// This is not exported. `Modal` calls it, and `internal.dialog.test.ts` drives it directly.

import { within } from './tree.ts';

/** What a caller tells the dialog. */
export interface DialogOptions {
	/** Called after it has closed, however it closed. */
	readonly onClose?: () => void;
}

/** An open and a close, and the teardown that undoes the listeners. */
export interface DialogControl {
	/** Show it, take the rest of the page out of the reading order, and remember the keyboard. */
	open(): void;
	/** Close it. The `close` event is what actually undoes everything. */
	close(): void;
	/** Whether it is showing. */
	isOpen(): boolean;
	/** Drop the listeners, and close it if it is still open. */
	stop(): void;
}

interface DialogLike {
	showModal?(): void;
	close?(): void;
	open?: boolean;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
	addEventListener?(type: string, listener: (event: unknown) => void): void;
	removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

interface Focusable {
	focus?(): void;
}

interface PageLike {
	readonly body?: { readonly children?: ArrayLike<DialogLike> } | null;
	readonly activeElement?: unknown;
}

const pageOf = (): PageLike | undefined => (globalThis as { document?: PageLike }).document;

/**
 * Drive one `<dialog>` as a modal.
 *
 * Params:
 *   element: the `<dialog>` itself
 *   options: `onClose`, called after it has closed however it closed
 *
 * Returns: `open`, `close`, `isOpen` and `stop`. `stop` is the teardown, as every registration in
 * this stack is.
 *
 * The three things this adds to the element:
 *
 * - every other top-level child of the page gets `inert` while it is open, so a screen reader and
 *   the Tab key both stop at the dialog rather than walking the page behind it;
 * - the element that had the keyboard when it opened gets it back when it closes;
 * - Escape arrives as the element's own `cancel` event, which the platform fires and this lets
 *   through, so there is no second key listener to disagree with the platform.
 *
 * `close()` is asynchronous in a browser. The platform queues the element's `close` event rather
 * than firing it inside `close()`, and that event is what puts the page back and moves the
 * keyboard, so both land on the next task.
 *
 * With no `showModal` (the light tree, and a static render) the element is given the `open`
 * attribute instead, everything happens on the same task, and everything else is the same.
 *
 * Example:
 *   const modal = dialogControl(element, { onClose: () => shown.set(false) });
 *   modal.open();
 */
export const dialogControl = (element: unknown, options: DialogOptions = {}): DialogControl => {
	const target = element as DialogLike;
	let open = false;
	let inerted: DialogLike[] = [];
	let invoker: Focusable | null = null;

	const takeOutOfTheReadingOrder = (): void => {
		const children = pageOf()?.body?.children;
		if (children === undefined || children === null) return;
		for (let at = 0; at < children.length; at += 1) {
			const child = children[at]!;
			// The dialog's own branch stays reachable; everything beside it does not. A dialog
			// nested in a wrapper must not go inert along with the wrapper.
			if (within(target, [child])) continue;
			child.setAttribute('inert', '');
			inerted.push(child);
		}
	};

	const putItBack = (): void => {
		for (const child of inerted) child.removeAttribute('inert');
		inerted = [];
	};

	const onClose = (): void => {
		if (!open) return;
		open = false;
		putItBack();
		invoker?.focus?.();
		invoker = null;
		options.onClose?.();
	};

	target.addEventListener?.('close', onClose);

	return {
		open: () => {
			if (open) return;
			open = true;
			invoker = (pageOf()?.activeElement ?? null) as Focusable | null;
			takeOutOfTheReadingOrder();
			if (typeof target.showModal === 'function') target.showModal();
			else target.setAttribute('open', '');
		},
		close: () => {
			if (!open) return;
			if (typeof target.close === 'function') {
				// The element fires `close`, and `onClose` is what undoes the rest.
				target.close();
				return;
			}
			target.removeAttribute('open');
			onClose();
		},
		isOpen: () => open,
		stop: () => {
			// Closing first, so a dialog torn down while open does not leave the page inert.
			if (open) {
				if (typeof target.close === 'function') target.close();
				else target.removeAttribute('open');
				onClose();
			}
			target.removeEventListener?.('close', onClose);
		},
	};
};
