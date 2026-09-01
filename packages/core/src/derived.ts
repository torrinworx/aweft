// Derived values: the second surface of the chain (design 023).
//
// A derived value is memoized while observed and recomputed on read while not. A source
// change marks the graph dirty without running user code; one trailing delivery job settles
// what is dirty and notifies watchers whose value actually changed. Marking is the push,
// settling is the pull, and user code only ever runs inside a dispatch job or a read.

import { codecError } from '@aweftjs/codec';

import { dispatch } from './transaction.ts';

/**
 * Where a derived value's input comes from. Scopes, cells and other derived values all fit
 * behind this, which is what lets one graph span all three.
 */
export interface Source {
	read(): unknown;
	/** Start telling `mark` about changes. `mark` must not run user code. */
	attach(mark: () => void): () => void;
	/** The declared write path, when there is one (design 028). */
	write?: ((value: unknown) => void) | undefined;
	/** Whether writes can ever work. Defaults to "write is absent". */
	immutable?: (() => boolean) | undefined;
}

/** Both surfaces carry their source here, so combinators can accept either (design 023). */
export const SOURCE = Symbol('aweft.source');

/** The source behind a scope, cell or derived value, or undefined for a plain value. */
export const sourceOf = (value: unknown): Source | undefined =>
	(typeof value === 'object' && value !== null) || typeof value === 'function'
		? (value as { [SOURCE]?: Source })[SOURCE]
		: undefined;

/**
 * The value surface. `get` reads, `watch` delivers the value after it changes, and the
 * combinators return new chains without touching this one. `set` works only where a write
 * path was declared; ask `isImmutable` first.
 */
export interface Derived<T> {
	/** The current value. Computed if nothing is watching, from the cache if something is. */
	get(): T;
	/** Write through the declared write path. Throws `read-only` when there is none. */
	set(value: T): void;
	/** True when `set` can never work on this chain. */
	isImmutable(): boolean;
	/**
	 * Call `fn` with each new value. Returns its unsubscribe. A change that settles to an
	 * equal value (`Object.is`) is not delivered, so a container mutated in place reads as
	 * unchanged: derive the field you mean, not the container holding it.
	 */
	watch(fn: (value: T) => void): () => void;
	/** Call `fn` with the value now, and again after every change. Returns its unsubscribe. */
	effect(fn: (value: T) => void): () => void;
	/** Transform the value. `fn` must be pure per input; what else it reads is not tracked. */
	map<U>(fn: (value: T) => U): Derived<U>;
	/** The same chain with `fn` as its write path (design 028). */
	setter(fn: (value: T) => void): Derived<T>;
	/** Follow the value one level when it is itself a chain, a cell or a scope. */
	unwrap(): Derived<unknown>;
	/** One of two values, picked by truthiness. */
	bool<U, V>(truthy: U, falsy: V): Derived<U | V>;
	/** The value, or `fallback` when the value is null or undefined. */
	def<U>(fallback: U): Derived<NonNullable<T> | U>;
	/** Whether the value is neither null nor undefined. */
	defined(): Derived<boolean>;
	/**
	 * Per-key selection. `select(key)` reads as "is this the selected key" and writes back per
	 * design 028. A selection change reaches only the keys whose answer flipped; every other
	 * subscribed key hears nothing.
	 */
	selector(compare?: (value: T, key: unknown) => boolean): (key: unknown) => Derived<boolean>;
	/** Deliver at most once per `ms`: the first change of a burst now, the last at the end. */
	throttle(ms: number): Derived<T>;
	/** Deliver `ms` after the last change. Reads are never delayed, only delivery. */
	wait(ms: number): Derived<T>;
}

interface DNode {
	readonly sources: readonly Source[];
	readonly compute: (inputs: readonly unknown[]) => unknown;

	/** Downstream mark callbacks plus user watchers. Live means either is non-empty. */
	readonly downstream: Set<() => void>;
	readonly watchers: Set<(value: unknown) => void>;
	detached: Array<() => void> | null;

	/** A source poked this node directly, so the next settle must recompute. */
	fired: boolean;
	dirty: boolean;
	value: unknown;
	/** Bumps when a settle produces a different value. What stops a no-change from spreading. */
	version: number;
	/** Versions of derived sources at the last recompute, 0 where the source is not derived. */
	readonly depVersions: number[];
	/** The version the watchers last heard, so a flush only notifies actual change. */
	told: number;
	/** In the pending list already, so a second poke in one burst queues nothing. */
	queued: boolean;

