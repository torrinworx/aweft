// The array observable: ordered, addressed by position.
//
// A slot is named by a position key rather than an index, so inserting near the front renames
// nothing and two replicas inserting at once do not fight over what index 3 means. Reads are
// the ordinary array surface, because an array whose contents cannot be read with the array
// methods is not an array. The mutating half is replaced, since the built-in versions would
// rewrite every slot after the one that actually moved.

import { type Id, type Position, assertPosition, bytesFromHex, bytesToHex, codecError } from '@aweftjs/codec';

import type { Node } from './types.ts';
import { createNode, indexOfSlot, plantCell } from './node.ts';
import { between, run } from './position.ts';
import { atomic, write } from './transaction.ts';
import { nodeOf, register, toCell } from './value.ts';

const positionAt = (node: Node, at: number): Position | null => {
	const slot = node.order[at];
	return slot === undefined ? null : assertPosition(bytesFromHex(slot));
};

const place = (node: Node, before: Position | null, after: Position | null, value: unknown): Position => {
	const position = between(before, after);
	write(node, bytesToHex(position), toCell(value));
	return position;
};

const removeAt = (node: Node, at: number): unknown => {
	const slot = node.order[at];
	if (slot === undefined) return undefined;

	const value = node.values[at];
	write(node, slot, undefined);
	return value;
};

/** Insert a run of values between two positions, keeping them in the order they were given. */
const insertRun = (node: Node, at: number, items: readonly unknown[]): void => {
	if (items.length === 0) return;

	let before = positionAt(node, at - 1);
	const after = positionAt(node, at);

	// Appending is counting up, so a run onto the end is minted in one pass rather than taking
	// the key it just wrote back apart once per value (design 155).
	if (after === null) {
		const keys = run(before, items.length);
		for (let i = 0; i < items.length; i++) write(node, bytesToHex(keys[i]!), toCell(items[i]));
		return;
	}

	for (const item of items) before = place(node, before, after, item);
};

const asIndex = (key: string): number => {
	const at = Number(key);
	return Number.isInteger(at) && at >= 0 && String(at) === key ? at : -1;
};

const unsupported = (name: string, fix: string): never => {
	throw codecError(
		'unsupported',
		`${name} would rewrite every slot it passes over`,
		fix,
	);
};

/**
 * Insert a value at a position of the caller's choosing.
 *
 * Params:
 *   list: the array observable
 *   position: the position key. It must be free, and it decides where the value sorts
 *   value: what to put there
 *
 * Throws: `not-observable` when `list` is not an array observable, `invalid-position` for a
 * key the format forbids, and `slot-exists` when something already holds that position.
 *
 * This is what bridging two trees needs: a receiver that has been told a position must be
 * able to honour it rather than generate its own and diverge.
 *
 * Example:
 *   insertAt(mirror, positionsOf(list)[0]!, list[0]);
 */
export const insertAt = (list: object, position: Position, value: unknown): void => {
	const node = nodeOf(list);
	if (node === undefined || node.kind !== 'array') {
		throw codecError('not-observable', 'insertAt takes an array observable',
			'Pass what createArray returned.');
	}

	// Refused here rather than at encode time, which may be many commits later on a machine
	// that cannot say where the bad key came from.
	assertPosition(position);
	const slot = bytesToHex(position);
	if (indexOfSlot(node, slot) >= 0) {
		throw codecError('slot-exists', `${slot} is already taken in this array`,
			'Pick a position no element holds, or assign over the element already there.');
	}

	write(node, slot, toCell(value));
};

/**
 * The position keys of an array, in order.
 *
 * Params:
 *   list: the array observable
 *
 * Returns: one key per element, so a caller can name a place rather than an index.
 *
 * Throws: `not-observable` when `list` is not an array observable.
 *
 * Example:
 *   const first = positionsOf(list)[0]; // survives edits elsewhere; list[0] does not
 */
export const positionsOf = (list: object): Position[] => {
	const node = nodeOf(list);
	if (node === undefined || node.kind !== 'array') {
		throw codecError('not-observable', 'positionsOf takes an array observable',
			'Pass what createArray returned.');
	}
	return node.order.map((slot) => assertPosition(bytesFromHex(slot)));
};

