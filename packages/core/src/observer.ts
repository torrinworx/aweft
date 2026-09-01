// Scopes: narrowing what a listener sees, and reading or writing what a path names.
//
// An observer is a description, not a subscription to a particular object. It resolves its
// path when it is used, so `path('user', 'name')` is useful before `user` exists and survives
// the slot being removed and made again (design 017).

import { codecError } from '@aweftjs/codec';

import type { Change, Listener, Node } from './types.ts';
import { addListener, removeListener, resolveKey, userValue } from './node.ts';
import { changeOf, write } from './transaction.ts';
import { nodeOf, toCell } from './value.ts';

/** A step in a path: an object or map slot by name, or an array position by index. */
export type ScopeKey = string | number;

/** A scope: what part of the document a listener is about. Narrow it before watching. */
export interface Observer {
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
	 * Call `fn` with each commit that touched this scope. Returns its unsubscribe.
	 *
	 * `fn` runs after the whole commit has been applied, so the tree is never read between the
	 * deltas of one commit. It is the tree as it stands, which is not always the state this
	 * commit produced: a listener earlier in the same delivery may have mutated already, and a
	 * mutation lands as it is written. Read `change.deltas` when the exact state of this commit
	 * is what matters. Commits landed with `apply` arrive here too, indistinguishable from
	 * local mutation.
	 */
	watch(fn: (change: Change) => void): () => void;
	/** Call `fn` with the value now, and again after every change in scope. */
	effect(fn: (value: unknown) => void): () => void;
}

interface Resolved {
	readonly holder: Node | undefined;
	readonly slot: string | undefined;
}

/** Walk a path to the observable holding its last key, without creating anything. */
const locate = (base: Node, keys: readonly ScopeKey[]): Resolved => {
	let holder: Node | undefined = base;

	for (let i = 0; i < keys.length - 1; i++) {
		if (holder === undefined) return { holder: undefined, slot: undefined };

		const cell = holder.slots.get(resolveKey(holder, keys[i]!));

		// A path walks attach edges and stops at an alias. Delivery walks up the attach edges,
		// so a path that crossed an alias would read a live value that no watcher on it could
		// ever see change: correct once, then silently stale. To follow an alias, read it and
		// start a scope at what it names.
		holder = cell !== undefined && cell.kind === 'ref' && cell.edge === 'attach' && cell.node.parent === holder
			? cell.node
			: undefined;
	}

	if (holder === undefined || keys.length === 0) return { holder, slot: undefined };
	return { holder, slot: resolveKey(holder, keys[keys.length - 1]!) };
};

const build = (
	base: Node,
	keys: readonly ScopeKey[],
	ignored: readonly ScopeKey[],
	shallow: boolean,
): Observer => {
	const subscribe = (deliver: Listener['deliver']): (() => void) => {
		const listener: Listener = { base, keys, ignore: ignored, shallow, deliver };
		addListener(base, listener);
		return () => removeListener(base, listener);
	};

	const observer: Observer = {
		get: () => {
			const { holder, slot } = locate(base, keys);
			if (holder === undefined) return undefined;
			if (slot === undefined) return holder.proxy;
			return userValue(holder.slots.get(slot));
		},

		set: (value) => {
			const { holder, slot } = locate(base, keys);
			if (holder === undefined || slot === undefined) {
				throw codecError('slot-missing', 'nothing holds the slot this path names');
			}
			write(holder, slot, toCell(value));
		},

		path: (...more) => build(base, [...keys, ...more], ignored, shallow),

		ignore: (...more) => build(base, keys, [...ignored, ...more], shallow),

		shallow: () => build(base, keys, ignored, true),

		watch: (fn) => subscribe((deltas, inverses) => fn(changeOf(deltas, inverses))),

		effect: (fn) => {
			const stop = subscribe(() => fn(observer.get()));
			fn(observer.get());
			return stop;
		},
	};

	return observer;
};

/**
 * Start a scope at an observable.
 *
 * Params:
 *   observable: where the scope is rooted. Paths and delivery are relative to it
 *
 * Returns: an observer. Every narrowing returns a new one, so an observer can be kept and
 * narrowed differently in two places without either affecting the other.
 *
 * Example:
 *   const stop = observer(doc).path('settings').ignore('draft').watch((change) => {
 *     send(change.deltas);
 *   });
 */
export const observer = (observable: unknown): Observer => {
	const node = nodeOf(observable);
	if (node === undefined) throw codecError('not-observable', 'observer takes an observable');
	return build(node, [], [], false);
};
