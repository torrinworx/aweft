// G3: which grain the DOM binding consumes efficiently, and what the binding costs over it.
//
// A list of rows under the row-table operations every framework benchmark uses, four ways of
// hearing a change, and the shipped binding on the light tree beside them:
//
//   direct    the floor: the same operations with the anchor already known, no core at all
//   commit    the commit grain, resolved by an index the binding keeps: a sorted array of the
//             position keys as hex, binary searched
//   naive     the commit grain resolved with `positionsOf` per delta, the only order of
//             positions core exports
//   value     the value grain: a cell holding a plain array replaced on every edit, diffed by
//             reference
//   binding   `mount(ul, h(Row, { each: rows }))` on the light tree, which is the commit
//             grain plus everything a real row costs
//
// The fake DOM for the four grains is a doubly linked list with O(1) insert and remove, so the
// numbers are the binding's cost and not the fake's. The light tree is the same shape.
//
// Run: node bench/dom-grain.ts
//
// CI does not gate on this. A performance claim cites this script and its recorded output.

import { atomic, createArray, createObject, mutable, observer, positionsOf } from '@aweftjs/core';
import type { Change } from '@aweftjs/core';
import { createDocument, h, mount } from '@aweftjs/dom';

interface FakeNode { parent: FakeNode | null; prev: FakeNode | null; next: FakeNode | null; first: FakeNode | null; last: FakeNode | null; data: string; }

const node = (data = ''): FakeNode => ({ parent: null, prev: null, next: null, first: null, last: null, data });

const removeChild = (parent: FakeNode, child: FakeNode): void => {
	if (child.prev !== null) child.prev.next = child.next; else parent.first = child.next;
	if (child.next !== null) child.next.prev = child.prev; else parent.last = child.prev;
	child.parent = child.prev = child.next = null;
};

const insertBefore = (parent: FakeNode, child: FakeNode, before: FakeNode | null): void => {
	if (child.parent !== null) removeChild(child.parent, child);
	child.parent = parent;
	child.next = before;
	child.prev = before === null ? parent.last : before.prev;
	if (child.prev !== null) child.prev.next = child; else parent.first = child;
	if (before !== null) before.prev = child; else parent.last = child;
};

const clear = (parent: FakeNode): void => { parent.first = parent.last = null; };

// `prepare` puts the state back before each step and is not timed, so a clear is a clear and
// not a clear plus the refill.
const measure = (label: string, runs: number, step: (i: number) => void, per = 1, prepare?: (i: number) => void): void => {
	const once = (i: number): bigint => {
		prepare?.(i);
		const started = process.hrtime.bigint();
		step(i);
		return process.hrtime.bigint() - started;
	};
	for (let i = 0; i < Math.max(3, runs / 5); i++) once(i);
	let best = Infinity;
	for (let attempt = 0; attempt < 3; attempt++) {
		let took = 0n;
		for (let i = 0; i < runs; i++) took += once(i);
		const ms = Number(took) / 1e6;
		if (ms < best) best = ms;
	}
	console.log(`  ${label.padEnd(44)} ${((best / runs / per) * 1000).toFixed(3).padStart(10)} us`);
};

const hex = (bytes: Uint8Array): string => {
	let out = '';
	for (const b of bytes) out += (b < 16 ? '0' : '') + b.toString(16);
	return out;
};

const seek = (keys: string[], key: string): number => {
	let low = 0;
	let high = keys.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (keys[mid]! < key) low = mid + 1; else high = mid;
	}
	return low;
};

interface Row extends Record<string, unknown> { label?: string }
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ label: `row ${i}` }));
const observables = (n: number): Row[] => rows(n).map((r) => createObject<Row>(r));

