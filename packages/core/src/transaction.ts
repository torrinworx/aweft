// What a change is: when a commit closes, what it contains, and who hears about it.
//
// A mutation takes effect in the tree as it is written, and its delta is recorded. One
// mutation closes a commit; `atomic` holds the commit open across everything inside it
// (design 015). Records are keyed by slot, so coalescing is what the map does rather than
// something a pass has to get right afterwards, and the same records carry the prior values
// the inverse is built from (design 016).

import {
	type Delta, type Value,
	codecError, compareDeltas,
} from '@aweftjs/codec';

import type { Cell, Change, Listener, Node } from './types.ts';
import { stamp } from './clock.ts';
import {
	anchorOf, attachNode, cellValue, detachNode, isAncestor, reroot, resolveKey, sameCell,
	setCell, slotRef,
} from './node.ts';

interface Touch {
	readonly node: Node;
	readonly slot: string;
	/** What the slot held when this block first touched it. Restores it, and inverts it. */
	readonly prior: Cell | undefined;
	/** Set when the slot arrived with an observable joining the document, so it is an add. */
	fresh: boolean;
}

interface Move {
	readonly node: Node;
	readonly from: Node;
	readonly slot: string;
}

let depth = 0;
let touched = new Map<string, Touch>();
let undos: Array<() => void> = [];
let moves: Move[] = [];
/** Observables that joined a document inside this block, and ones that lost their edge. */
let entered = new Set<Node>();
let left = new Map<Node, Move>();

let draining = false;
const queue: Array<() => void> = [];

const reset = (): void => {
	touched = new Map();
	undos = [];
	moves = [];
	entered = new Set();
	left = new Map();
};

const rollback = (): void => {
	for (let i = undos.length - 1; i >= 0; i--) undos[i]!();
};

const touchKey = (node: Node, slot: string): string => `${node.key} ${slot}`;

const record = (node: Node, slot: string, fresh: boolean): void => {
	const key = touchKey(node, slot);
	const seen = touched.get(key);

	if (seen !== undefined) {
		// The first touch holds the prior value, so a slot written twice still inverts to what
		// it held before the block. Joining a document later still makes the slot an add.
		if (fresh) seen.fresh = true;
		return;
	}

	touched.set(key, { node, slot, prior: node.slots.get(slot), fresh });
};

/** Every slot of a subtree arriving in a document is new to it, however old the subtree is. */
const materialize = (child: Node): void => {
	const stack = [child];

	while (stack.length > 0) {
		const node = stack.pop()!;
		for (const [slot, cell] of node.slots) {
			record(node, slot, true);
			if (cell.kind === 'ref' && cell.edge === 'attach' && cell.node.parent === node) {
				stack.push(cell.node);
			}
		}
	}
};

/** Give an observable its attach edge here, moving it if it had one somewhere else. */
const claim = (child: Node, parent: Node, slot: string): void => {
	if (isAncestor(child, parent)) {
		throw codecError('unreachable', `${child.key} cannot be attached inside itself`);
	}

	const root = parent.root;
	const known = root.index?.get(child.key) === child;
	const from = child.parent;
	const fromSlot = child.slot;
	const wasRoot = child.root;

	if (from !== null) moves.push({ node: child, from, slot: fromSlot! });

	attachNode(child, parent, slot);
	undos.push(() => {
		reroot(child, wasRoot);
		child.parent = from;
		child.slot = fromSlot;
		if (from !== null) moves.pop();
	});

	if (!known) {
		entered.add(child);
		materialize(child);
	}
};

/** Take an observable's attach edge away, unless something already re-homed it. */
const release = (child: Node, from: Node, slot: string): void => {
	if (child.parent !== from || child.slot !== slot) return;

	detachNode(child);
	left.set(child, { node: child, from, slot });
	undos.push(() => {
		child.parent = from;
		child.slot = slot;
		left.delete(child);
	});
};

/**
 * Write one slot, and let the commit machinery see it.
 *
 * This is the only way state changes. Everything the three observable kinds do is a sequence
 * of these, which is why coalescing, inversion, attach bookkeeping and delivery are decided
 * in one place instead of once per kind.
 */
export const write = (node: Node, slot: string, next: Cell | undefined): void => {
	mutate(() => {
		const prior = node.slots.get(slot);
		if (sameCell(prior, next)) return;

		record(node, slot, false);

		if (next !== undefined && next.kind === 'ref' && next.edge === 'attach') {
			claim(next.node, node, slot);
		}

		setCell(node, slot, next);
		undos.push(() => setCell(node, slot, prior));

		if (prior !== undefined && prior.kind === 'ref' && prior.edge === 'attach') {
			const kept = next !== undefined && next.kind === 'ref' && next.node === prior.node;
			if (!kept) release(prior.node, node, slot);
		}
	});
};

/** Run one mutation, closing the commit unless a block is already open. */
export const mutate = (run: () => void): void => {
	if (depth > 0) {
		run();
		return;
	}

	depth = 1;
	try {
		run();
	} catch (error) {
		depth = 0;
		rollback();
		reset();
		throw error;
	}

	depth = 0;
	close();
};

