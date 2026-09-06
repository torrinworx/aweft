// Loud footguns, as `dom` has them. A failed assert throws; a release build takes the calls out
// of the source, so there is nothing here to switch off (design 097).

export const assert = (condition: unknown, message: string): void => {
	if (!condition) throw new Error(`ui: ${message}`);
};
