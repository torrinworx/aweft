// G2: what derived value propagation costs, and which design core should use for it.
//
// Two candidate designs, measured on four graph shapes and against the current generation of
// signal libraries when they are installed. Nothing here is part of any package. It exists so
// the numbers behind a design choice can be re-run rather than believed.
//
// Run: node bench/derived.ts
// With the comparison: npm i --no-save alien-signals @preact/signals-core @vue/reactivity
//
// CI does not gate on this. A performance claim cites this script and its recorded output.

// --- A: recompute on read ---------------------------------------------------------------
//
// A derived value has no cache, so reading it computes it. Caching is something the author
// asks for. This is the cheapest thing that can work, and the shapes below say where it stops
// working.

interface Lazy {
	readonly src: boolean;
	v?: unknown;
	readonly fn?: () => unknown;
}

const lazySignal = (value: unknown): Lazy => ({ src: true, v: value });
const lazyComputed = (fn: () => unknown): Lazy => ({ src: false, fn });
const lazyGet = (n: Lazy): unknown => (n.src ? n.v : n.fn!());
const lazySet = (n: Lazy, v: unknown): void => { n.v = v; };

// --- B: push the flag, pull the value ---------------------------------------------------
//
// A write marks everything below it dirty without computing anything. A read settles only
// what it needs, and recomputes a node only when an input it actually read has a new version.
// Versions are what keep a change that produces the same value from spreading.

interface Node {
	src: boolean;
	v: unknown;
	version: number;
	subs: Node[];
	mark: number;
	dirty?: boolean;
	fn?: () => unknown;
	deps?: Node[];
	depVersions?: number[];
	run?: boolean;
}

interface Design {
	readonly name: string;
	readonly signal: (value: unknown) => Node;
	readonly computed: (fn: () => unknown) => Node;
	readonly get: (node: Node) => unknown;
	readonly set: (node: Node, value: unknown) => void;
	readonly effect: (fn: () => unknown) => Node;
}

const makeSignal = (value: unknown): Node => ({ src: true, v: value, version: 1, subs: [], mark: -1 });

const makeComputed = (fn: () => unknown): Node => ({
	src: false, v: undefined, version: 0, subs: [], mark: -1, dirty: true, fn, deps: [], depVersions: [],
});

let counter = 0;

/**
 * The plain build: an array of dependencies collected per recompute, and a queue the flush
 * shifts from.
 */
const plain = (): Design => {
	let active: Node | null = null;
	let collecting: Node[] | null = null;
	let mark = 0;

	const queue: Node[] = [];
	let flushing = false;

	const markSubs = (node: Node): void => {
		for (const sub of node.subs) {
			if (sub.dirty) continue;
			sub.dirty = true;
			if (sub.run !== undefined) queue.push(sub);
			else markSubs(sub);
		}
	};

	const relink = (node: Node, deps: Node[]): void => {
		const old = node.deps!;
		let same = old.length === deps.length;
		if (same) {
			for (let i = 0; i < old.length; i++) {
				if (old[i] !== deps[i]) { same = false; break; }
			}
		}

		if (!same) {
			for (const dep of old) {
				const at = dep.subs.indexOf(node);
				if (at >= 0) dep.subs.splice(at, 1);
			}
			for (const dep of deps) dep.subs.push(node);
			node.deps = deps;
			node.depVersions = new Array<number>(deps.length);
		}

		const versions = node.depVersions!;
		for (let i = 0; i < deps.length; i++) versions[i] = deps[i]!.version;
	};

	const settle = (node: Node): void => {
		node.dirty = false;

		if (node.version !== 0) {
			let stale = false;
			const deps = node.deps!;

			for (let i = 0; i < deps.length; i++) {
				const dep = deps[i]!;
				if (!dep.src && dep.dirty) settle(dep);
				if (dep.version !== node.depVersions![i]) { stale = true; break; }
			}

			if (!stale) return;
		}

		const outerActive = active;
		const outerCollecting = collecting;
		const outerMark = mark;

		active = node;
		collecting = [];
		mark = ++counter;

		const value = node.fn!();
		const deps = collecting;

		active = outerActive;
		collecting = outerCollecting;
		mark = outerMark;

		relink(node, deps);

		if (!Object.is(value, node.v)) {
			node.v = value;
			node.version += 1;
		} else if (node.version === 0) {
			node.version = 1;
		}
	};

	const get = (node: Node): unknown => {
		if (collecting !== null && node.mark !== mark) {
			node.mark = mark;
			collecting.push(node);
		}
		if (node.src) return node.v;
		if (node.dirty) settle(node);
		return node.v;
	};

	const flush = (): void => {
		if (flushing) return;
		flushing = true;
		try {
			while (queue.length > 0) {
				const node = queue.shift()!;
				if (node.dirty) settle(node);
			}
		} finally {
			flushing = false;
		}
	};

	return {
		name: 'B push pull',
		signal: makeSignal,
		computed: makeComputed,
		get,
		set: (node, value) => {
			if (Object.is(node.v, value)) return;
			node.v = value;
			node.version += 1;
			markSubs(node);
			flush();
		},
		effect: (fn) => {
			const node = makeComputed(fn);
			node.run = true;
			settle(node);
			return node;
		},
	};
};

