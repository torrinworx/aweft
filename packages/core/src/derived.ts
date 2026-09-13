// Derived values: the second surface of the chain (design 023).
//
// A derived value is memoized while observed and recomputed on read while not. A source
// change marks the graph dirty without running user code; one trailing delivery job settles
// what is dirty and notifies watchers whose value actually changed. Marking is the push,
// settling is the pull, and user code only ever runs inside a dispatch job or a read.

import { codecError } from '@aweftjs/codec';

import { clock } from './clock.ts';
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

/** Where a chain step keeps its source. Internal to core; `Scope` is the only other reader. */
export const SLOT: unique symbol = Symbol('aweft.chain.slot');

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
	 * unchanged: derive the field you mean, not the container holding it. Unsubscribing
	 * during a delivery does not recall the delivery already in flight.
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
	 * Per-key selection. `select(key)` reads as "is this the selected key". Writing maps back
	 * (design 028): `set(true)` writes the key to the source, and `set(false)` clears the
	 * source only when this key is the selected one, so clearing a key that already lost the
	 * selection changes nothing. A selection change reaches only the keys whose answer
	 * flipped; every other subscribed key hears nothing.
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
	/** The transform of a one-input node, so its recompute allocates nothing. */
	readonly one: ((input: unknown) => unknown) | null;

	/** Downstream mark callbacks plus user watchers. Live means either is non-empty. */
	readonly downstream: Set<() => void>;
	/** Each watcher beside the version it last heard, so a late subscriber cannot reset what
	 * an earlier one is still owed. */
	readonly watchers: Map<(value: unknown) => void, number>;
	detached: Array<() => void> | null;

	/** A source poked this node directly, so the next settle must recompute. */
	fired: boolean;
	dirty: boolean;
	value: unknown;
	/** Bumps when a settle produces a different value. What stops a no-change from spreading. */
	version: number;
	/** Versions of derived sources at the last recompute, 0 where the source is not derived. */
	readonly depVersions: number[];
	/** In the pending list already, so a second poke in one burst queues nothing. */
	queued: boolean;
	/** The idle cache: trusted while the write clock has not moved past its stamp. */
	idleAt: number;
	idleValue: unknown;

	/** unwrap only: the inner chain being followed, and how to let go of it. */
	inner: Source | null;
	innerDetach: (() => void) | null;
	readonly follow: boolean;
}