	/** unwrap only: the inner chain being followed, and how to let go of it. */
	inner: Source | null;
	innerDetach: (() => void) | null;
	readonly follow: boolean;
}

const createDNode = (
	sources: readonly Source[],
	compute: (inputs: readonly unknown[]) => unknown,
	follow = false,
): DNode => ({
	sources,
	compute,
	downstream: new Set(),
	watchers: new Set(),
	detached: null,
	fired: true,
	dirty: true,
	value: undefined,
	version: 0,
	depVersions: sources.map(() => 0),
	told: 0,
	queued: false,
	inner: null,
	innerDetach: null,
	follow,
});

const NODE = Symbol('aweft.derived');

const dnodeOf = (source: Source): DNode | undefined => (source as { [NODE]?: DNode })[NODE];

// --- push: marking ---------------------------------------------------------------------

/** Nodes marked dirty that have watchers to tell. Drained by the flush job. */
let pending: DNode[] = [];
let flushQueued = false;

const enqueue = (node: DNode): void => {
	if (node.queued || node.watchers.size === 0) return;
	node.queued = true;
	pending.push(node);
};

const markDirty = (node: DNode): void => {
	if (node.dirty) return;
	node.dirty = true;
	enqueue(node);
	for (const mark of node.downstream) mark();
};

/** A source changed under `node`. Marks only; settling waits for the flush job. */
const poke = (node: DNode): void => {
	node.fired = true;
	if (node.dirty) enqueue(node);
	else markDirty(node);
	scheduleFlush();
};

/**
 * An upstream derived value was marked. Dirty travels down, but `fired` does not: whether
 * this node recomputes is decided at settle time by the upstream version, which is what
 * stops a change that produced an equal value from spreading (design 023).
 */
const mark = (node: DNode): void => {
	if (node.dirty) enqueue(node);
	else markDirty(node);
	scheduleFlush();
};

/**
 * One flush job settles everything a burst of pokes marked. It is queued behind the commit's
 * own deliveries, so a value combining two branches of a document never computes against half
 * a commit (design 023).
 */
const scheduleFlush = (): void => {
	if (flushQueued) return;
	flushQueued = true;
	dispatch([flush]);
};

const flush = (): void => {
	// Anything a watcher below dirties again belongs to the next batch and the next job.
	flushQueued = false;
	const batch = pending;
	pending = [];

	for (const node of batch) {
		node.queued = false;
		// A node whose last watcher left mid-burst has nothing maintaining its cache and
		// nobody to tell.
		if (node.detached === null) continue;
		if (node.dirty) settle(node);
		if (node.version === node.told) continue;

		node.told = node.version;
		for (const watcher of node.watchers) watcher(node.value);
	}
};

// --- pull: settling --------------------------------------------------------------------

const recompute = (node: DNode): void => {
	const inputs = node.sources.map((source) => source.read());

	for (let i = 0; i < node.sources.length; i++) {
		const dep = dnodeOf(node.sources[i]!);
		if (dep !== undefined) node.depVersions[i] = dep.version;
	}
	node.fired = false;

	let value = node.compute(inputs);

	// unwrap: when the computed value is itself a chain, follow it, and while live keep the
	// subscription pointed at whichever inner chain the outer value names right now.
	if (node.follow) {
		const inner = sourceOf(value);
		if (node.detached !== null && inner !== node.inner) {
			node.innerDetach?.();
			node.inner = inner ?? null;
			node.innerDetach = inner === undefined ? null : inner.attach(() => poke(node));
		}
		if (inner !== undefined) value = inner.read();
	}

	if (!Object.is(value, node.value)) {
		node.value = value;
		node.version += 1;
	} else if (node.version === 0) {
		node.version = 1;
	}
};

/** Bring a live node's cache up to date, settling dirty upstream derived values first. */
const settle = (node: DNode): void => {
	node.dirty = false;

	let stale = node.fired || node.version === 0;
	for (let i = 0; i < node.sources.length; i++) {
		const dep = dnodeOf(node.sources[i]!);
		if (dep === undefined) continue;
		if (dep.detached !== null && dep.dirty) settle(dep);
		if (dep.version !== node.depVersions[i]) stale = true;
	}

	if (stale) recompute(node);
};

