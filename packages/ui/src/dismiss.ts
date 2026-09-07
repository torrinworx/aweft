// Closing something the person clicked away from, or pressed Escape out of (design 129).
//
// Both halves need the page, because both are about events that happen somewhere other than the
// element. With no page there is nothing to listen to, so this installs nothing and hands back a
// teardown that removes nothing, which is what a static render and the light tree want.
//
// This is not exported. `Popup` calls it for the mousedown half, and the tooltip trigger calls it
// for the Escape half.

import { within } from './tree.ts';

/** What a caller tells `dismiss`. */
export interface DismissOptions {
	/** The nodes a mousedown inside does not count. Read on every event, so it may grow. */
	readonly inside: () => readonly unknown[];
	/** Whether the thing is showing at all. Nothing is dismissed while this is false. */
	readonly active: () => boolean;
	/** Given the event, whether it may close. Omitted, every outside mousedown closes. */
	readonly canClose?: ((event: unknown) => boolean) | undefined;
	/** Also close on Escape. Off by default, because not everything that closes on a click
	 * outside it should also swallow an Escape the page wanted. */
	readonly escape?: boolean;
	/** Close it. Called with the event that asked. */
	readonly onDismiss: (event: unknown) => void;
}

interface Listening {
	addEventListener?(type: string, listener: (event: unknown) => void): void;
	removeEventListener?(type: string, listener: (event: unknown) => void): void;
}

/**
 * Close something on a mousedown outside it, and on Escape when asked.
 *
 * Params:
 *   options: the nodes that count as inside, whether it is showing, the optional veto, whether
 *            Escape counts, and what to do
 *
 * Returns: the teardown, as every registration in this stack does. With no page it removes
 * nothing, because nothing was installed.
 *
 * Example:
 *   const stop = dismiss({
 *     inside: () => [panel],
 *     active: () => open.get(),
 *     escape: true,
 *     onDismiss: () => open.set(false),
 *   });
 */
export const dismiss = (options: DismissOptions): (() => void) => {
	const page = (globalThis as { document?: Listening }).document;
	if (page === undefined || typeof page.addEventListener !== 'function') return () => undefined;

	const onDown = (event: unknown): void => {
		if (!options.active()) return;
		if (within((event as { target?: unknown }).target ?? null, options.inside())) return;
		if (options.canClose !== undefined && !options.canClose(event)) return;
		options.onDismiss(event);
	};

	const onKey = (event: unknown): void => {
		if (!options.active()) return;
		if ((event as { key?: string }).key !== 'Escape') return;
		if (options.canClose !== undefined && !options.canClose(event)) return;
		options.onDismiss(event);
	};

	page.addEventListener('mousedown', onDown);
	if (options.escape === true) page.addEventListener('keydown', onKey);

	return () => {
		page.removeEventListener?.('mousedown', onDown);
		if (options.escape === true) page.removeEventListener?.('keydown', onKey);
	};
};