/**
 * The same algorithm with its two allocations taken out: one shared stack for collecting
 * dependencies, and a cursor instead of shifting the queue. Ordinary optimizations, not a
 * different design, which is the distinction the gate turns on.
 */
const lean = (): Design => {
	let active: Node | null = null;
	let mark = 0;

	const scratch: Node[] = [];
	let top = 0;

	const queue: Node[] = [];
	let head = 0;
	let flushing = false;

	const markSubs = (node: Node): void => {
		for (const sub of node.subs) {
			if (sub.dirty) continue;
			sub.dirty = true;
			if (sub.run !== undefined) queue.push(sub);
			else markSubs(sub);
		}
	};

	const settle = (node: Node): void => {
		node.dirty = false;

		if (node.version !== 0) {
			let stale = false;
			const deps = node.deps!;

			for (let i = 0; i < deps.length; i++) {
				const dep = deps[i]!;
				if (!dep.src && dep.dirty) settle(dep);
				if (dep.version !== node.depVersions![i]) { stale = true; break; }
			}

			if (!stale) return;
		}

		const outerActive = active;
		const outerMark = mark;
		const base = top;

		active = node;
		mark = ++counter;

		const value = node.fn!();
		const count = top - base;

		active = outerActive;
		mark = outerMark;

		const old = node.deps!;
		let same = old.length === count;
		if (same) {
			for (let i = 0; i < count; i++) {
				if (old[i] !== scratch[base + i]) { same = false; break; }
			}
		}

		if (same) {
			const versions = node.depVersions!;
			for (let i = 0; i < count; i++) versions[i] = old[i]!.version;
		} else {
			for (const dep of old) {
				const at = dep.subs.indexOf(node);
				if (at >= 0) dep.subs.splice(at, 1);
			}

			const deps = new Array<Node>(count);
			const versions = new Array<number>(count);
			for (let i = 0; i < count; i++) {
				const dep = scratch[base + i]!;
				deps[i] = dep;
				versions[i] = dep.version;
				dep.subs.push(node);
			}
			node.deps = deps;
			node.depVersions = versions;
		}

		top = base;

		if (!Object.is(value, node.v)) {
			node.v = value;
			node.version += 1;
		} else if (node.version === 0) {
			node.version = 1;
		}
	};

	const get = (node: Node): unknown => {
		if (active !== null && node.mark !== mark) {
			node.mark = mark;
			scratch[top++] = node;
		}
		if (node.src) return node.v;
		if (node.dirty) settle(node);
		return node.v;
	};

	const flush = (): void => {
		if (flushing) return;
		flushing = true;
		try {
			while (head < queue.length) {
				const node = queue[head++]!;
				if (node.dirty) settle(node);
			}
		} finally {
			queue.length = 0;
			head = 0;
			flushing = false;
		}
	};

	return {
		name: 'B2 push pull, no churn',
		signal: makeSignal,
		computed: makeComputed,
		get,
		set: (node, value) => {
			if (Object.is(node.v, value)) return;
			node.v = value;
			node.version += 1;
			markSubs(node);
			flush();
		},
		effect: (fn) => {
			const node = makeComputed(fn);
			node.run = true;
			settle(node);
			return node;
		},
	};
};

// --- the harness ------------------------------------------------------------------------

type Handle = unknown;

interface Adapter {
	readonly name: string;
	readonly signal: (value: number) => Handle;
	readonly computed: (deps: Handle[], fn: (...values: number[]) => number) => Handle;
	readonly get: (handle: Handle) => number;
	readonly set: (handle: Handle, value: number) => void;
	readonly effect: ((deps: Handle[], fn: (...values: number[]) => void) => void) | null;
}

