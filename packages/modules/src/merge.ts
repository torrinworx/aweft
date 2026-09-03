// How a module's configuration is put together: plain objects merge one level at a time, and
// anything else, arrays included, is replaced whole by the side that wins.

export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (value === null || typeof value !== 'object') return false;
	const proto: unknown = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

/**
 * `over` wins. A plain object on both sides merges recursively; anything else replaces. An
 * `undefined` on the winning side leaves the other side's value, so an extension can spell a
 * key without unsetting it.
 */
export const merge = (
	under: Readonly<Record<string, unknown>>,
	over: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...under };
	for (const [key, value] of Object.entries(over)) {
		if (value === undefined) continue;
		const had = out[key];
		out[key] = isPlainObject(had) && isPlainObject(value) ? merge(had, value) : value;
	}
	return out;
};