/**
 * Make an array observable.
 *
 * Params:
 *   items: the values it starts with
 *   id: its id, when it has to be a particular one. Minted otherwise
 *
 * Returns: a proxy that reads as an array. `map`, `filter`, `find`, `join`, iteration and
 * `length` all work. `push`, `pop`, `shift`, `unshift` and `splice` produce commits, and
 * `sort`, `reverse`, `fill` and `copyWithin` throw, because they cannot be expressed as
 * changes to the slots they appear to touch.
 *
 * Throws: `invalid-value`, `cell-in-document` or `inline-container` for an item a slot cannot
 * hold, `multiple-attach`, `unreachable` or `duplicate-id` for an observable that already
 * has a home or an id, and `invalid-id` for an id that is not twelve bytes.
 *
 * Attaching an observable that already has slots carries those slots in the same commit, one
 * delta for the attach and one for each slot under it, however deep. That is what lets a
 * replica be built from the commits alone: pushing a filled object sends its contents, not
 * just its id.
 *
 * Example:
 *   const blocks = createArray([createObject({ text: 'hi' })]);
 *   blocks.push(createObject({ text: 'there' }));
 */
export const createArray = <T = unknown>(items?: Iterable<T>, id?: Id): T[] => {
	const node = createNode('array', id);

	const methods: Record<string, unknown> = {
		push: (...values: unknown[]): number =>
			atomic(() => {
				insertRun(node, node.order.length, values);
				return node.order.length;
			}),

		pop: (): unknown => removeAt(node, node.order.length - 1),

		shift: (): unknown => removeAt(node, 0),

		unshift: (...values: unknown[]): number =>
			atomic(() => {
				insertRun(node, 0, values);
				return node.order.length;
			}),

		splice: (start = 0, count?: number, ...values: unknown[]): unknown[] =>
			atomic(() => {
				const length = node.order.length;
				const from = start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
				const take = count === undefined ? length - from : Math.min(Math.max(count, 0), length - from);

				// Back to front, so each removal shifts only the slots past the run: clearing a
				// list shifts nothing, where front to back shifted the whole remainder once per
				// row. Deltas in a commit are order-independent, so nothing else can tell.
				const removed: unknown[] = new Array<unknown>(take);
				for (let i = take - 1; i >= 0; i--) removed[i] = removeAt(node, from + i);

				insertRun(node, from, values);
				return removed;
			}),

		sort: () => unsupported('sort', 'Assign the order you want, or hold the sort outside the state.'),
		reverse: () => unsupported('reverse', 'Assign the order you want.'),
		fill: () => unsupported('fill', 'Assign the slots you mean.'),
		copyWithin: () => unsupported('copyWithin', 'Assign the slots you mean.'),
	};

	const proxy = new Proxy(node.values as T[], {
		get: (target, key, receiver) => {
			// Object.hasOwn, because a plain lookup would answer for `toString` and `constructor`
			// too, and hand back Object's version of a method the array already has.
			if (typeof key === 'string' && Object.hasOwn(methods, key)) return methods[key];
			return Reflect.get(target, key, receiver) as unknown;
		},

		set: (_target, key, value) => {
			if (typeof key === 'symbol') {
				throw codecError('invalid-key', `${String(key)} is not an array slot`,
					'Index the array with a number, and keep symbol-keyed data elsewhere.');
			}

			if (key === 'length') {
				const length = Number(value);
				if (!Number.isInteger(length) || length < 0 || length > node.order.length) {
					throw codecError('invalid-write', 'an array grows by inserting, not by its length',
						'Call push or splice to grow it; assign a smaller length to shorten it.');
				}
				atomic(() => {
					while (node.order.length > length) removeAt(node, node.order.length - 1);
				});
				return true;
			}

			const at = asIndex(key);
			if (at < 0) {
				throw codecError('invalid-key', `${key} is not an array index`,
					'Assign a whole number index of zero or more.');
			}

			const slot = node.order[at];
			if (slot !== undefined) {
				write(node, slot, toCell(value));
				return true;
			}
			if (at !== node.order.length) {
				throw codecError('invalid-write', 'an array has no gaps; push or splice instead',
					'Push the value on the end, or splice it in where you want it.');
			}

			place(node, positionAt(node, at - 1), null, value);
			return true;
		},

		deleteProperty: (_target, key) => {
			throw codecError(
				'invalid-write',
				`deleting ${String(key)} would leave a hole; splice it out instead`,
				'Call splice to take the element out and close the gap.',
			);
		},
	});

	register(proxy, node);

	if (items !== undefined) {
		let before: Position | null = null;
		for (const item of items) {
			before = between(before, null);
			plantCell(node, bytesToHex(before), toCell(item));
		}
	}

	return proxy;
};