// The commit grain with a binding-kept index: the design the shipped binding uses.
const commitBinding = (list: Row[], parent: FakeNode) => {
	const keys: string[] = [];
	const mounts = new Map<string, FakeNode>();
	const apply = (change: Change): void => {
		const removed: string[] = [];
		const added: string[] = [];
		for (const d of change.deltas) {
			if (d.ref.kind !== 'array') continue;
			const key = hex(d.ref.key);
			if (d.type !== 'add') removed.push(key);
			if (d.type !== 'remove') added.push(key);
		}
		if (removed.length === keys.length && added.length === 0) {
			clear(parent);
			keys.length = 0;
			mounts.clear();
		} else {
			for (const key of removed) {
				removeChild(parent, mounts.get(key)!);
				mounts.delete(key);
				keys.splice(seek(keys, key), 1);
			}
		}
		if (added.length > 1) added.sort();
		for (const key of added) {
			const at = seek(keys, key);
			const before = at < keys.length ? mounts.get(keys[at]!)! : null;
			const n = node(list[at]!.label);
			insertBefore(parent, n, before);
			mounts.set(key, n);
			keys.splice(at, 0, key);
		}
	};
	return observer(list).shallow().watch(apply);
};

// The commit grain resolved with positionsOf per delta.
const naiveBinding = (list: Row[], parent: FakeNode) => {
	const mounts = new Map<string, FakeNode>();
	const apply = (change: Change): void => {
		const added: Uint8Array[] = [];
		for (const d of change.deltas) {
			if (d.ref.kind !== 'array') continue;
			if (d.type !== 'add') {
				const key = hex(d.ref.key);
				removeChild(parent, mounts.get(key)!);
				mounts.delete(key);
			}
			if (d.type !== 'remove') added.push(d.ref.key);
		}
		if (added.length === 0) return;
		const positions = positionsOf(list).map(hex);
		for (const key of added.map(hex).sort()) {
			const at = positions.indexOf(key);
			let before: FakeNode | null = null;
			for (let i = at + 1; i < positions.length; i++) {
				const m = mounts.get(positions[i]!);
				if (m !== undefined) { before = m; break; }
			}
			const n = node(list[at]!.label);
			insertBefore(parent, n, before);
			mounts.set(key, n);
		}
	};
	return observer(list).shallow().watch(apply);
};

// The value grain: the whole array replaced, diffed by reference.
const valueBinding = (cell: { watch(fn: (v: Row[]) => void): () => void; get(): Row[] }, parent: FakeNode) => {
	let mounts = new Map<Row, FakeNode>();
	const apply = (next: Row[]): void => {
		const keep = new Map<Row, FakeNode>();
		if (next.length === 0) { clear(parent); mounts = keep; return; }
		for (const row of next) { const m = mounts.get(row); if (m !== undefined) keep.set(row, m); }
		for (const [row, m] of mounts) if (!keep.has(row)) removeChild(parent, m);
		let cursor = parent.first;
		for (const row of next) {
			let m = keep.get(row);
			if (m === undefined) { m = node(row.label); keep.set(row, m); insertBefore(parent, m, cursor); }
			else if (m !== cursor) insertBefore(parent, m, cursor);
			else cursor = cursor.next;
		}
		mounts = keep;
	};
	const stop = cell.watch(apply);
	apply(cell.get());
	return stop;
};

const RowComponent = ({ each }: { each: Row }) => h('li', {}, observer(each).path('label'));