const fromDesign = (design: Design, label: string): Adapter => ({
	name: label,
	signal: (value) => design.signal(value),
	computed: (deps, fn) =>
		design.computed(() => fn(...deps.map((d) => design.get(d as Node) as number))),
	get: (handle) => design.get(handle as Node) as number,
	set: (handle, value) => design.set(handle as Node, value),
	effect: (deps, fn) => {
		design.effect(() => {
			fn(...deps.map((d) => design.get(d as Node) as number));
			return 0;
		});
	},
});

const adapters: Adapter[] = [
	{
		name: 'aweft A (recompute on read)',
		signal: (value) => lazySignal(value),
		computed: (deps, fn) => lazyComputed(() => fn(...deps.map((d) => lazyGet(d as Lazy) as number))),
		get: (handle) => lazyGet(handle as Lazy) as number,
		set: (handle, value) => lazySet(handle as Lazy, value),
		effect: null,
	},
	fromDesign(plain(), 'aweft B (push pull)'),
	fromDesign(lean(), 'aweft B2 (no churn)'),
];

/** The comparison runs when the libraries are installed, and is skipped when they are not. */
const load = async (name: string): Promise<Record<string, unknown> | null> => {
	try {
		return (await import(name)) as Record<string, unknown>;
	} catch {
		return null;
	}
};

type Fn = (...args: unknown[]) => unknown;

const alien = await load('alien-signals');
if (alien !== null) {
	const signal = alien.signal as Fn;
	const computed = alien.computed as Fn;
	const effect = alien.effect as Fn;

	adapters.push({
		name: 'alien-signals',
		signal: (value) => signal(value),
		computed: (deps, fn) => computed(() => fn(...deps.map((d) => (d as Fn)() as number))),
		get: (handle) => (handle as Fn)() as number,
		set: (handle, value) => { (handle as Fn)(value); },
		effect: (deps, fn) => { effect(() => fn(...deps.map((d) => (d as Fn)() as number))); },
	});
}

const preact = await load('@preact/signals-core');
if (preact !== null) {
	const signal = preact.signal as Fn;
	const computed = preact.computed as Fn;
	const effect = preact.effect as Fn;
	const read = (d: Handle): number => (d as { value: number }).value;

	adapters.push({
		name: 'preact signals',
		signal: (value) => signal(value),
		computed: (deps, fn) => computed(() => fn(...deps.map(read))),
		get: read,
		set: (handle, value) => { (handle as { value: number }).value = value; },
		effect: (deps, fn) => { effect(() => fn(...deps.map(read))); },
	});
}

const vue = await load('@vue/reactivity');
if (vue !== null) {
	const ref = vue.shallowRef as Fn;
	const computed = vue.computed as Fn;
	const effect = vue.effect as Fn;
	const read = (d: Handle): number => (d as { value: number }).value;

	adapters.push({
		name: 'vue reactivity',
		signal: (value) => ref(value),
		computed: (deps, fn) => computed(() => fn(...deps.map(read))),
		get: read,
		set: (handle, value) => { (handle as { value: number }).value = value; },
		effect: (deps, fn) => { effect(() => fn(...deps.map(read))); },
	});
}

type Step = ((iteration: number) => number) | null;

/** One source, a line of derived values, read the last one. */
const deep = (a: Adapter, depth: number): Step => {
	const src = a.signal(0);
	let node = a.computed([src], (v) => v + 1);
	for (let i = 1; i < depth; i++) node = a.computed([node], (v) => v + 1);

	return (iteration) => {
		a.set(src, iteration);
		return a.get(node);
	};
};

/** One source, many derived values beside each other, read them all. */
const wide = (a: Adapter, width: number): Step => {
	const src = a.signal(0);
	const leaves: Handle[] = [];
	for (let i = 0; i < width; i++) leaves.push(a.computed([src], (v) => v + i));

	return (iteration) => {
		a.set(src, iteration);
		let sum = 0;
		for (const leaf of leaves) sum += a.get(leaf);
		return sum;
	};
};

/** Layers, each node reading two of the layer above, so work is shared and shared again. */
const layered = (a: Adapter, layers: number, width: number): Step => {
	const src = a.signal(0);
	let previous: Handle[] = [];
	for (let i = 0; i < width; i++) previous.push(a.computed([src], (v) => v + i));

	for (let l = 1; l < layers; l++) {
		const next: Handle[] = [];
		for (let i = 0; i < width; i++) {
			next.push(a.computed([previous[i], previous[(i + 1) % width]], (x, y) => (x + y) % 1000003));
		}
		previous = next;
	}

	return (iteration) => {
		a.set(src, iteration);
		let sum = 0;
		for (const leaf of previous) sum = (sum + a.get(leaf)) % 1000003;
		return sum;
	};
};

