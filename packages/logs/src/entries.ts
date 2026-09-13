// What an entry is, on either side: one flat object of primitives with `at`, `side` and `kind`,
// so a row in the store is a row in a view (design 261). Nothing here reaches for Node or the
// DOM; the client half imports it into a page bundle.

/** A value a slot of an entry may hold. */
export type Primitive = string | number | boolean | null;

/** One thing that happened, flat: `at`, `side`, `kind`, and the fields of the kind. */
export interface Entry {
	readonly at: number;
	readonly side: 'page' | 'server';
	readonly kind: string;
	readonly [field: string]: Primitive | undefined;
}

/** What the page sends: one visit's entries, with what is known once per visit when it is. */
export interface Batch {
	readonly visit: string;
	readonly build?: string | null;
	readonly browser?: Readonly<Record<string, Primitive>>;
	readonly ended?: boolean;
	readonly entries: readonly Entry[];
}

const isPrimitive = (value: unknown): value is Primitive =>
	value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** Anything as text, for a field that has to be one: JSON where it can, `String` where it cannot. */
export const asText = (value: unknown): string => {
	try {
		if (typeof value === 'string') return value;
		if (value instanceof Error) return value.stack ?? value.message;
		const written = JSON.stringify(value);
		return written === undefined ? String(value) : written;
	} catch {
		// A value whose own `toString` or `stack` getter throws must not throw out of a log call.
		return '[unprintable]';
	}
};

/** The bytes a value takes as JSON, or -1 when JSON cannot write it. */
export const bytesOf = (value: unknown): number => {
	try {
		const written = JSON.stringify(value);
		return written === undefined ? 0 : written.length;
	} catch {
		return -1;
	}
};

/**
 * One level of primitives out of whatever was handed in: a primitive field stays, `undefined`
 * is dropped, and anything else is written as JSON text. A finite number stays a number; an
 * infinite one or NaN is written as text, since JSON has no spelling for it.
 */
export const flat = (fields: Readonly<Record<string, unknown>>): Record<string, Primitive> => {
	const out: Record<string, Primitive> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === undefined) continue;
		if (typeof value === 'number' && !Number.isFinite(value)) { out[key] = String(value); continue; }
		out[key] = isPrimitive(value) ? value : asText(value);
	}
	return out;
};

/** The kinds that count as an error on a visit. */
export const isError = (entry: { readonly kind: string; readonly level?: unknown }): boolean =>
	entry.kind === 'error' || entry.kind === 'rejection' || entry.kind === 'failed'
	|| (entry.kind === 'console' && entry.level === 'error');

/**
 * An entry as the store keeps it, from whatever a page or a module handed in: `at` a finite
 * number or now, `side` as the caller says, `kind` a non-empty string or nothing is made.
 */
export const entryOf = (fields: Readonly<Record<string, unknown>>, side: 'page' | 'server', at = Date.now()): Entry | undefined => {
	const kind: unknown = fields.kind;
	if (typeof kind !== 'string' || kind === '') return undefined;
	const when: unknown = fields.at;
	const { at: _at, side: _side, ...rest } = fields;
	return { ...flat(rest), at: typeof when === 'number' && Number.isFinite(when) ? when : at, side, kind };
};

/**
 * The sentinel for an entry a full visit had no room for: its own kind is `capped`, so it is not
 * counted as anything and a reader sees the visit filled.
 */
export const full = (entry: Entry): Entry => ({ at: entry.at, side: entry.side, kind: 'capped', of: entry.kind });

/**
 * An entry trimmed to fit a byte budget. The fields that make an entry large go first: the
 * stack, a call's args and result, a commit's paths, a refusal's reasons. What is left keeps
 * its kind and its names, so an error stays an error, a failed call still says which module,
 * and a reader still groups it; `capped: true` says it was cut. When that is still over,
 * `message` is cut to what the budget leaves, and past that only `at`, `side` and `kind` stay.
 */
export const trim = (entry: Entry, budget: number): Entry => {
	const { stack: _stack, args: _args, result: _result, paths: _paths, reasons: _reasons, message, ...rest } = entry;
	let base: Entry = { ...rest, capped: true };
	if (JSON.stringify(base).length > budget) base = { at: entry.at, side: entry.side, kind: entry.kind, capped: true };
	if (typeof message !== 'string') return base;
	// The room a `,"message":"..."` slot leaves, less what escaping a character can add; slice to
	// it, then confirm, because a run of quotes or backslashes still doubles under JSON.
	const room = budget - JSON.stringify(base).length - ',"message":""'.length;
	let cut = room > 0 ? message.slice(0, room) : '';
	while (cut.length > 0 && JSON.stringify({ ...base, message: cut }).length > budget) cut = cut.slice(0, -8);
	return cut === '' ? base : { ...base, message: cut };
};