const createDNode = (
	sources: readonly Source[],
	compute: (inputs: readonly unknown[]) => unknown,
	follow = false,
	one: ((input: unknown) => unknown) | null = null,
): DNode => ({
	sources,
	compute,
	one,
	downstream: new Set(),
	watchers: new Map(),
	detached: null,
	fired: true,
	dirty: true,
	value: undefined,
	version: 0,
	depVersions: sources.map(() => 0),
	queued: false,
	idleAt: -1,
	idleValue: undefined,
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

	// One watcher or one transform throwing must not decide whether the others hear the
	// value. The first error still reaches whoever made the change, once everyone has been
	// told, which is the same rule commit delivery follows.
	let failed = false;
	let failure: unknown;

	for (const node of batch) {
		node.queued = false;
		// A node whose last watcher left mid-burst has nothing maintaining its cache and
		// nobody to tell.
		if (node.detached === null) continue;
		if (node.dirty) {
			try {
				settle(node);
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
				continue;
			}
		}

		for (const [watcher, told] of [...node.watchers]) {
			if (told === node.version) continue;
			// Recorded before the call, so a watcher that throws is still caught up rather
			// than retried with the same value forever. Recorded only while it is still
			// subscribed: one an earlier watcher stopped in this same delivery is still told
			// this value, and is never put back to hear the next.
			if (node.watchers.has(watcher)) node.watchers.set(watcher, node.version);
			try {
				watcher(node.value);
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		}
	}

	if (failed) throw failure;
};

// --- pull: settling --------------------------------------------------------------------

const recompute = (node: DNode): void => {
	// A throw in the transform records nothing: a failed compute must not read as a fresh
	// one, or the stale value before it would be served as though it were the answer.
	let value = node.one !== null
		? node.one(node.sources[0]!.read())
		: node.compute(node.sources.map((source) => source.read()));

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

	for (let i = 0; i < node.sources.length; i++) {
		const dep = dnodeOf(node.sources[i]!);
		if (dep !== undefined) node.depVersions[i] = dep.version;
	}
	node.fired = false;

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

	if (stale) {
		try {
			recompute(node);
		} catch (error) {
			// The work is still owed: a read or delivery after a failed compute tries again
			// rather than serving what the value was before the failure.
			node.dirty = true;
			throw error;
		}
	}
};

// --- reading while nothing watches ------------------------------------------------------

// An idle node's cache is trusted exactly as long as the write clock has not moved: any
// commit or cell write anywhere invalidates every idle cache at once. That is conservative
// on purpose, and it is what makes a shared subgraph cost its size rather than its path
// count, across sibling reads as well as within one.
const readOnce = (node: DNode): unknown => {
	// A live node's cache is maintained by the flush, so it is the answer, not a stale copy.
	if (node.detached !== null) {
		if (node.dirty) settle(node);
		return node.value;
	}

	if (node.idleAt === clock()) return node.idleValue;

	// The stamp is taken before the sources are read: if the transform writes anything, the
	// clock moves past this stamp and the cache is already invalid for the next read, rather
	// than blessing the pre-write inputs as current.
	const at = clock();

	let value = node.one !== null
		? node.one(node.sources[0]!.read())
		: node.compute(node.sources.map((source) => source.read()));
	if (node.follow) {
		const inner = sourceOf(value);
		if (inner !== undefined) value = inner.read();
	}

	node.idleAt = at;
	node.idleValue = value;
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
 * The value surface over a source. Everything here is a description until something watches
 * it: chains are immutable, and each combinator returns a new one.
 *
 * The combinators sit on the prototype and a step holds only its source, so a step is one
 * small object rather than a bag of nineteen closures. This is the one place the stack builds
 * an object surface with a class rather than a factory (`AGENTS.md`, CODING STANDARDS): a
 * list binds a chain per row per field, and the closure bags were the largest single
 * allocation site in a ten thousand row profile (design 154). Not exported from the package
 * index; `chain` below is how the rest of core builds one.
 */
export class Chain<T> implements Derived<T> {
	/** Null only while a subclass has not built its source yet. `source()` is the reader. */
	#src: Source | null;

	constructor(src: Source | null) {
		this.#src = src;
	}

	/**
	 * The slot the source lives in, for a subclass that builds its own on first need. A subclass
	 * cannot reach a parent's private field, and an internal surface another file needs goes
	 * behind a Symbol rather than a naming convention, so a step keeps no own enumerable key and
	 * `JSON.stringify` of one is still `{}`.
	 */
	get [SLOT](): Source | null {
		return this.#src;
	}

	set [SLOT](source: Source | null) {
		this.#src = source;
	}

	/** The source this step reads. A scope overrides it to build its own on first need. */
	source(): Source {
		return this.#src!;
	}

	get [SOURCE](): Source {
		return this.source();
	}

	get(): T {
		return this.source().read() as T;
	}

	set(value: T): void {
		const source = this.source();
		if (source.write === undefined) {
			throw codecError('read-only', 'this chain declares no write path; see setter',
				'Give the chain a write path with setter before calling set.');
		}
		source.write(value);
	}

	isImmutable(): boolean {
		const source = this.source();
		return source.immutable?.() ?? source.write === undefined;
	}

	watch(fn: (value: T) => void): () => void {
		const source = this.source();
		// A bare source (a scope or cell watched directly) has no node of its own; a
		// transparent one gives it the same settle, dedup and flush path as everything else.
		const node = dnodeOf(source)
			?? createDNode([source], (inputs) => inputs[0], false, (input) => input);
		goLive(node);
		// This watcher starts caught up to the settled present; anything an earlier watcher
		// is still owed stays owed to it, because each entry keeps its own version.
		node.watchers.set(fn as (value: unknown) => void, node.version);
		let on = true;
		return () => {
			if (!on) return;
			on = false;
			node.watchers.delete(fn as (value: unknown) => void);
			goIdle(node);
		};
	}

	effect(fn: (value: T) => void): () => void {
		// Subscribe first and read after, so no change lands in the gap between the two.
		const stop = this.watch(fn);
		try {
			fn(this.get());
		} catch (error) {
			// A throwing first call must not leak a subscription nobody holds a handle to.
			stop();
			throw error;
		}
		return stop;
	}

	map<U>(fn: (value: T) => U): Derived<U> {
		return derive(createDNode(
			[this.source()], (inputs) => fn(inputs[0] as T), false, fn as (input: unknown) => unknown));
	}

	setter(fn: (value: T) => void): Derived<T> {
		const source = this.source();
		// A chain that declares itself immutable by construction (an immutable wrapper, a
		// wildcard scope) stays that way; setter replaces a write path, it does not mint the
		// right to have one (design 028).
		if (source.immutable?.() === true) {
			throw codecError('read-only', 'this chain is immutable by construction; setter cannot reopen it',
				'Build the chain over a writable source rather than an immutable one.');
		}
		return chain({
			...source,
			write: fn as (value: unknown) => void,
			immutable: () => false,
		});
	}

	unwrap(): Derived<unknown> {
		return derive(createDNode([this.source()], (inputs) => inputs[0], true, (input) => input));
	}

	bool<U, V>(truthy: U, falsy: V): Derived<U | V> {
		return derive(createDNode(
			[this.source()], (inputs) => (inputs[0] ? truthy : falsy), false,
			(input) => (input ? truthy : falsy)));
	}

	def<U>(fallback: U): Derived<NonNullable<T> | U> {
		return derive(createDNode(
			[this.source()], (inputs) => inputs[0] ?? fallback, false, (input) => input ?? fallback));
	}

	defined(): Derived<boolean> {
		return derive(createDNode(
			[this.source()],
			(inputs) => inputs[0] !== null && inputs[0] !== undefined,
			false,
			(input) => input !== null && input !== undefined));
	}

	selector(compare?: (value: T, key: unknown) => boolean): (key: unknown) => Derived<boolean> {
		return selectorFrom(
			this.source(), (compare as (value: unknown, key: unknown) => boolean) ?? Object.is);
	}

	throttle(ms: number): Derived<T> {
		return chain(gate(this.source(), ms, 'throttle'));
	}

	wait(ms: number): Derived<T> {
		return chain(gate(this.source(), ms, 'wait'));
	}
}

/** Build the value surface over a source. */
export const chain = <T>(source: Source): Derived<T> => new Chain<T>(source);

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