// --- reading while nothing watches ------------------------------------------------------

// One top-level read settles each node at most once, so a shared subgraph costs its size and
// not its path count. The cache is valid for the one read and never trusted after it.
let epoch = 0;
let reading = 0;
const epochAt = new WeakMap<DNode, number>();
const epochValue = new WeakMap<DNode, unknown>();

const readOnce = (node: DNode): unknown => {
	// A live node's cache is maintained by the flush, so it is the answer, not a stale copy.
	if (node.detached !== null) {
		if (node.dirty) settle(node);
		return node.value;
	}

	if (reading > 0 && epochAt.get(node) === epoch) return epochValue.get(node);

	reading += 1;
	if (reading === 1) epoch += 1;

	let value: unknown;
	try {
		value = node.compute(node.sources.map((source) => source.read()));
		if (node.follow) {
			const inner = sourceOf(value);
			if (inner !== undefined) value = inner.read();
		}
	} finally {
		reading -= 1;
	}

	epochAt.set(node, epoch);
	epochValue.set(node, value);
	return value;
};

// --- lifecycle -------------------------------------------------------------------------

const goLive = (node: DNode): void => {
	if (node.detached !== null) return;

	// The cache was not maintained while nothing observed this, so the first settle after
	// coming live recomputes rather than trusting it.
	node.fired = true;
	node.dirty = true;
	node.detached = node.sources.map((source) =>
		// A derived upstream marks without firing; anything else firing means recompute.
		source.attach(dnodeOf(source) !== undefined ? () => mark(node) : () => poke(node)));
	settle(node);
};

const goIdle = (node: DNode): void => {
	if (node.downstream.size > 0 || node.watchers.size > 0) return;
	if (node.detached === null) return;

	for (const detach of node.detached) detach();
	node.detached = null;
	node.innerDetach?.();
	node.innerDetach = null;
	node.inner = null;
};

/** Subscribing twice-removed: what a downstream derived value does to its upstream one. */
const nodeSource = (node: DNode): Source => {
	const source: Source = {
		read: () => readOnce(node),
		attach: (mark) => {
			goLive(node);
			node.downstream.add(mark);
			let on = true;
			return () => {
				// Letting go twice is a no-op, never a double free.
				if (!on) return;
				on = false;
				node.downstream.delete(mark);
				goIdle(node);
			};
		},
	};
	(source as { [NODE]?: DNode })[NODE] = node;
	return source;
};

// --- timing (design 026) --------------------------------------------------------------

/**
 * Shift when a mark is passed on. State is per subscription, so two watchers of one throttled
 * chain each get the schedule they were promised rather than sharing a timer.
 */
const gate = (base: Source, ms: number, kind: 'throttle' | 'wait'): Source => ({
	read: base.read,
	write: base.write,
	immutable: base.immutable,
	attach: (mark) => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		let open = true;
		let trailing = false;

		// A timer lands outside any drain, so the mark goes through dispatch to keep the rule
		// that user code runs only inside a job.
		const deliver = (): void => dispatch([mark]);

		const window = (): void => {
			timer = null;
			if (!trailing) {
				open = true;
				return;
			}
			trailing = false;
			deliver();
			timer = setTimeout(window, ms);
		};

		const detachBase = base.attach(() => {
			if (kind === 'wait') {
				if (timer !== null) clearTimeout(timer);
				timer = setTimeout(() => {
					timer = null;
					deliver();
				}, ms);
				return;
			}
			if (open) {
				// The first change of a burst is worth having now; the window catches the rest.
				open = false;
				mark();
				timer = setTimeout(window, ms);
			} else {
				trailing = true;
			}
		});

		return () => {
			detachBase();
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
		};
	},
});

// --- selection (design 028) -----------------------------------------------------------

interface Keyed {
	readonly marks: Set<() => void>;
	was: boolean;
}

