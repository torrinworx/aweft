// Loud footguns. A failed assert throws in development; a release transform, when `build`
// ships one, strips the calls. Until then `release(true)` is how the production path is
// exercised, which only a white-box test does.

let stripped = false;

export const assert = (condition: unknown, message: string): void => {
	if (!stripped && !condition) throw new Error(`dom: ${message}`);
};

/** Behave as a release build would: asserts pass silently. Test seam, not surface. */
export const release = (on: boolean): void => {
	stripped = on;
};

export const isRelease = (): boolean => stripped;
