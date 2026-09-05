// A mutable array: a list outside the document (design 081).
//
// A document array holds primitives and observables, because every slot of it can cross a
// wire. An interface also keeps lists of things that never will: components, nodes, closures.
// This is that list. It reads as an array, its mutators say what they did, and it is a cell,
// so a document slot refuses it the way it refuses every other cell.

import { codecError } from '@aweftjs/codec';

import { stamp } from './clock.ts';
import { SOURCE, type Source } from './derived.ts';
import { dispatch } from './transaction.ts';

/**
 * One step of a change, applied in order to the list as it was: `add` inserts before index
 * `at` (or at the end when `at` is the length), `replace` overwrites index `at`, `remove`
 * takes index `at` out. The same three words as a delta. A `splice` says its removes before
 * its adds, so a value it moves is never named at two places at once; `replace` comes only
 * from an index assignment.
 */
export type ArrayChange<T> =
	| { readonly type: 'add'; readonly at: number; readonly value: T }
	| { readonly type: 'replace'; readonly at: number; readonly value: T }
	| { readonly type: 'remove'; readonly at: number };

/** An array whose every edit can be heard. Reads and mutators are the array's own. */
export interface MutableArray<T> extends Array<T> {
	/**
	 * Hear the changes of every mutating call, as one list per call. Returns the unsubscribe.
	 * Delivery is deferred to the same safe point as everything else in core: a watcher that
	 * edits the list has its changes delivered after the current ones, never nested.
	 */
	watch(fn: (changes: readonly ArrayChange<T>[]) => void): () => void;
}

const lists = new WeakSet<object>();

/**
 * Is this a mutable array?
 *
 * Params:
 *   value: anything
 *
 * Returns: true for a list made by `mutableArray`; false for a document array, a plain array,
 * or anything else.
 *
 * Example:
 *   if (isMutableArray(items)) items.watch(reconcile);
 */
export const isMutableArray = (value: unknown): boolean =>
	typeof value === 'object' && value !== null && lists.has(value);

const asIndex = (key: string): number => {
	const at = Number(key);
	return Number.isInteger(at) && at >= 0 && String(at) === key ? at : -1;
};

const unsupported = (name: string, instead: string): never => {
	throw codecError('unsupported', `${name} would rewrite every slot it passes over; ${instead}`);
};

/**
 * A list outside the document, whose slots hold anything.
 *
 * Params:
 *   items: what it starts with
 *
 * Returns: an array. `push`, `pop`, `shift`, `unshift`, `splice`, index assignment and length
 * assignment work and each delivers its changes to `watch`; every read is the array's own.
 * `sort`, `reverse`, `fill` and `copyWithin` throw `unsupported`, as on a document array.
 * Writing one into a document slot is refused with `cell-in-document`: it does not replicate.
 *
 * Example:
 *   const layers = mutableArray<Layer>();
 *   layers.watch((changes) => { for (const c of changes) reconcile(c); });
 *   layers.push(popup);
 */
export const mutableArray = <T = unknown>(items?: Iterable<T>): MutableArray<T> => {
	const values: T[] = items === undefined ? [] : [...items];
	const watchers = new Set<(changes: readonly ArrayChange<T>[]) => void>();
	const marks = new Set<() => void>();

	const deliver = (changes: readonly ArrayChange<T>[]): void => {
		if (changes.length === 0) return;
		stamp();
		const jobs: (() => void)[] = [];
		for (const fn of watchers) jobs.push(() => fn(changes));
		// Derived values over the list are marked in one job, as a cell marks its subscribers.
		if (marks.size > 0) jobs.push(() => { for (const mark of [...marks]) mark(); });
		dispatch(jobs);
	};

	const splice = (start: number, count: number, add: readonly T[]): T[] => {
		const removed = values.splice(start, count, ...add);
		const changes: ArrayChange<T>[] = [];
		if (count === 1 && add.length === 1) {
			if (!Object.is(removed[0], add[0])) changes.push({ type: 'replace', at: start, value: add[0]! });
		} else {
			// Each step names the index it applies to in the list as the previous steps left it.
			for (let i = 0; i < count; i++) changes.push({ type: 'remove', at: start });
			for (let i = 0; i < add.length; i++) changes.push({ type: 'add', at: start + i, value: add[i]! });
		}
		deliver(changes);
		return removed;
	};

	const clamp = (start: number): number =>
		(start < 0 ? Math.max(values.length + start, 0) : Math.min(start, values.length));

	const methods: Record<string, unknown> = {
		push: (...items: T[]): number => {
			splice(values.length, 0, items);
			return values.length;
		},
		pop: (): T | undefined => (values.length === 0 ? undefined : splice(values.length - 1, 1, [])[0]),
		shift: (): T | undefined => (values.length === 0 ? undefined : splice(0, 1, [])[0]),
		unshift: (...items: T[]): number => {
			splice(0, 0, items);
			return values.length;
		},
		splice: (start = 0, count?: number, ...items: T[]): T[] => {
			const from = clamp(start);
			const take = count === undefined ? values.length - from : Math.min(Math.max(count, 0), values.length - from);
			return splice(from, take, items);
		},
		watch: (fn: (changes: readonly ArrayChange<T>[]) => void): (() => void) => {
			watchers.add(fn);
			let on = true;
			return () => {
				if (!on) return;
				on = false;
				watchers.delete(fn);
			};
		},
		sort: () => unsupported('sort', 'assign the order you want, or hold the sort outside the list'),
		reverse: () => unsupported('reverse', 'assign the order you want'),
		fill: () => unsupported('fill', 'assign the slots you mean'),
		copyWithin: () => unsupported('copyWithin', 'assign the slots you mean'),
	};

	const source: Source = {
		read: () => proxy,
		attach: (mark) => {
			marks.add(mark);
			return () => marks.delete(mark);
		},
		immutable: () => true,
	};

	const proxy = new Proxy(values, {
		get: (target, key, receiver) => {
			if (key === SOURCE) return source;
			if (typeof key === 'string' && Object.hasOwn(methods, key)) return methods[key];
			return Reflect.get(target, key, receiver) as unknown;
		},

		set: (_target, key, value) => {
			if (typeof key === 'symbol') {
				throw codecError('invalid-key', `${String(key)} is not an array slot`);
			}

			if (key === 'length') {
				const length = Number(value);
				if (!Number.isInteger(length) || length < 0 || length > values.length) {
					throw codecError('invalid-write', 'an array grows by inserting, not by its length');
				}
				splice(length, values.length - length, []);
				return true;
			}

			const at = asIndex(key);
			if (at < 0) throw codecError('invalid-key', `${key} is not an array index`);
			if (at > values.length) {
				throw codecError('invalid-write', 'an array has no gaps; push or splice instead');
			}
			splice(at, at === values.length ? 0 : 1, [value as T]);
			return true;
		},

		deleteProperty: (_target, key) => {
			throw codecError(
				'invalid-write',
				`deleting ${String(key)} would leave a hole; splice it out instead`,
			);
		},
	}) as MutableArray<T>;

	lists.add(proxy);
	return proxy;
};