/**
 * Make everything inside one commit.
 *
 * Params:
 *   run: the mutations. Nesting joins the block already open and closes with it.
 *
 * Returns: whatever `run` returned.
 *
 * Throws: whatever `run` threw, after rolling every mutation it made back out of the tree.
 * Nothing is emitted and no watcher is called.
 *
 * Example:
 *   atomic(() => { doc.width = 3; doc.height = 4; });
 */
export const atomic = <T>(run: () => T): T => {
	depth += 1;

	let out: T;
	try {
		out = run();
	} catch (error) {
		depth -= 1;
		if (depth === 0) {
			rollback();
			reset();
		}
		throw error;
	}

	depth -= 1;

	// A commit closes when the block returns, so anything the block awaits would land in a
	// commit the author never asked for. Say so rather than let it be discovered.
	if (out !== null && typeof (out as { then?: unknown } | null)?.then === 'function') {
		if (depth === 0) {
			rollback();
			reset();
		}
		throw codecError('async-atomic', 'an atomic block is synchronous and cannot return a promise');
	}

	if (depth === 0) close();
	return out;
};

// --- closing ---------------------------------------------------------------------------

interface Entry {
	readonly delta: Delta;
	readonly inverse: Delta;
	readonly node: Node;
	readonly slot: string;
}

const entryFor = (touch: Touch): Entry | null => {
	const node = touch.node;
	const current = node.slots.get(touch.slot);
	const existed = !touch.fresh && touch.prior !== undefined;
	const exists = current !== undefined;

	if (!existed && !exists) return null;
	if (existed && exists && sameCell(touch.prior, current)) return null;

	const ref = slotRef(node, touch.slot);
	const id = node.id;
	const shared = { node, slot: touch.slot };

	const before = (): Value => cellValue(touch.prior!);
	const now = (): Value => cellValue(current!);

	if (!existed) {
		return {
			...shared,
			delta: { type: 'add', id, ref, value: now() },
			inverse: { type: 'remove', id, ref },
		};
	}
	if (!exists) {
		return {
			...shared,
			delta: { type: 'remove', id, ref },
			inverse: { type: 'add', id, ref, value: before() },
		};
	}
	return {
		...shared,
		delta: { type: 'replace', id, ref, value: now() },
		inverse: { type: 'replace', id, ref, value: before() },
	};
};

/**
 * Is a delta about this observable one a receiver could apply?
 *
 * Reachability is judged against the document as it was, extended by the attach edges this
 * commit adds, which is the rule in `spec/format.md` 1.1. So writing into a subtree while
 * detaching it is fine, and writing into one an earlier commit detached is not.
 */
const admits = (node: Node): 'keep' | 'drop' => {
	const anchor = anchorOf(node);
	if (anchor === node.root) return 'keep';
	if (entered.has(anchor)) return 'drop';
	if (left.has(anchor)) return 'keep';

	throw codecError('unreachable', `${node.key} has no attach path from the root`);
};

const checkMoves = (): void => {
	for (const move of moves) {
		const cell = move.from.slots.get(move.slot);

		if (cell !== undefined && cell.kind === 'ref' && cell.edge === 'attach' && cell.node === move.node) {
			throw codecError(
				'multiple-attach',
				`${move.node.key} would have two attach edges, and an observable lives in one place`,
			);
		}
	}
};

const inScope = (
	listener: Listener,
	chain: readonly Node[],
	slots: readonly string[],
	base: number,
	last: string,
): boolean => {
	if (listener.wild) return wildScope(listener, chain, slots, base, last);

	const reach = base + 1;
	const keys = listener.keys as readonly (string | number)[];
	if (keys.length > reach) return false;
	if (listener.shallow && reach !== keys.length + 1) return false;

	// Step j of the path is the slot chain[base - j] sits in, and the last step is the slot
	// the delta itself names. Spelled inline: this is the hottest comparison in the stack.
	for (let j = 0; j < keys.length; j++) {
		const step = j < base ? slots[base - 1 - j]! : last;
		if (step !== resolveKey(chain[base - j]!, keys[j]!)) return false;
	}

	if (listener.ignore.length > 0 && reach > keys.length) {
		const next = keys.length < base ? slots[base - 1 - keys.length]! : last;
		const node = chain[base - keys.length]!;
		for (const key of listener.ignore) {
			if (next === resolveKey(node, key)) return false;
		}
	}

	return true;
};

/**
 * The matcher for a scope with a wildcard in it. A wildcard pattern can end at more than
 * one depth, so this backtracks: any way of consuming the whole pattern that the filters
 * accept is a match (design 025). Only scopes that use wildcards pay for it.
 */