/** Many small graphs, of which one write and one read touch only a few. */
const sparse = (a: Adapter, count: number, depth: number): Step => {
	const sources: Handle[] = [];
	const leaves: Handle[] = [];

	for (let i = 0; i < count; i++) {
		const src = a.signal(i);
		let node = a.computed([src], (v) => v + 1);
		for (let d = 1; d < depth; d++) node = a.computed([node], (v) => v + 1);
		sources.push(src);
		leaves.push(node);
	}

	return (iteration) => {
		let sum = 0;
		for (let k = 0; k < 10; k++) {
			const at = (iteration * 7 + k * 97) % count;
			a.set(sources[at]!, iteration + k);
			sum += a.get(leaves[at]!);
		}
		return sum;
	};
};

/** The same fan out, driven by effects rather than by reads. This is what a page does. */
const live = (a: Adapter, width: number): Step => {
	if (a.effect === null) return null;

	const src = a.signal(0);
	let sum = 0;

	for (let i = 0; i < width; i++) {
		const leaf = a.computed([src], (v) => v + i);
		a.effect([leaf], (v) => { sum += v; });
	}

	return (iteration) => {
		sum = 0;
		a.set(src, iteration);
		return sum;
	};
};

interface Shape {
	readonly name: string;
	readonly runs: number;
	readonly build: (a: Adapter) => Step;
	readonly skip?: readonly string[];
}

const shapes: Shape[] = [
	{ name: 'deep chain, 1000 long', runs: 400, build: (a) => deep(a, 1000) },
	{ name: 'wide fan out, 1000 leaves', runs: 200, build: (a) => wide(a, 1000) },
	{ name: 'layered, 10 by 10', runs: 300, build: (a) => layered(a, 10, 10) },
	{
		name: 'layered, 20 by 20',
		runs: 300,
		build: (a) => layered(a, 20, 20),
		// Without a cache a node read twice is computed twice, so a shared subgraph doubles the
		// work per layer. Twenty layers is a million evaluations for one read.
		skip: ['aweft A (recompute on read)'],
	},
	{ name: 'sparse, 1000 graphs', runs: 400, build: (a) => sparse(a, 1000, 5) },
	{ name: 'live fan out, 1000 effects', runs: 200, build: (a) => live(a, 1000) },
];

const measure = (step: (iteration: number) => number, runs: number): { per: number; checksum: number } => {
	let checksum = 0;
	for (let i = 0; i < Math.max(10, runs / 5); i++) checksum += step(i);

	let best = Infinity;
	for (let attempt = 0; attempt < 3; attempt++) {
		const started = process.hrtime.bigint();
		for (let i = 0; i < runs; i++) checksum += step(i);
		const took = Number(process.hrtime.bigint() - started) / 1e6;
		if (took < best) best = took;
	}

	return { per: best / runs, checksum };
};

for (const shape of shapes) {
	console.log(`\n## ${shape.name}`);

	const timed: Array<{ name: string; per: number }> = [];
	const checksums = new Set<number>();

	for (const adapter of adapters) {
		if (shape.skip?.includes(adapter.name)) {
			console.log(`  ${adapter.name.padEnd(28)} skipped: not runnable at this size`);
			continue;
		}

		const step = shape.build(adapter);
		if (step === null) {
			console.log(`  ${adapter.name.padEnd(28)} skipped: no effects in this design`);
			continue;
		}

		const { per, checksum } = measure(step, shape.runs);
		checksums.add(checksum);
		timed.push({ name: adapter.name, per });
	}

	const fastest = Math.min(...timed.map((t) => t.per));
	for (const entry of timed) {
		console.log(
			`  ${entry.name.padEnd(28)} ${entry.per.toFixed(4).padStart(9)} ms/run   ` +
			`${(entry.per / fastest).toFixed(2).padStart(6)}x`,
		);
	}

	// A faster implementation that computes something else is not faster.
	console.log(checksums.size <= 1
		? '  every implementation computed the same numbers'
		: `  MISMATCH: ${checksums.size} checksums, so the timings above mean nothing`);
}
