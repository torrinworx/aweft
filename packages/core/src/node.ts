// The structure under an observable: slots, the one attach edge, and the document index.
//
// Everything here is mechanical. It moves cells, parents and index entries, and it never
// produces a delta and never calls user code. The transaction decides what a change means;
// this file is what a change is made of.

import {
	type ObservableKind, type Ref, type Value,
	bytesFromHex, bytesToHex, codecError, createId, equalBytes, idFromText, idToText,
} from '@aweftjs/codec';

import type { Cell, Listener, Node } from './types.ts';

export const createNode = (kind: ObservableKind, id: Uint8Array = createId()): Node => {
	const node: Node = {
		id,
		key: idToText(id),
		kind,
		slots: new Map(),
		order: [],
		values: [],
		listeners: new Set(),
		proxy: undefined as unknown as object,
		parent: null,
		slot: null,
		root: undefined as unknown as Node,
		index: null,
		watchers: 0,
	};

	// A new observable is a document of one until something attaches it.
	node.root = node;
	node.index = new Map([[node.key, node]]);
	return node;
};

/** The slot key an array position, map identity or object key is filed under. */
export const slotKeyOf = (ref: Ref): string => {
	if (ref.kind === 'object') return ref.key;
	if (ref.kind === 'array') return bytesToHex(ref.key);
	return idToText(ref.key);
};

/** The reverse: the ref a delta carries for one of this observable's slots. */
export const slotRef = (node: Node, slot: string): Ref => {
	if (node.kind === 'object') return { kind: 'object', key: slot };
	if (node.kind === 'array') return { kind: 'array', key: bytesFromHex(slot) };
	return { kind: 'map', key: idFromText(slot) };
};

/** What a delta carries for this cell: the primitive itself, or the name of an observable. */
export const cellValue = (cell: Cell): Value =>
	cell.kind === 'value' ? cell.value : { edge: cell.edge, kind: cell.node.kind, id: cell.node.id };

/** What a reader sees: the primitive, or the observable's proxy. */
export const userValue = (cell: Cell | undefined): unknown => {
	if (cell === undefined) return undefined;
	return cell.kind === 'value' ? cell.value : cell.node.proxy;
};

/**
 * Do two cells hold the same thing?
 *
 * Coalescing omits a slot whose net effect over a window is no change, and this is the test
 * for that. Byte strings compare by content, because two byte strings holding the same bytes
 * are the same value to the format.
 */
export const sameCell = (a: Cell | undefined, b: Cell | undefined): boolean => {
	if (a === undefined || b === undefined) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === 'ref' && b.kind === 'ref') return a.node === b.node && a.edge === b.edge;

	const x = (a as { value: unknown }).value;
	const y = (b as { value: unknown }).value;
	if (x instanceof Uint8Array && y instanceof Uint8Array) return equalBytes(x, y);
	return Object.is(x, y);
};

/** Where a slot key sits, or would sit, in an array's order. Hex sorts as its bytes do. */
const seek = (order: readonly string[], slot: string): number => {
	let low = 0;
	let high = order.length;

	while (low < high) {
		const mid = (low + high) >> 1;
		if (order[mid]! < slot) low = mid + 1;
		else high = mid;
	}
	return low;
};

export const indexOfSlot = (node: Node, slot: string): number => {
	const at = seek(node.order, slot);
	return at < node.order.length && node.order[at] === slot ? at : -1;
};

/**
 * Put a cell in a slot, or clear it. Structure only: no delta, no listener, no checks.
 *
 * An array keeps two parallel views of itself, the slot keys in position order and the values
 * the proxy hands out, and they are written together here so nothing else has to remember to.
 */
export const setCell = (node: Node, slot: string, cell: Cell | undefined): void => {
	const had = node.slots.has(slot);

	if (cell === undefined) {
		if (!had) return;
		node.slots.delete(slot);
		if (node.kind === 'array') {
			const at = indexOfSlot(node, slot);
			node.order.splice(at, 1);
			node.values.splice(at, 1);
		}
		return;
	}

	node.slots.set(slot, cell);
	if (node.kind !== 'array') return;

	if (had) {
		node.values[indexOfSlot(node, slot)] = userValue(cell);
		return;
	}

	const at = seek(node.order, slot);
	node.order.splice(at, 0, slot);
	node.values.splice(at, 0, userValue(cell));
};

