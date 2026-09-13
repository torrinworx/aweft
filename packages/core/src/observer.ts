// Scopes: narrowing what a listener sees, and reading or writing what a path names.
//
// An observer is a description, not a subscription to a particular object. It resolves its
// path when it is used, so `path('user', 'name')` is useful before `user` exists and survives
// the slot being removed and made again (design 017).

import { codecError } from '@aweftjs/codec';

import type { Change, Listener, Node, Step, WildStep } from './types.ts';
import { addListener, removeListener, resolveKey, userValue } from './node.ts';
import { changeOf, write } from './transaction.ts';
import { nodeOf, toCell } from './value.ts';
import { Chain, type Derived, SLOT, type Source } from './derived.ts';

/** A step in a path: an object or map slot by name, or an array position by index. */
export type ScopeKey = string | number;

const isWild = (key: Step): key is WildStep => typeof key === 'object';

/**
 * A scope: what part of the document a listener is about. Narrow it before watching.
 *
 * A scope also carries the value combinators of design 023, inherited below: `map` is the
 * bridge from this surface to derived values, and `bool`, `def`, `selector` and the rest
 * ride on it.
 */
export interface Observer extends Omit<Derived<unknown>, 'get' | 'set' | 'watch' | 'effect'> {
	/** The value the path names, or undefined when nothing sits there. */
	get(): unknown;
	/** Write the slot the path names. The observable holding it has to exist. */
	set(value: unknown): void;
	/**
	 * Narrow to a slot, or to whatever observable sits in it. A path stops at an alias.
	 *
	 * A number names a position in an array, not the element that was there when the scope was
	 * built: `path('tasks', 0)` follows whatever sits at index 0 now, so removing the first
	 * task makes it the second task's scope. To follow one element wherever it moves, start
	 * the scope at the element itself.
	 */
	path(...keys: ScopeKey[]): Observer;
	/** Drop changes to these slots of whatever the scope reaches. */
	ignore(...keys: ScopeKey[]): Observer;
	/** Keep only changes to the scoped observable's own slots, not to anything below it. */
	shallow(): Observer;
	/**
	 * Match any `count` consecutive steps, one by default (design 025). A scope with a
	 * wildcard in it names many places, so `get` is undefined, `set` throws, and `isImmutable`
	 * is true.
	 *
	 * The count is exact, and a scope that names a depth nothing sits at is silent: it simply
	 * never matches, and a derived value built on it sits at its initial value forever, which
	 * reads as a working value that never changes. Count the steps between the observable the
	 * scope starts at and the slot you mean, or reach for `tree`, which is depth independent.
	 *
	 * `Infinity` is any run of steps, none included, each one open: never an object slot whose
	 * key starts with an underscore, never one `ignore` names (design 259). Ending the scope,
	 * the run reaches the slot the delta names, so `skip(Infinity).watch(fn)` hears every
	 * public delta in the document, each on its own, and never one under a private slot at any
	 * depth. Followed by a key, it reaches that key at any depth, as `tree` does.
	 *
	 * Example:
	 *   observer(doc).skip(Infinity).watch((change) => record(change.deltas));
	 */
	skip(count?: number): Observer;
	/**
	 * Match the named key at any depth: here, or under any chain of slots (design 025).
	 * Reach for this over `skip` whenever the depth is not fixed, because a `skip` at the
	 * wrong depth matches nothing and says nothing about it.
	 */
	tree(key: ScopeKey): Observer;
	/**
	 * Call `fn` with each commit that touched this scope. Returns its unsubscribe.
	 *
	 * `fn` runs after the whole commit has been applied, so the tree is never read between the
	 * deltas of one commit. It is the tree as it stands, which is not always the state this
	 * commit produced: a listener earlier in the same delivery may have mutated already, and a
	 * mutation lands as it is written. Read `change.deltas` when the exact state of this commit
	 * is what matters. Commits landed with `apply` arrive here too, indistinguishable from
	 * local mutation. Unsubscribing during a delivery does not recall the delivery already
	 * in flight.
	 *
	 * Pass `{ inverse: true }` to use `change.inverse()`, which is what an undo stack and a
	 * replication seam that can roll a write back need. It is off by default because building
	 * it costs the commit the prior value of every slot it touched and a copy of every subtree
	 * it dropped, and most watchers never undo anything (design 156). `inverse()` on a change
	 * delivered to a watcher that did not ask refuses with `inverse-not-asked`.
	 *
	 * Example:
	 *   observer(doc).watch((change) => undos.push(change.inverse()), { inverse: true });
	 */
	watch(fn: (change: Change) => void, options?: { readonly inverse?: boolean }): () => void;
	/** Call `fn` with the value now, and again after every change in scope. */
	effect(fn: (value: unknown) => void): () => void;
}

interface Resolved {
	readonly holder: Node | undefined;
	readonly slot: string | undefined;
}

/** Walk a path to the observable holding its last key, without creating anything. */
const locate = (base: Node, keys: readonly Step[]): Resolved => {
	let holder: Node | undefined = base;

	for (let i = 0; i < keys.length - 1; i++) {
		if (holder === undefined) return { holder: undefined, slot: undefined };

		const key = keys[i]!;
		if (isWild(key)) return { holder: undefined, slot: undefined };
		const cell = holder.slots.get(resolveKey(holder, key));

		// A path walks attach edges and stops at an alias. Delivery walks up the attach edges,
		// so a path that crossed an alias would read a live value that no watcher on it could
		// ever see change: correct once, then silently stale. To follow an alias, read it and
		// start a scope at what it names.
		holder = cell !== undefined && cell.kind === 'ref' && cell.edge === 'attach' && cell.node.parent === holder
			? cell.node
			: undefined;
	}

	if (holder === undefined || keys.length === 0) return { holder, slot: undefined };
	const last = keys[keys.length - 1]!;
	if (isWild(last)) return { holder: undefined, slot: undefined };
	return { holder, slot: resolveKey(holder, last) };
};

