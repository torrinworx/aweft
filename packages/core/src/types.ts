// The shapes core keeps behind every observable.
//
// None of this is public. A user holds a proxy; the proxy holds a node; the node is what the
// delta and commit machinery reads. Keeping the two apart is what lets an observable's whole
// property space belong to the user, with no name the framework has taken (design 013).

import type { Commit, Delta, EdgeKind, ObservableKind } from '@aweftjs/codec';

/** Everything a slot can hold that is not another observable. */
export type Primitive = null | boolean | number | string | Uint8Array;

export interface ValueCell {
	readonly kind: 'value';
	readonly value: Primitive;
}

export interface RefCell {
	readonly kind: 'ref';
	readonly node: Node;
	readonly edge: EdgeKind;
}

/** What a slot holds: a primitive, or a named observable and the kind of edge naming it. */
export type Cell = ValueCell | RefCell;

export interface Node {
	readonly id: Uint8Array;
	/** The id in text form. Slot maps, indexes and record keys are all keyed by it. */
	readonly key: string;
	readonly kind: ObservableKind;
	readonly slots: Map<string, Cell>;
	/** Arrays only: slot keys in position order, and the values behind the proxy. */
	readonly order: string[];
	readonly values: unknown[];
	readonly listeners: Set<Listener>;

	/** The proxy handed to the user. Assigned once, by the factory that made this node. */
	proxy: object;

	/** The one attach edge, as a parent and the slot in it. Null when nothing attaches this. */
	parent: Node | null;
	slot: string | null;

	/** The document this belongs to. An observable joins one by being attached, and stays. */
	root: Node;
	/** Every node of the document, by key. Held by the root, null everywhere else. */
	index: Map<string, Node> | null;
	/** Listeners anywhere in this document. Held by the root, so a close can skip the work. */
	watchers: number;
}

/** A wildcard scope step: any one key, or any depth ending at a key (design 025). */
export type WildStep = { readonly any: true } | { readonly deep: string | number };

/** One step of a scope: a literal key, or a wildcard. */
export type Step = string | number | WildStep;

/** What a scope narrows to, and who to call. Registered on the observable it was built from. */
export interface Listener {
	readonly base: Node;
	readonly keys: readonly Step[];
	readonly ignore: readonly (string | number)[];
	readonly shallow: boolean;
	/** Any wildcard in the keys, so delivery knows to take the matcher instead of the walk. */
	readonly wild: boolean;
	readonly deliver: (deltas: Delta[], inverses: Delta[]) => void;
}

/**
 * What a watcher is handed: the deltas of one commit that fell inside its scope, and the
 * commit that undoes them.
 *
 * `deltas` is exactly what crosses a boundary, so a watcher on the document root can hand it
 * to an encoder unchanged. `inverse` is built from the values the slots held before, captured
 * while the change was applied, and is never transmitted (design 016).
 */
export interface Change extends Commit {
	readonly deltas: readonly Delta[];
	inverse(): Commit;
}
