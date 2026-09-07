// What this package calls reactive, in one place.
//
// A scope, a cell and a derived value are all duck-typed here, as `dom` types a node: `get` and
// `effect` are what makes something a source, and `set` and `map` are what some of them also
// have. `core` and `dom` do not export a predicate for this, so `ui` keeps its own; three copies
// of it with three different requirements is what this file replaces.

/** A scope, cell or derived value. `set` is on the writable ones and `map` on the chainable ones. */
export interface Source {
	get(): unknown;
	effect(fn: (value: unknown) => void): () => void;
	set?(value: unknown): void;
	map?(fn: (value: unknown) => unknown): unknown;
}

/** Whether a value is one. */
export const isSource = (value: unknown): value is Source =>
	(typeof value === 'object' || typeof value === 'function') && value !== null
	&& typeof (value as Source).effect === 'function'
	&& typeof (value as Source).get === 'function';

/** Whether a source can be written to, which is what a state prop has to be. */
export const isWritable = (value: unknown): value is Source & { set(value: unknown): void } =>
	isSource(value) && typeof value.set === 'function';

/**
 * Read a value through a function, following it when it is reactive.
 *
 * Params:
 *   value: a plain value, or a cell or derived value
 *   pick: what to make of it
 *
 * Returns: `pick(value)` for a plain value, and a derived value for a reactive one, so the
 * result can go straight into `h` as a child or an attribute.
 */
export const through = (value: unknown, pick: (value: unknown) => unknown): unknown =>
	(isSource(value) && value.map !== undefined ? value.map(pick) : pick(value));
