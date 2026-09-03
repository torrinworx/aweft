// What can be asked, and what has to be declared before it can be.
//
// A declared path is literal steps from the root, never a wildcard: a wildcard names many
// paths inside one document, and a projection holds one value per path per document, so a
// wildcard has nowhere to land (design 049).

import type { SnapshotValue } from '@aweftjs/core';

/**
 * What reading a path needs: the slots of every observable, by id.
 *
 * Stated structurally rather than imported, so this file does not depend on the one that
 * builds it. `driver.ts` needs the types here, and `rows.ts` needs the types there, so an
 * import back would close a cycle.
 */
type Slots = ReadonlyMap<string, {
	readonly kind: string;
	readonly slots: Readonly<Record<string, SnapshotValue>>;
}>;

/** What a declared path can hold. A reference is indexed as the id it names. */
export type Indexable = string | number | boolean | null;

/** The paths a store indexes, by the name a query calls each one. */
export type Declaration = Readonly<Record<string, readonly string[]>>;

/** One condition. `field` names a declared path. */
export interface Where {
	readonly field: string;
	readonly op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
	readonly value: Indexable;
}

/**
 * A question about documents.
 *
 * The first condition is answered by its index and does the pruning; the rest narrow what it
 * returned. That is why a query costs what its first condition selects, and why putting the
 * most selective one first is the whole of the tuning advice.
 */
export interface Query {
	readonly where: readonly Where[];
	readonly sort?: { readonly field: string; readonly direction?: 'asc' | 'desc' };
	readonly limit?: number;
	/** The last document of the previous page. Paging is by cursor, never by an offset. */
	readonly after?: string;
}

/**
 * Check a declaration before anything is built from it.
 *
 * Throws when a path is empty or holds a step that is not a literal, naming the field.
 */
export const checkDeclaration = (declaration: Declaration): void => {
	for (const [field, path] of Object.entries(declaration)) {
		if (path.length === 0) throw new Error(`store: ${field} declares an empty path`);
		for (const step of path) {
			if (typeof step !== 'string') {
				throw new Error(
					`store: ${field} declares a wildcard, and a wildcard names many paths in one document`,
				);
			}
		}
	}
};

/** Refuse a query that asks about something nothing indexed. */
export const checkQuery = (query: Query, declaration: Declaration): void => {
	if (query.where.length === 0) throw new Error('store: a query carries at least one condition');
	const known = (field: string, what: string): void => {
		if (declaration[field] === undefined) {
			throw Object.assign(
				new Error(`store: ${what} ${field}, which is not declared. Declare it, or use scan`),
				{ reason: 'undeclared' },
			);
		}
	};
	for (const where of query.where) known(where.field, 'a condition names');
	if (query.sort !== undefined) known(query.sort.field, 'the sort names');
};

/**
 * Read a declared path out of a document's rows.
 *
 * Throws when the path crosses an array, which is a mistake rather than an empty result.
 *
 * Returns: what the path holds, or null when any step of it is missing. A slot holding another
 * observable is indexed as that observable's id, so a path can ask which document points at
 * something.
 */
export const valueAt = (rows: Slots, root: string, path: readonly string[]): Indexable => {
	let at = root;
	for (let i = 0; i < path.length; i++) {
		const row = rows.get(at);
		if (row === undefined) return null;

		// An array slot is an ordered byte string that the runtime chooses and nothing keeps
		// stable, so a literal step into one names a place rather than a thing. Left to itself
		// it would index nothing, quietly, for the life of the declaration.
		if (row.kind === 'array') {
			throw new Error(
				`store: a declared path may not cross an array (at ${path.slice(0, i).join('.')}), `
				+ 'because an array position is not a stable name',
			);
		}

		const held: SnapshotValue | undefined = row.slots[path[i]!];
		if (held === undefined) return null;

		if (held !== null && typeof held === 'object' && 'ref' in held) {
			if (i === path.length - 1) return held.ref;
			at = held.ref;
			continue;
		}
		if (i < path.length - 1) return null;     // a primitive part way down the path
		if (held instanceof Uint8Array) return null;
		return held;
	}
	return null;
};

/** Every declared field's current value. */
export const projectionOf = (rows: Slots, root: string, declaration: Declaration): Record<string, Indexable> => {
	const out: Record<string, Indexable> = {};
	for (const [field, path] of Object.entries(declaration)) out[field] = valueAt(rows, root, path);
	return out;
};

/** Whether one record satisfies one condition. */
export const holds = (where: Where, value: Indexable): boolean => {
	if (where.op === 'eq') return value === where.value;
	if (value === null || where.value === null) return false;
	if (typeof value !== typeof where.value) return false;
	if (where.op === 'gt') return value > where.value;
	if (where.op === 'gte') return value >= where.value;
	if (where.op === 'lt') return value < where.value;
	return value <= where.value;
};

/** Order two values the way every driver has to order them. */
export const compare = (a: Indexable, b: Indexable): number => {
	if (a === b) return 0;
	if (a === null) return -1;
	if (b === null) return 1;
	if (typeof a === typeof b) return a < b ? -1 : 1;
	return typeof a < typeof b ? -1 : 1;
};