const wildScope = (
	listener: Listener,
	chain: readonly Node[],
	slots: readonly string[],
	base: number,
	last: string,
): boolean => {
	const reach = base + 1;
	const keys = listener.keys;

	const step = (j: number): string => (j < base ? slots[base - 1 - j]! : last);
	const holder = (j: number): Node => chain[base - j]!;

	// Where a full match ends decides the rest: shallow measures from it, and ignore reads
	// the step just past it.
	const accept = (consumed: number): boolean => {
		if (listener.shallow && reach !== consumed + 1) return false;

		if (listener.ignore.length > 0 && reach > consumed) {
			const next = step(consumed);
			const node = holder(consumed);
			for (const key of listener.ignore) {
				if (next === resolveKey(node, key)) return false;
			}
		}
		return true;
	};

	// A leading underscore on an object slot is runtime-private from wildcards: a wildcard
	// step never consumes it, and only a scope that names it explicitly sees under it.
	const open = (j: number): boolean =>
		!(holder(j).kind === 'object' && step(j).startsWith('_'));

	const fits = (j: number, k: number): boolean => {
		if (j === keys.length) return accept(k);
		if (k >= reach) return false;

		const key = keys[j]!;
		if (typeof key !== 'object') {
			return step(k) === resolveKey(holder(k), key) && fits(j + 1, k + 1);
		}
		if ('any' in key) return open(k) && fits(j + 1, k + 1);

		for (let m = k; m < reach; m++) {
			// The named key itself is explicit and may be private; the run of steps a deep
			// wildcard swallows on the way to it may not.
			if (step(m) === resolveKey(holder(m), key.deep) && fits(j + 1, m + 1)) return true;
			if (!open(m)) return false;
		}
		return false;
	};

	return fits(0, 0);
};

const collect = (entry: Entry, out: Map<Listener, Entry[]>): void => {
	// The chain from the delta's target up to the top of its attach path, with the slot each
	// step sits in. A scope is a prefix of that path read back down.
	const chain: Node[] = [];
	const slots: string[] = [];

	let at: Node | null = entry.node;
	while (at !== null) {
		chain.push(at);

		if (at.parent !== null) {
			slots.push(at.slot!);
			at = at.parent;
			continue;
		}

		// A subtree this commit detached is walked through the edge it had when the commit
		// began. The delta is legal, a receiver will apply it, and the scope that held the
		// subtree is the one that has to hear about it.
		const gone: Move | undefined = left.get(at);
		if (gone === undefined) break;

		slots.push(gone.slot);
		at = gone.from;
	}

	for (let i = 0; i < chain.length; i++) {
		const base = chain[i]!;
		if (base.listeners.size === 0) continue;

		for (const listener of base.listeners) {
			if (!inScope(listener, chain, slots, i, entry.slot)) continue;
			const list = out.get(listener);
			if (list === undefined) out.set(listener, [entry]);
			else list.push(entry);
		}
	}
};

const deliveries = (): Array<() => void> => {
	const byRoot = new Map<Node, Entry[]>();

	for (const touch of touched.values()) {
		if (admits(touch.node) === 'drop') continue;
		if (touch.node.root.watchers === 0) continue;

		const entry = entryFor(touch);
		if (entry === null) continue;

		const root = touch.node.root;
		const list = byRoot.get(root);
		if (list === undefined) byRoot.set(root, [entry]);
		else list.push(entry);
	}

	const jobs: Array<() => void> = [];

	for (const entries of byRoot.values()) {
		// One mutation is one commit, so most commits carry one delta and there is nothing to
		// order. Ordering is what the format says a commit is written in, and it costs a
		// comparison per pair rather than an encoded key per delta.
		if (entries.length > 1) entries.sort((a, b) => compareDeltas(a.delta, b.delta));

		const perListener = new Map<Listener, Entry[]>();
		for (const entry of entries) collect(entry, perListener);

		for (const [listener, matched] of perListener) {
			const deltas = matched.map((e) => e.delta);
			const inverses = matched.map((e) => e.inverse);
			jobs.push(() => listener.deliver(deltas, inverses));
		}
	}

	return jobs;
};

const close = (): void => {
	let jobs: Array<() => void>;

	try {
		checkMoves();
		jobs = deliveries();
	} catch (error) {
		rollback();
		reset();
		throw error;
	}

	// Nothing about the block may still be open when user code runs, because that code is free
	// to mutate, and its mutations are a commit of their own.
	reset();
	stamp();
	dispatch(jobs);
};

/**
 * Hand changes to user code, one listener at a time, never during a walk.
 *
 * A listener that mutates produces a commit of its own, which lands at the back of this queue
 * rather than reentering the delivery it is inside.
 */
export const dispatch = (jobs: readonly (() => void)[]): void => {
	for (const job of jobs) queue.push(job);
	if (draining) return;

	draining = true;
	let failure: unknown;
	let failed = false;

	try {
		while (queue.length > 0) {
			try {
				queue.shift()!();
			} catch (error) {
				// One listener throwing must not decide whether the others hear the commit. The
				// first error still reaches whoever made the mutation, once everyone has been told.
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		}
	} finally {
		draining = false;
		queue.length = 0;
	}

	if (failed) throw failure;
};

/** The change a listener is handed. The inverse waits until something asks for it. */
export const changeOf = (deltas: readonly Delta[], inverses: readonly Delta[]): Change => ({
	deltas,
	inverse: () => ({ deltas: inverses }),
});
