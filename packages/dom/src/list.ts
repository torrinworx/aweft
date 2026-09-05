// A list of mounts, kept in document order, edited by index and by key.
//
// Records form an intrusive doubly linked chain for anchoring (a record's anchor is the next
// record's first node) and sit in an array for index access. An edit is a run of steps; a
// value the run takes out and puts back keeps its mount and moves its nodes, so a swap moves
// two rows rather than rebuilding them and an input inside keeps its focus. Which order the
// steps name the two does not matter: mounting waits until every step has run, so the pool of
// detached records is complete before anything decides to build a row again.

import type { NodeLike, ParentLike } from './types.ts';

export interface Handle {
	/**
	 * The first live node, or null when the mount has none. Whoever asks falls through to the
	 * next mount itself, in a loop, so a long run of empty mounts costs no stack.
	 */
	first(): NodeLike | null;
	/** Unmount. With `gone`, the parent is already out of the tree, so leave the nodes alone. */
	remove(gone?: boolean): void;
	/** Take a new value in place. False means unmount and mount again. */
	update?(value: unknown): boolean;
}

export type Before = () => NodeLike | null;

export interface Step {
	readonly type: 'add' | 'replace' | 'remove';
	readonly at: number;
	readonly value?: unknown;
}

export interface Record {
	readonly value: unknown;
	handle: Handle | null;
	prev: Record | null;
	next: Record | null;
	/** The nodes captured when the record was detached, so a reuse can move them. */
	nodes: NodeLike[] | null;
	/** The run of new records this one was mounted in, until its first anchor is answered. */
	run: Run | null;
	runIndex: number;
}

/**
 * A run of records added in one pass. They mount in order, so when one asks for its anchor
 * the first time, none after it has inserted anything yet and the answer is the first node
 * past the run: one lookup instead of a walk over every record still waiting. The answer
 * holds while the chain is as it was (`epoch`) and no later member has asked (`maxAsked`).
 */
interface Run {
	readonly after: Record | null;
	readonly epoch: number;
	maxAsked: number;
}

export interface ListSpec {
	readonly elem: ParentLike;
	readonly before: Before;
	mountItem(value: unknown, before: Before): Handle;
}

export interface List {
	readonly records: Record[];
	first(): NodeLike | null;
	apply(steps: readonly Step[]): void;
	/** Diff a new sequence against the current one by reference, keeping matches. */
	setItems(next: Iterable<unknown>): void;
	removeAll(gone?: boolean): void;
}

