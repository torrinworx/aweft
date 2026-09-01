// The write clock: one counter that moves when any state does.
//
// An unobserved derived value has no subscription telling it about change, so its cache is
// trusted exactly as long as nothing anywhere has been written (design 023). The clock is
// what makes that checkable in one comparison. It counts commits and cell writes, not reads.

let now = 0;

/** Something was written. Every idle cache stamped before this is no longer trusted. */
export const stamp = (): void => {
	now += 1;
};

/** The current write clock. */
export const clock = (): number => now;