/**
 * Put a cell in a slot while an observable is being built, before anything can watch it.
 *
 * Construction is not a mutation: a fresh observable belongs to no document, so there is
 * nothing to tell and no commit to open. The attach rules still hold, and are checked here.
 */
export const plantCell = (node: Node, slot: string, cell: Cell): void => {
	if (cell.kind === 'ref' && cell.edge === 'attach') {
		if (cell.node.parent !== null) {
			throw codecError(
				'multiple-attach',
				`${cell.node.key} is already attached, and an observable lives in one place`,
			);
		}
		if (isAncestor(cell.node, node)) {
			throw codecError('unreachable', `${cell.node.key} cannot be attached inside itself`);
		}
		attachNode(cell.node, node, slot);
	}

	setCell(node, slot, cell);
};

/** What a scope step or a path step names here: an array index means whichever slot sits
 * there now, since positions are what an array is really keyed by. */
export const resolveKey = (node: Node, key: string | number): string => {
	if (typeof key !== 'number') return key;
	if (node.kind !== 'array') return String(key);
	return node.order[key] ?? '';
};

/** Walk a node and everything attached below it, without recursion. */
export const walk = (node: Node, visit: (n: Node) => void): void => {
	const stack = [node];

	while (stack.length > 0) {
		const current = stack.pop()!;
		visit(current);

		for (const cell of current.slots.values()) {
			// An alias names an observable that lives elsewhere, and a node that has been
			// re-homed inside this same block no longer belongs to the slot still naming it.
			if (cell.kind === 'ref' && cell.edge === 'attach' && cell.node.parent === current) {
				stack.push(cell.node);
			}
		}
	}
};

/** The top of a node's attach chain. It is the document root when the node is reachable. */
export const anchorOf = (node: Node): Node => {
	let at = node;
	while (at.parent !== null) at = at.parent;
	return at;
};

export const isReachable = (node: Node): boolean => anchorOf(node) === node.root;

/** Is `maybe` at or above `node` in the attach tree? Attaching into one's own subtree is not. */
export const isAncestor = (maybe: Node, node: Node): boolean => {
	let at: Node | null = node;
	while (at !== null) {
		if (at === maybe) return true;
		at = at.parent;
	}
	return false;
};

/**
 * Move a subtree into a document.
 *
 * Index entries, roots and the listener count all move together, so a root always knows every
 * observable in its document and whether anything is watching it.
 */
export const reroot = (child: Node, root: Node): void => {
	const old = child.root;
	if (old === root) return;

	if (root === child && child.index === null) child.index = new Map();
	const index = root.index!;
	let moved = 0;

	walk(child, (node) => {
		const taken = index.get(node.key);
		if (taken !== undefined && taken !== node) {
			throw codecError('duplicate-id', `${node.key} is already in this document`);
		}

		old.index?.delete(node.key);
		index.set(node.key, node);
		if (node !== root) node.index = null;
		node.root = root;
		moved += node.listeners.size;
	});

	old.watchers -= moved;
	root.watchers += moved;
};

/**
 * Give `child` its one attach edge.
 *
 * The caller has already decided this is legal. An observable joins the parent's document
 * here, with everything attached below it.
 */
export const attachNode = (child: Node, parent: Node, slot: string): void => {
	reroot(child, parent.root);
	child.parent = parent;
	child.slot = slot;
};

/**
 * Take away a node's attach edge.
 *
 * The node stays in the document and stays indexed. Nothing reaches it, and a delta naming it
 * is refused as unreachable, which is exactly what a receiver does with the same commit. What
 * becomes of it after that is open in `spec/format.md` 8.
 */
export const detachNode = (child: Node): void => {
	child.parent = null;
	child.slot = null;
};

export const addListener = (node: Node, listener: Listener): void => {
	node.listeners.add(listener);
	node.root.watchers += 1;
};

export const removeListener = (node: Node, listener: Listener): void => {
	if (!node.listeners.delete(listener)) return;
	node.root.watchers -= 1;
};

/** Find an observable of this document by id. */
export const lookup = (root: Node, key: string): Node | undefined => root.index?.get(key);