export const createList = (spec: ListSpec): List => {
	const records: Record[] = [];
	/** Bumped on every change to the chain; a run's anchors are only trusted under its own. */
	let epoch = 0;

	/** The first node from `rec` onward, or the list's own anchor past the last record. */
	const firstFrom = (rec: Record | null): NodeLike | null => {
		for (let r = rec; r !== null; r = r.next) {
			const node = r.handle?.first() ?? null;
			if (node !== null) return node;
		}
		return spec.before();
	};

	const anchorOf = (rec: Record): Before => () => {
		const run = rec.run;
		if (run !== null) {
			const fresh = run.epoch === epoch && rec.runIndex > run.maxAsked;
			if (rec.runIndex > run.maxAsked) run.maxAsked = rec.runIndex;
			rec.run = null;
			if (fresh) return run.after === null ? spec.before() : firstFrom(run.after);
		}
		return firstFrom(rec.next);
	};

	const first = (): NodeLike | null => {
		const head = records[0];
		if (head === undefined) return null;
		const node = firstFrom(head);
		return node === spec.before() ? null : node;
	};

	/** The nodes between a record's first node and its anchor: what moving it must carry. */
	const nodesOf = (rec: Record): NodeLike[] => {
		const out: NodeLike[] = [];
		const start = rec.handle?.first() ?? null;
		if (start === null) return out;
		const end = anchorOf(rec)();
		for (let n: NodeLike | null = start; n !== null && n !== end; n = n.nextSibling) out.push(n);
		return out;
	};

	const link = (rec: Record, at: number): void => {
		epoch += 1;
		const prev = records[at - 1] ?? null;
		const next = records[at] ?? null;
		rec.prev = prev;
		rec.next = next;
		if (prev !== null) prev.next = rec;
		if (next !== null) next.prev = rec;
		records.splice(at, 0, rec);
	};

	/**
	 * Take a record out of the chain and its nodes out of the tree, keeping the nodes on the
	 * record. They leave the tree now so that a later capture, walking from a neighbour to its
	 * anchor, cannot cross them; a reuse puts them back where they belong.
	 */
	const unlink = (at: number): Record => {
		epoch += 1;
		const rec = records[at]!;
		rec.nodes = nodesOf(rec);
		for (const node of rec.nodes) spec.elem.removeChild(node);
		if (rec.prev !== null) rec.prev.next = rec.next;
		if (rec.next !== null) rec.next.prev = rec.prev;
		rec.prev = rec.next = null;
		records.splice(at, 1);
		return rec;
	};

	/** Put a record's captured nodes back in the tree, where it now sits in the chain. */
	const lay = (rec: Record): void => {
		if (rec.nodes === null) return;
		const anchor = anchorOf(rec)();
		for (const node of rec.nodes) spec.elem.insertBefore(node, anchor);
		rec.nodes = null;
	};

	const place = (rec: Record, at: number): void => {
		link(rec, at);
		lay(rec);
	};

	/** A record that has not mounted yet takes over a detached one's mount, and its nodes. */
	const adopt = (rec: Record, from: Record): void => {
		rec.handle = from.handle;
		rec.nodes = from.nodes;
		lay(rec);
	};

	/**
	 * New records linked in order, mounted in order, sharing one answer for their anchors.
	 *
	 * `at` is the epoch the run was closed at, not the one now: anything that relinked the
	 * chain since then may have put a record between two members, and the shared answer is
	 * only right while they are still next to each other.
	 */
	const mountRun = (run: readonly Record[], at: number): void => {
		const shared: Run = { after: run[run.length - 1]!.next, epoch: at, maxAsked: -1 };
		run.forEach((rec, i) => { rec.run = shared; rec.runIndex = i; });
		for (const rec of run) rec.handle = spec.mountItem(rec.value, anchorOf(rec));
	};

	const takeDetached = (detached: Map<unknown, Record[]>, value: unknown): Record | undefined => {
		const list = detached.get(value);
		const rec = list?.shift();
		if (list !== undefined && list.length === 0) detached.delete(value);
		return rec;
	};

	const detachInto = (detached: Map<unknown, Record[]>, at: number): void => {
		const rec = unlink(at);
		let list = detached.get(rec.value);
		if (list === undefined) {
			list = [];
			detached.set(rec.value, list);
		}
		list.push(rec);
	};

	const dropDetached = (detached: Map<unknown, Record[]>): void => {
		for (const list of detached.values()) {
			// Their nodes are already out; the mounts only let go of what they hold.
			for (const rec of list) rec.handle?.remove(true);
		}
		detached.clear();
	};

	/** Everything goes and nothing comes: clear the parent in one write when the list is all of it. */
	const clearsAll = (steps: readonly Step[]): boolean => {
		if (records.length === 0 || steps.length !== records.length) return false;
		for (const step of steps) if (step.type !== 'remove') return false;
		const elem = spec.elem;
		const head = first();
		return typeof elem.textContent === 'string' && head !== null && elem.firstChild === head && spec.before() === null;
	};

	const removeAll = (gone = false): void => {
		const dropped = records.splice(0, records.length);
		for (const rec of dropped) {
			rec.prev = rec.next = null;
			rec.handle?.remove(gone);
		}
	};

	const apply = (steps: readonly Step[]): void => {
		if (clearsAll(steps)) {
			spec.elem.textContent = '';
			removeAll(true);
			return;
		}

		const detached = new Map<unknown, Record[]>();
		const runs: Array<{ readonly records: Record[]; readonly epoch: number }> = [];
		let run: Record[] = [];
		let runEnd = -1;
		const close = (): void => {
			if (run.length === 0) return;
			runs.push({ records: run, epoch });
			run = [];
		};

		for (const step of steps) {
			if (step.type === 'remove') {
				close();
				detachInto(detached, step.at);
				continue;
			}
			if (step.type === 'replace') {
				close();
				detachInto(detached, step.at);
			}
			const reused = takeDetached(detached, step.value);
			if (reused !== undefined) {
				close();
				place(reused, step.at);
				continue;
			}
			if (run.length > 0 && step.at !== runEnd + 1) close();
			const rec: Record = { value: step.value, handle: null, prev: null, next: null, nodes: null, run: null, runIndex: 0 };
			link(rec, step.at);
			run.push(rec);
			runEnd = step.at;
		}
		close();

		// Every step has run, so the pool now holds everything this edit took out. A record
		// still waiting to mount whose value is in the pool was moved, not replaced, whichever
		// order the steps named the two: that is what makes a swap written as two replaces move
		// both rows instead of rebuilding one of them.
		for (const group of runs) {
			for (const rec of group.records) {
				const reused = takeDetached(detached, rec.value);
				if (reused !== undefined) adopt(rec, reused);
			}
		}

		// Mounting waits for the chain to settle, so every anchor is read from where the
		// records finally sit. A run splits at each record that adopted one, because the run's
		// shared anchor is only right for records that have put nothing in the tree yet.
		for (const group of runs) {
			let waiting: Record[] = [];
			for (const rec of group.records) {
				if (rec.handle === null) {
					waiting.push(rec);
					continue;
				}
				if (waiting.length > 0) {
					mountRun(waiting, group.epoch);
					waiting = [];
				}
			}
			if (waiting.length > 0) mountRun(waiting, group.epoch);
		}

		dropDetached(detached);
	};

	const setItems = (next: Iterable<unknown>): void => {
		const want = [...next];
		const have = new Map<unknown, Record[]>();
		for (const rec of records) {
			let list = have.get(rec.value);
			if (list === undefined) {
				list = [];
				have.set(rec.value, list);
			}
			list.push(rec);
		}

		if (want.length === 0) {
			apply(records.map((_, i) => ({ type: 'remove', at: records.length - 1 - i })));
			return;
		}

		// Decide the new order first, capturing every kept record's nodes while the old chain
		// still says where they end; then rebuild the chain and lay the nodes out from the back.
		const kept = new Set<Record>();
		const order: (Record | null)[] = want.map((value) => {
			const rec = takeDetached(have, value);
			if (rec === undefined) return null;
			kept.add(rec);
			return rec;
		});
		for (const rec of records) if (kept.has(rec)) rec.nodes = nodesOf(rec);
		const gone = records.filter((rec) => !kept.has(rec));

		records.length = 0;
		for (const rec of gone) {
			rec.prev = rec.next = null;
			rec.handle?.remove();
		}

		const fresh: Record[] = order.map((rec, i) =>
			rec ?? { value: want[i], handle: null, prev: null, next: null, nodes: null, run: null, runIndex: 0 });
		for (let i = 0; i < fresh.length; i++) {
			const rec = fresh[i]!;
			rec.prev = fresh[i - 1] ?? null;
			rec.next = fresh[i + 1] ?? null;
			records.push(rec);
		}

		let anchor = spec.before();
		for (let i = fresh.length - 1; i >= 0; i--) {
			const rec = fresh[i]!;
			if (rec.handle === null) {
				rec.handle = spec.mountItem(rec.value, anchorOf(rec));
			} else if (rec.nodes !== null) {
				const last = rec.nodes[rec.nodes.length - 1];
				if (last !== undefined && last.nextSibling !== anchor) {
					for (const node of rec.nodes) spec.elem.insertBefore(node, anchor);
				}
				rec.nodes = null;
			}
			const head = rec.handle.first();
			if (head !== null) anchor = head;
		}
	};

	return { records, first, apply, setItems, removeAll };
};

/** Where a hex slot key sits, or would sit, in a sorted list of them. */
export const seek = (keys: readonly string[], key: string): number => {
	let low = 0;
	let high = keys.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (keys[mid]! < key) low = mid + 1;
		else high = mid;
	}
	return low;
};

export const hex = (bytes: Uint8Array): string => {
	let out = '';
	for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16);
	return out;
};