const selectorFrom = (
	source: Source,
	compare: (value: unknown, key: unknown) => boolean,
): ((key: unknown) => Derived<boolean>) => {
	const entries = new Map<unknown, Keyed>();
	let detachBase: (() => void) | null = null;

	// One subscription on the source however many keys ask. A change reaches only the entries
	// whose answer flipped, which is the cost promise the selector exists to keep.
	const onChange = (): void => {
		const value = source.read();
		for (const [key, entry] of entries) {
			const now = compare(value, key);
			if (now === entry.was) continue;
			entry.was = now;
			for (const mark of entry.marks) mark();
		}
	};

	return (key) => {
		const read = (): boolean => compare(source.read(), key);

		const keyed: Source = {
			read,
			attach: (mark) => {
				let entry = entries.get(key);
				if (entry === undefined) {
					entry = { marks: new Set(), was: read() };
					entries.set(key, entry);
				}
				entry.marks.add(mark);
				if (detachBase === null) detachBase = source.attach(onChange);

				let on = true;
				return () => {
					if (!on) return;
					on = false;
					entry.marks.delete(mark);
					if (entry.marks.size === 0) entries.delete(key);
					if (entries.size === 0 && detachBase !== null) {
						detachBase();
						detachBase = null;
					}
				};
			},
			write: source.write === undefined ? undefined : (value) => {
				// Design 028: true selects this key; false clears only if this key is selected.
				if (value === true) source.write!(key);
				else if (read()) source.write!(undefined);
			},
			immutable: source.immutable,
		};

		return chain<boolean>(keyed);
	};
};

// --- the surface -----------------------------------------------------------------------

const derive = <U>(node: DNode): Derived<U> => chain<U>(nodeSource(node));

/**
 * Build the value surface over a source. Everything here is a description until something
 * watches it: chains are immutable, and each combinator returns a new one.
 */
export const chain = <T>(source: Source): Derived<T> => {
	const derived: Derived<T> = {
		get: () => source.read() as T,

		set: (value) => {
			if (source.write === undefined) {
				throw codecError('read-only', 'this chain declares no write path; see setter');
			}
			source.write(value);
		},

		isImmutable: () => source.immutable?.() ?? source.write === undefined,

		watch: (fn) => {
			let node = dnodeOf(source);
			if (node === undefined) {
				// A bare source (a scope or cell watched directly) has no node of its own; a
				// transparent one gives it the same settle, dedup and flush path as everything else.
				node = createDNode([source], (inputs) => inputs[0]);
			}
			goLive(node);
			node.watchers.add(fn as (value: unknown) => void);
			node.told = node.version;
			let on = true;
			return () => {
				if (!on) return;
				on = false;
				node.watchers.delete(fn as (value: unknown) => void);
				goIdle(node);
			};
		},

		effect: (fn) => {
			// Subscribe first and read after, so no change lands in the gap between the two.
			const stop = derived.watch(fn);
			fn(derived.get());
			return stop;
		},

		map: (fn) => derive(createDNode([source], (inputs) => fn(inputs[0] as T))),

		setter: (fn) => chain({
			...source,
			write: fn as (value: unknown) => void,
			immutable: () => false,
		}),

		unwrap: () => derive(createDNode([source], (inputs) => inputs[0], true)),

		bool: (truthy, falsy) => derive(createDNode([source], (inputs) => (inputs[0] ? truthy : falsy))),

		def: (fallback) => derive(createDNode([source], (inputs) => inputs[0] ?? fallback)),

		defined: () => derive(createDNode([source], (inputs) => inputs[0] !== null && inputs[0] !== undefined)),

		selector: (compare) =>
			selectorFrom(source, (compare as (value: unknown, key: unknown) => boolean) ?? Object.is),

		throttle: (ms) => chain(gate(source, ms, 'throttle')),

		wait: (ms) => chain(gate(source, ms, 'wait')),
	};

	(derived as unknown as { [SOURCE]?: Source })[SOURCE] = source;
	return derived;
};

/**
 * Combine several inputs into one derived value of their current values, in order.
 *
 * Params:
 *   inputs: scopes, cells, derived values, or plain values, mixed freely. A plain value is
 *           carried as itself and never changes
 *
 * Returns: a derived value of an array, one slot per input. It recomputes when any input
 * changes, once per burst, after the burst's commit has fully delivered.
 *
 * Example:
 *   all([observer(doc).path('width'), observer(doc).path('height')])
 *     .map(([w, h]) => Number(w) * Number(h))
 *     .effect((area) => console.log(area));
 */
export const all = (inputs: readonly unknown[]): Derived<unknown[]> => {
	const sources = inputs.map((input) => sourceOf(input) ?? {
		read: () => input,
		attach: () => () => undefined,
	});
	return derive(createDNode(sources, (values) => [...values]));
};
