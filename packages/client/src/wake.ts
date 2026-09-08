// The two moments a browser knows the network is back before any timer would.
//
// A laptop lid is the common drop, and a backoff alone would sit out the rest of its wait
// after the lid opens. Both globals are probed rather than assumed, because this package runs
// in a page, in a worker and in Node, and only the first has either.

/** Anything that registers and drops listeners. Probed, so a runtime without one is fine. */
interface Listening {
	addEventListener(type: string, fn: () => void): void;
	removeEventListener(type: string, fn: () => void): void;
}

/** The one field that tells a hidden tab from a shown one. */
interface Shown {
	readonly visibilityState?: unknown;
}

const listens = (value: unknown): value is Listening => {
	const held = value as Partial<Listening> | null | undefined;
	return held !== null && held !== undefined
		&& typeof held.addEventListener === 'function'
		&& typeof held.removeEventListener === 'function';
};

/**
 * Call back when the browser says the network is worth trying again.
 *
 * Params:
 *   act: run when the machine comes online, and when the page becomes visible
 *
 * Returns: the function that drops both listeners. Registering returns its unsubscribe here
 * as everywhere else in the stack.
 *
 * Example:
 *   const stop = wake(() => attemptNow());
 *   stop();
 */
export const wake = (act: () => void): (() => void) => {
	const stops: Array<() => void> = [];

	const global: unknown = globalThis;
	if (listens(global)) {
		global.addEventListener('online', act);
		stops.push(() => global.removeEventListener('online', act));
	}

	const page: unknown = (globalThis as { document?: unknown }).document;
	if (listens(page) && typeof (page as Shown).visibilityState === 'string') {
		const shown = (): void => {
			if ((page as Shown).visibilityState === 'visible') act();
		};
		page.addEventListener('visibilitychange', shown);
		stops.push(() => page.removeEventListener('visibilitychange', shown));
	}

	return () => {
		for (const stop of stops) stop();
	};
};