for (const N of [1000, 10000]) {
	console.log(`\n# ${N} rows, microseconds per operation (per row for create and append)`);

	console.log('\n## direct, the floor');
	{
		const parent = node();
		const nodes: FakeNode[] = [];
		measure(`create ${N}`, 20, () => { for (let i = 0; i < N; i++) { const n = node('r'); insertBefore(parent, n, null); nodes.push(n); } }, N, () => { clear(parent); nodes.length = 0; });
		measure('insert middle', 2000, (i) => { insertBefore(parent, node('r'), nodes[(i * 7919) % nodes.length]!); });
		measure('remove one', 2000, (i) => { removeChild(parent, nodes[(i * 7919) % nodes.length]!); }, 1, (i) => { const n = nodes[(i * 7919) % nodes.length]!; if (n.parent === null) insertBefore(parent, n, null); });
		measure('swap two', 2000, () => { const a = nodes[1]!; const b = nodes[nodes.length - 2]!; const an = a.next; const bn = b.next; insertBefore(parent, a, bn); insertBefore(parent, b, an === a ? b : an); });
	}

	console.log('\n## commit grain, binding-kept index');
	{
		const list = createArray<Row>();
		const parent = node();
		const stop = commitBinding(list, parent);
		measure(`create ${N} (one commit)`, 10, () => { list.push(...observables(N)); }, N, () => { list.splice(0, list.length); });
		measure('insert middle', 2000, (i) => { list.splice((i * 7919) % list.length, 0, createObject<Row>({ label: 'x' })); }, 1, () => { if (list.length > N) list.pop(); });
		measure('remove one', 2000, (i) => { list.splice((i * 7919) % list.length, 1); }, 1, () => { if (list.length < N) list.push(createObject<Row>({ label: 'x' })); });
		measure('swap two (atomic)', 2000, () => { atomic(() => { const t = list[1]!; list[1] = list[list.length - 2]!; list[list.length - 2] = t; }); });
		measure('clear (one commit)', 10, () => { list.splice(0, list.length); }, 1, () => { list.push(...observables(N)); });
		stop();
	}

	console.log('\n## the shipped binding, on the light tree');
	{
		const doc = createDocument();
		const list = createArray<Row>(observables(N));
		const ul = doc.createElement('ul');
		const stop = mount(ul, h(RowComponent, { each: list }));
		measure(`create ${N} (one commit)`, N > 1000 ? 3 : 10, () => { list.push(...observables(N)); }, N, () => { list.splice(0, list.length); });
		measure('insert middle', 2000, (i) => { list.splice((i * 7919) % list.length, 0, createObject<Row>({ label: 'x' })); }, 1, () => { if (list.length > N) list.pop(); });
		measure('remove one', 2000, (i) => { list.splice((i * 7919) % list.length, 1); }, 1, () => { if (list.length < N) list.push(createObject<Row>({ label: 'x' })); });
		measure('swap two (atomic)', 2000, () => { atomic(() => { const t = list[1]!; list[1] = list[list.length - 2]!; list[list.length - 2] = t; }); });
		measure('update every 10th label', 50, (i) => { for (let k = 0; k < list.length; k += 10) list[k]!.label = `r ${i}`; }, N / 10);
		measure('clear (one commit)', N > 1000 ? 3 : 10, () => { list.splice(0, list.length); }, 1, () => { list.push(...observables(N)); });
		stop();
	}

	if (N === 1000) {
		console.log('\n## commit grain, resolved with positionsOf per delta');
		const list = createArray<Row>();
		const parent = node();
		const stop = naiveBinding(list, parent);
		measure(`create ${N} (one commit)`, 3, () => { list.push(...observables(N)); }, N, () => { list.splice(0, list.length); });
		measure('insert middle', 200, (i) => { list.splice((i * 7919) % list.length, 0, createObject<Row>({ label: 'x' })); }, 1, () => { if (list.length > N) list.pop(); });
		measure('remove one', 200, (i) => { list.splice((i * 7919) % list.length, 1); }, 1, () => { if (list.length < N) list.push(createObject<Row>({ label: 'x' })); });
		stop();
	}

	console.log('\n## value grain, the array replaced and diffed by reference');
	{
		const cell = mutable<Row[]>([]);
		const parent = node();
		const stop = valueBinding(cell, parent);
		const base = rows(N);
		measure(`create ${N}`, 20, () => { cell.set(rows(N)); }, N, () => { cell.set([]); });
		measure('insert middle', 200, (i) => { const at = (i * 7919) % base.length; cell.set([...base.slice(0, at), { label: 'x' }, ...base.slice(at)]); }, 1, () => { cell.set(base); });
		measure('remove one', 200, (i) => { const at = (i * 7919) % base.length; cell.set([...base.slice(0, at), ...base.slice(at + 1)]); }, 1, () => { cell.set(base); });
		measure('swap two', 200, () => { const next = [...cell.get()]; const t = next[1]!; next[1] = next[next.length - 2]!; next[next.length - 2] = t; cell.set(next); });
		stop();
	}
}