/**
 * A scope over a path. It inherits the value combinators from `Chain`, which is what makes
 * `map`, `bool`, `def`, `selector` and the rest available on a scope (design 023).
 *
 * The source those combinators read is built on first use, because most scopes are only
 * narrowed and watched and never asked for a value, and a list builds one per row per binding
 * (design 154). `path`, `ignore`, `shallow`, `skip`, `tree`, `get`, `set`, `watch` and
 * `effect` never build one.
 */
class Scope extends Chain<unknown> implements Observer {
	// Private, so a step carries no own enumerable key: an observer spreads and serializes as
	// the empty object it is, and its state is not something a caller can read off it.
	readonly #base: Node;
	readonly #keys: readonly Step[];
	readonly #ignored: readonly ScopeKey[];
	/** `shallow()` is a method on this object, so the flag it sets carries the other name. */
	readonly #narrow: boolean;
	readonly #wild: boolean;

	constructor(base: Node, keys: readonly Step[], ignored: readonly ScopeKey[], narrow: boolean) {
		super(null);
		this.#base = base;
		this.#keys = keys;
		this.#ignored = ignored;
		this.#narrow = narrow;
		this.#wild = keys.some(isWild);
	}

	// The bridge to the value surface (design 023): this scope seen as a source. The slot is
	// `Chain`'s, reached through its Symbol, because a subclass cannot see a private field.
	override source(): Source {
		let source = this[SLOT];
		if (source === null) {
			source = {
				read: () => this.get(),
				attach: (mark) => this.subscribe(mark),
				write: this.#wild ? undefined : (value) => this.set(value),
				immutable: () => this.#wild,
			};
			this[SLOT] = source;
		}
		return source;
	}

	subscribe(deliver: Listener['deliver'], inverse = false): () => void {
		const listener: Listener = {
			base: this.#base,
			keys: this.#keys,
			ignore: this.#ignored,
			shallow: this.#narrow,
			wild: this.#wild,
			inverse,
			deliver,
		};
		addListener(this.#base, listener);
		return () => removeListener(this.#base, listener);
	}

	override get(): unknown {
		if (this.#wild) return undefined;
		const { holder, slot } = locate(this.#base, this.#keys);
		if (holder === undefined) return undefined;
		if (slot === undefined) return holder.proxy;
		return userValue(holder.slots.get(slot));
	}

	override set(value: unknown): void {
		if (this.#wild) {
			throw codecError('multi-target', 'a wildcard scope names many places and cannot be written as one',
				'Narrow the scope with path until it names one slot, then set that.');
		}
		const { holder, slot } = locate(this.#base, this.#keys);
		if (holder === undefined || slot === undefined) {
			throw codecError('slot-missing', 'nothing holds the slot this path names',
				'Create the observables along the path first, or check get() before setting.');
		}
		write(holder, slot, toCell(value));
	}

	path(...more: ScopeKey[]): Observer {
		return new Scope(this.#base, [...this.#keys, ...more], this.#ignored, this.#narrow);
	}

	ignore(...more: ScopeKey[]): Observer {
		return new Scope(this.#base, this.#keys, [...this.#ignored, ...more], this.#narrow);
	}

	shallow(): Observer {
		return new Scope(this.#base, this.#keys, this.#ignored, true);
	}

	skip(count = 1): Observer {
		const steps: WildStep[] = [];
		if (count === Infinity) steps.push({ run: true });
		else for (let i = 0; i < count; i++) steps.push({ any: true });
		return new Scope(this.#base, [...this.#keys, ...steps], this.#ignored, this.#narrow);
	}

	tree(key: ScopeKey): Observer {
		return new Scope(this.#base, [...this.#keys, { deep: key }], this.#ignored, this.#narrow);
	}

	override watch(fn: (change: Change) => void, options?: { readonly inverse?: boolean }): () => void {
		return this.subscribe((deltas, inverse) => fn(changeOf(deltas, inverse)), options?.inverse === true);
	}

	override effect(fn: (value: unknown) => void): () => void {
		const stop = this.subscribe(() => fn(this.get()));
		try {
			fn(this.get());
		} catch (error) {
			// A throwing first call must not leak a listener nobody holds a handle to.
			stop();
			throw error;
		}
		return stop;
	}
}

/**
 * Start a scope at an observable.
 *
 * Params:
 *   observable: where the scope is rooted. Paths and delivery are relative to it
 *
 * Returns: an observer. Every narrowing returns a new one, so an observer can be kept and
 * narrowed differently in two places without either affecting the other.
 *
 * Throws: `not-observable` when `observable` is not an observable.
 *
 * Example:
 *   const stop = observer(doc).path('settings').ignore('draft').watch((change) => {
 *     send(change.deltas);
 *   });
 */
export const observer = (observable: unknown): Observer => {
	const node = nodeOf(observable);
	if (node === undefined) {
		throw codecError('not-observable', 'observer takes an observable',
			'Pass what createObject, createArray or createMap returned.');
	}
	return new Scope(node, [], [], false);
};
