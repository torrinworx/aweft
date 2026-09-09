// The mounter: one walk from an item to node operations, in three modes (design 077).
//
// A mount is a handle: its first live node, for anchoring the mount before it, and how to
// remove it. Every kind of item gets one. User code (component bodies, `mounted`, `cleanup`)
// never runs inside the walk; it is queued on the mount root and drained when the walk is
// done, so a component that edits state while mounting cannot reenter a reconciliation.

import { isMutableArray, isObservable, kindOf, observer, positionsOf } from '@aweftjs/core';
import type { ArrayChange, Change, MutableArray } from '@aweftjs/core';

import { assert } from './assert.ts';
import { setActiveDocument } from './ambient.ts';
import { type ChildSignal, type Signal, isBound } from './bound.ts';
import { Hydration, type Region, type Scope } from './hydration.ts';
import { type Before, type Handle, type List, type Step, createList, hex, seek } from './list.ts';
import type { DocumentLike, ElementLike, NodeLike, ParentLike, TextLike } from './types.ts';
import { ELEMENT, isNodeLike, isSource } from './types.ts';
import { markMade, setRecording } from './props.ts';
import { RERUN, abortRow, beginRow, endRow } from './row-template.ts';

/**
 * Ask a remove function for the first live node of its mount instead of removing it.
 *
 * `mount` returns a function; called with nothing it unmounts, called with `getFirst` it
 * answers the first node the mount put in the document, or the node after it when the mount
 * has none. A component that returns a mounter uses it on the `before` it was handed.
 *
 * Example:
 *   const anchor = before(getFirst);
 */
export const getFirst: unique symbol = Symbol('aweft.getFirst');

/** What `mount` returns: call it to unmount, or with `getFirst` for the first live node. */
export type Remove = (arg?: typeof getFirst) => NodeLike | null | undefined;

/** A component that mounts itself: what `h` makes of a component, and what one may return. */
export type Mounter = (elem: ParentLike, item: unknown, before: Remove, context: unknown) => Remove;

export type Cleanup = (...fns: (() => void)[]) => void;
export type Mounted = (...fns: (() => void)[]) => void;
export type Pending = (promise: Promise<unknown>) => void;

/** A component: called once with its props, and what it returns is mounted. */
export type Component<P = Record<string, unknown>> =
	(props: P & { children: unknown[]; each?: unknown }, cleanup: Cleanup, mounted: Mounted, pending: Pending) => unknown;

/** A mounter `h` made carries its handle factory, so the walk need not go through `Remove`. */
const DIRECT: unique symbol = Symbol('aweft.direct');
type Direct = Mounter & { [DIRECT]: (ctx: Ctx, before: Before) => Handle };

interface Root {
	readonly queue: (() => void)[];
	draining: boolean;
	readonly pending: Set<Promise<unknown>>;
	readonly document: DocumentLike;
	readonly markers: boolean;
	hydration: Hydration | null;
}

interface Ctx {
	readonly root: Root;
	readonly elem: ParentLike;
	readonly scope: Scope | null;
	readonly context: unknown;
	readonly owner: ComponentRecord | null;
}

interface ComponentRecord {
	dead: boolean;
	bodyDone: boolean;
	pending: number;
	fired: boolean;
	readonly owner: ComponentRecord | null;
	readonly cleanups: (() => void)[];
	readonly mountedCbs: (() => void)[];
	readonly root: Root;
}

/** The root and hydration scope whose user code is running, so a nested `mount` joins it. */
let current: { root: Root; scope: Scope | null; owner: ComponentRecord | null } | null = null;

const documentOf = (elem: ParentLike): DocumentLike => {
	const own = elem.ownerDocument;
	if (own !== undefined && own !== null) return own;
	const page = (globalThis as { document?: DocumentLike }).document;
	assert(page !== undefined, 'mount needs a document: the target has none and there is no page; mount into a node from createDocument instead');
	return page!;
};

export const createRoot = (document: DocumentLike, markers: boolean, hydration: Hydration | null): Root =>
	({ queue: [], draining: false, pending: new Set(), document, markers, hydration });

const drain = (root: Root): void => {
	if (root.draining) return;
	root.draining = true;
	let failure: unknown;
	let failed = false;
	try {
		while (root.queue.length > 0) {
			const job = root.queue.shift()!;
			try {
				job();
			} catch (error) {
				// The rest of the queue still runs; the first error reaches whoever made the change.
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		}
	} finally {
		root.draining = false;
	}
	if (failed) throw failure;
};

/** Run `fn` as this root's work, and drain the queue after it when nothing outer will. */
const withRoot = <T>(root: Root, scope: Scope | null, owner: ComponentRecord | null, fn: () => T): T => {
	const outer = current;
	current = { root, scope, owner };
	setActiveDocument(root.document);
	// The one choke point every mount and every delivery passes through, so it is where the
	// hydration bookkeeping learns whether anything will ever read it (design 098).
	const recorded = setRecording(root.hydration !== null);
	try {
		return fn();
	} finally {
		current = outer;
		setRecording(recorded);
		setActiveDocument(outer === null ? null : outer.root.document);
		if (outer === null || outer.root !== root) drain(root);
	}
};

const enqueue = (root: Root, job: () => void): void => {
	root.queue.push(job);
	if (current === null) drain(root);
};

export const runMount = <T>(root: Root, scope: Scope | null, fn: () => T): T => withRoot(root, scope, null, fn);

/** The public shape: `getFirst` answers the first node, or the anchor when the mount has none. */
const toRemove = (handle: Handle, before: Before): Remove => (arg) => {
	if (arg === getFirst) return handle.first() ?? before();
	handle.remove();
	return undefined;
};

const fromRemove = (remove: Remove): Handle => ({
	first: () => remove(getFirst) ?? null,
	remove: () => { remove(); },
});

const detach = (node: NodeLike): void => {
	// Something else may have removed it already: a cleared parent, or a browser extension.
	node.parentNode?.removeChild(node);
};

/** Under hydration, the server's node that stands for this one; otherwise null. */
const claimed = (ctx: Ctx, node: NodeLike): NodeLike | null =>
	(ctx.scope !== null && ctx.root.hydration !== null ? ctx.root.hydration.claim(ctx.scope, node) : null);

/**
 * How a mount takes its node back out. A target that is not a node (a duck-typed one) never
 * sets `parentNode`, so it is asked outright; a real parent is asked only while it still
 * holds the node, because something else may have taken it first.
 */
const remover = (elem: ParentLike, node: NodeLike): (() => void) => {
	const ducked = node.parentNode !== elem;
	return () => {
		if (ducked || node.parentNode === elem) elem.removeChild(node);
	};
};

/**
 * Mount an item under a target.
 *
 * Params:
 *   elem: an element, or anything with `insertBefore`, `removeChild` and `replaceChild`
 *   item: null, a primitive, a node, `h()` output, an iterable, a document array, a mutable
 *         array, a scope, cell or derived value, or a mounter
 *   before: the anchor: a remove function whose `getFirst` answer the item goes before.
 *           Omitted, the item goes at the end
 *   context: an opaque value handed to every mounter below, and to nothing else
 *
 * Returns: the remove function. Call it to unmount; call it with `getFirst` for the first
 * live node. `undefined` is refused: hide something with `null`.
 *
 * Throws: an assert, loud in development and stripped in a release build. `undefined` as the
 * item, `null` as the anchor, a plain object, a node already mounted elsewhere and a target
 * with no document are all caller mistakes rather than data the mounter refuses.
 *
 * Example:
 *   const stop = mount(document.body, h('p', {}, 'hello ', name));
 *   stop();
 */
export const mount = (elem: ParentLike, item: unknown, before?: Remove, context?: unknown): Remove => {
	// A null anchor otherwise reaches the closure below and fails there as `before is not a
	// function`, which names neither the argument nor what to pass instead.
	assert((before as Remove | null | undefined) !== null,
		'the before anchor cannot be null; leave the argument off to mount at the end');
	const anchor: Before = before === undefined ? () => null : () => before(getFirst) ?? null;
	if (current !== null) {
		const { root, scope, owner } = current;
		const own = scope !== null && scope.parent === elem ? scope : (root.hydration?.scopeOf(elem) ?? null);
		return toRemove(mountItem({ root, elem, scope: own, context, owner }, item, anchor), anchor);
	}
	const root = createRoot(documentOf(elem), false, null);
	return toRemove(withRoot(root, null, null, () => mountItem({ root, elem, scope: null, context, owner: null }, item, anchor)), anchor);
};

const isDocumentArray = (value: unknown): value is unknown[] => isObservable(value) && kindOf(value) === 'array';

const isIterable = (value: unknown): value is Iterable<unknown> =>
	typeof value === 'object' && value !== null && Symbol.iterator in value;

export const mountItem = (ctx: Ctx, item: unknown, before: Before): Handle => {
	assert(item !== undefined, 'cannot mount undefined; hide something with null instead');
	if (item === null || item === undefined) return nullHandle();

	if (isBound(item)) return nodeHandle(ctx, item.node, item.signals, before);
	if (isNodeLike(item)) return nodeHandle(ctx, item, null, before);
	if (typeof item === 'function') {
		const direct = (item as Partial<Direct>)[DIRECT];
		if (direct !== undefined) return direct(ctx, before);
		const run = item as Mounter;
		return withRoot(ctx.root, ctx.scope, ctx.owner, () =>
			fromRemove(run(ctx.elem, item, (arg) => (arg === getFirst ? before() : undefined), ctx.context)));
	}
	if (isSource(item)) return dynamicHandle(ctx, item, before);
	if (isDocumentArray(item) || isMutableArray(item) || isIterable(item)) {
		return listHandle(ctx, item, before, (value, b, scope) => mountItem({ ...ctx, scope }, value, b));
	}
	if (typeof item !== 'object') return textHandle(ctx, item, before);

	assert(false, 'a plain object cannot be mounted; pass something iterable, a node, or a component');
	return nullHandle();
};

const nullHandle = (): Handle => ({
	first: () => null,
	remove: () => undefined,
	update: (value) => value === null,
});

const textHandle = (ctx: Ctx, item: unknown, before: Before): Handle => {
	const fresh = markMade(ctx.root.document.createTextNode(String(item)));
	let node = claimed(ctx, fresh) as TextLike | null;
	if (node === null) {
		node = fresh;
		ctx.elem.insertBefore(node, before());
	}
	const remove = remover(ctx.elem, node);
	return {
		first: () => node,
		remove: (gone) => { if (!gone) remove(); },
		update: (value) => {
			if (value === null || typeof value === 'object' || typeof value === 'function') return false;
			node.data = String(value);
			return true;
		},
	};
};

/**
 * Where a reactive child goes: before the first node of the next reactive siblings that
 * share its static neighbour, otherwise before that neighbour.
 */
const beforeOf = (signal: ChildSignal): Before => () => {
	for (let s = signal.next; s !== null && s.staticNext === signal.staticNext; s = s.next) {
		const node = s.handle?.first() ?? null;
		if (node !== null) return node;
	}
	return signal.staticNext;
};

const nodeHandle = (ctx: Ctx, fresh: NodeLike, signals: Signal[] | null, before: Before): Handle => {
	assert(fresh.parentNode === null, 'cannot mount a node that is already mounted elsewhere; clone it or remove it first');

	// Under hydration the node in the document is the server's, and every signal that named
	// the fresh one, or a node inside it, now names its pair. Otherwise the subtree is bound
	// first and inserted whole, so nothing lands in the document one node at a time.
	const server = claimed(ctx, fresh);
	const node = server ?? fresh;
	const paired = ctx.root.hydration?.paired;
	const live = <N extends NodeLike | null>(n: N): N =>
		(server !== null && paired !== undefined && n !== null ? ((paired.get(n) as N | undefined) ?? n) : n);

	const stops: (() => void)[] = [];
	const children: ChildSignal[] = [];
	if (signals !== null) {
		for (const signal of signals) {
			if (signal.kind === 'prop') {
				const element = live(signal.element);
				const target = signal.via === null ? element : (element as Record<string, unknown>)[signal.via] as object;
				const { name, set } = signal;
				stops.push(signal.source.effect((value) => set(target, name, value)));
			} else {
				signal.parent = live(signal.parent);
				signal.staticNext = live(signal.staticNext);
				children.push(signal);
			}
		}
		for (const signal of children) {
			const scope = server === null ? null : (ctx.root.hydration?.scopeOf(signal.parent) ?? null);
			const inner: Ctx = { root: ctx.root, elem: signal.parent, scope, context: ctx.context, owner: ctx.owner };
			signal.handle = mountItem(inner, signal.item, beforeOf(signal));
		}
	}

	if (server === null) ctx.elem.insertBefore(node, before());
	const remove = remover(ctx.elem, node);

	return {
		first: () => node,
		remove: (gone) => {
			for (const stop of stops) stop();
			stops.length = 0;
			// A node leaving on its own can be mounted again, so what this mount put inside it
			// comes back out and the element is left as `h` built it (design 204). With `gone`
			// an ancestor is already out and the children only let go of what they hold.
			for (const signal of children) {
				signal.handle?.remove(gone);
				signal.handle = null;
			}
			if (!gone) remove();
		},
		update: (value) => value === fresh || value === node,
	};
};

/** Wrap a dynamic mount: markers around it when rendering, its region when hydrating. */
const bracketed = (ctx: Ctx, before: Before, inner: (before: Before, scope: Scope | null) => Handle): Handle => {
	const { root } = ctx;
	if (root.hydration !== null && ctx.scope !== null) {
		const region: Region | null = root.hydration.region(ctx.scope);
		if (region !== null) return withMarkers(inner(() => region.end, region.scope), region.start, region.end);
	}
	if (root.markers) {
		const end = root.document.createComment(']');
		const start = root.document.createComment('[');
		ctx.elem.insertBefore(end, before());
		ctx.elem.insertBefore(start, end);
		return withMarkers(inner(() => end, null), start, end);
	}
	return inner(before, ctx.scope);
};

const withMarkers = (handle: Handle, start: NodeLike, end: NodeLike): Handle => ({
	first: () => start,
	remove: (gone) => {
		handle.remove(gone);
		if (!gone) {
			detach(start);
			detach(end);
		}
	},
	...(handle.update === undefined ? {} : { update: handle.update.bind(handle) }),
});

const dynamicHandle = (ctx: Ctx, source: { effect(fn: (v: unknown) => void): () => void }, before: Before): Handle =>
	bracketed(ctx, before, (innerBefore, scope) => {
		const inner: Ctx = { ...ctx, scope };
		let live: Handle | null = null;
		let dead = false;

		const apply = (value: unknown): void => {
			if (dead) return;
			assert(value !== undefined, 'a mounted value resolved to undefined; put null in the cell to hide something');
			assert(!isSource(value), 'a value that is itself a scope or cell cannot be mounted; unwrap it with get first');
			if (value === undefined) value = null;
			if (live !== null && live.update !== undefined && live.update(value)) return;
			live?.remove();
			live = mountItem(inner, value, innerBefore);
		};

		const stop = source.effect((value) => withRoot(ctx.root, scope, ctx.owner, () => apply(value)));
		return {
			first: () => (live === null ? null : live.first()),
			remove: (gone) => {
				dead = true;
				stop();
				live?.remove(gone);
				live = null;
			},
		};
	});

/** How a list mounts one item: with the value, the anchor, and the hydration scope of its region. */
type MountOne = (value: unknown, before: Before, scope: Scope | null) => Handle;

const listHandle = (ctx: Ctx, source: unknown, before: Before, mountOne: MountOne): Handle => {
	if (isDocumentArray(source)) return bracketed(ctx, before, (b, scope) => documentList(ctx, scope, source, b, mountOne));
	if (isMutableArray(source)) return bracketed(ctx, before, (b, scope) => mutableList(ctx, scope, source as MutableArray<unknown>, b, mountOne));
	if (isSource(source)) {
		return bracketed(ctx, before, (b, scope) => {
			const inner: Ctx = { ...ctx, scope };
			let list: List | null = null;
			const stop = source.effect((value) => withRoot(ctx.root, scope, ctx.owner, () => {
				assert(isIterable(value), 'the each property must be iterable; pass an array, a document array or a Set');
				if (list === null) list = itemList(inner, b, mountOne, value as Iterable<unknown>);
				else list.setItems(value as Iterable<unknown>);
			}));
			return {
				first: () => (list === null ? null : list.first()),
				remove: (gone) => {
					stop();
					list?.removeAll(gone);
				},
			};
		});
	}
	assert(isIterable(source), 'the each property must be iterable; pass an array, a document array or a Set');
	// A plain iterable is static: its items get no markers of their own.
	const list = itemList(ctx, before, mountOne, source as Iterable<unknown>, false);
	return {
		first: list.first,
		remove: list.removeAll,
		update: (value) => {
			if (!isIterable(value) || isDocumentArray(value) || isMutableArray(value)) return false;
			list.setItems(value);
			return true;
		},
	};
};

/** Each item of a reactive list is a dynamic mount of its own, with its own markers or region. */
const itemMounter = (ctx: Ctx, mountOne: MountOne, dynamic: boolean) =>
	(value: unknown, before: Before): Handle =>
		(dynamic ? bracketed(ctx, before, (b, scope) => mountOne(value, b, scope)) : mountOne(value, before, ctx.scope));

const itemList = (ctx: Ctx, before: Before, mountOne: MountOne, items: Iterable<unknown>, dynamic = true): List => {
	const list = createList({ elem: ctx.elem, before, mountItem: itemMounter(ctx, mountOne, dynamic) });
	list.apply([...items].map((value, at) => ({ type: 'add', at, value })));
	return list;
};

const documentList = (ctx: Ctx, scope: Scope | null, source: unknown[], before: Before, mountOne: MountOne): Handle => {
	const inner: Ctx = { ...ctx, scope };
	const list = createList({ elem: ctx.elem, before, mountItem: itemMounter(inner, mountOne, true) });
	const keys: string[] = positionsOf(source).map(hex);
	list.apply(source.map((value, at) => ({ type: 'add', at, value })));

	const applyCommit = (change: Change): void => {
		const removed: string[] = [];
		const added: string[] = [];
		for (const delta of change.deltas) {
			if (delta.ref.kind !== 'array') continue;
			const key = hex(delta.ref.key);
			if (delta.type !== 'add') removed.push(key);
			if (delta.type !== 'remove') added.push(key);
		}
		if (added.length === 0 && removed.length > 0 && removed.length === keys.length) {
			// Everything goes: no need to find each row's index one splice at a time.
			keys.length = 0;
			list.apply(removed.map((_, i) => ({ type: 'remove', at: removed.length - 1 - i })));
			return;
		}
		const steps: Step[] = [];
		for (const key of removed) {
			const at = seek(keys, key);
			if (keys[at] !== key) continue;
			keys.splice(at, 1);
			steps.push({ type: 'remove', at });
		}
		added.sort();
		for (const key of added) {
			const at = seek(keys, key);
			keys.splice(at, 0, key);
			steps.push({ type: 'add', at, value: source[at] });
		}
		list.apply(steps);
	};

	let dead = false;
	const stop = observer(source).shallow().watch((change) => {
		// A commit queued before this list was removed still arrives; it is nobody's now.
		if (dead) return;
		withRoot(ctx.root, scope, ctx.owner, () => applyCommit(change));
	});

	return {
		first: list.first,
		remove: (gone) => {
			dead = true;
			stop();
			list.removeAll(gone);
		},
	};
};

const mutableList = (ctx: Ctx, scope: Scope | null, source: MutableArray<unknown>, before: Before, mountOne: MountOne): Handle => {
	const inner: Ctx = { ...ctx, scope };
	const list = createList({ elem: ctx.elem, before, mountItem: itemMounter(inner, mountOne, true) });
	list.apply([...source].map((value, at) => ({ type: 'add', at, value })));

	let dead = false;
	const stop = source.watch((changes: readonly ArrayChange<unknown>[]) => {
		if (dead) return;
		withRoot(ctx.root, scope, ctx.owner, () => list.apply(changes));
	});

	return {
		first: list.first,
		remove: (gone) => {
			dead = true;
			stop();
			list.removeAll(gone);
		},
	};
};

const nameOf = (fn: Function): string => (fn.name === '' ? 'an anonymous component' : fn.name);

/** Mark a component's subtree complete, so its `mounted` callbacks can run, children first. */
const complete = (rec: ComponentRecord): void => {
	if (rec.fired || !rec.bodyDone || rec.pending > 0) return;
	rec.fired = true;
	const callbacks = rec.mountedCbs.splice(0, rec.mountedCbs.length);
	for (const fn of callbacks) enqueue(rec.root, fn);
	if (rec.owner !== null) {
		rec.owner.pending -= 1;
		complete(rec.owner);
	}
};

/**
 * What `h` makes of a component: a mounter that runs the body from the queue. With `each`,
 * a list mount that runs the body once per item, the item in `props.each`.
 */
export const componentMounter = (component: Component, props: Record<string, unknown>, each: boolean): Mounter => {
	const handleOf = (ctx: Ctx, anchor: Before): Handle => {
		if (!each) return componentHandle(ctx, component, props, undefined, anchor);
		return listHandle(ctx, props['each'], anchor, (value, b, scope) => componentHandle({ ...ctx, scope }, component, props, value, b));
	};
	const mounter: Mounter = (elem, _item, before, context) => {
		assert(current !== null, 'a component mounts inside a mount; call it through mount, render or hydrate');
		const { root, scope, owner } = current!;
		const own = scope !== null && scope.parent === elem ? scope : (root.hydration?.scopeOf(elem) ?? null);
		const anchor: Before = () => before(getFirst) ?? null;
		return toRemove(handleOf({ root, elem, scope: own, context, owner }, anchor), anchor);
	};
	(mounter as Direct)[DIRECT] = handleOf;
	return mounter;
};

export const componentHandle = (ctx: Ctx, component: Component, props: Record<string, unknown>, eachValue: unknown, before: Before): Handle =>
	bracketed(ctx, before, (innerBefore, scope) => {
		const rec: ComponentRecord = {
			dead: false, bodyDone: false, pending: 0, fired: false,
			owner: ctx.owner, cleanups: [], mountedCbs: [], root: ctx.root,
		};
		if (rec.owner !== null) rec.owner.pending += 1;
		const inner: Ctx = { root: ctx.root, elem: ctx.elem, scope, context: ctx.context, owner: rec };
		let out: Handle | null = null;

		const cleanup: Cleanup = (...fns) => {
			for (const fn of fns) {
				if (rec.dead) enqueue(rec.root, fn);
				else rec.cleanups.push(fn);
			}
		};
		const mounted: Mounted = (...fns) => {
			assert(!rec.bodyDone, 'mounted may only be called while the component is mounting; call it from the body, not from a callback');
			rec.mountedCbs.push(...fns);
		};
		const pending: Pending = (promise) => {
			rec.root.pending.add(promise);
			promise.then(() => rec.root.pending.delete(promise), () => rec.root.pending.delete(promise));
		};

		enqueue(ctx.root, () => {
			if (rec.dead) {
				// Removed before its body ran: the subtree is nobody's, and the owner stops waiting.
				rec.bodyDone = true;
				complete(rec);
				return;
			}
			// A row's own props object, so a function the body keeps reads this row's item and
			// not whatever the last row left behind (design 205).
			const own = eachValue === undefined ? props : { ...props, each: eachValue };
			// A row of a list: record the first one's shape, then clone it for the rest
			// (design 099). The props object is the call site, so it is the cache key.
			const mode = eachValue === undefined ? 0 : beginRow(props, ctx.root.hydration !== null);
			const callbacks = rec.mountedCbs.length;
			const cleanups = rec.cleanups.length;
			let result: unknown;
			try {
				const body = (): unknown => withRoot(ctx.root, scope, rec, () =>
					component(own as Parameters<Component>[0], cleanup, mounted, pending));
				result = body();
				if (mode !== 0) {
					result = endRow(props, mode, result);
					if (result === RERUN) {
						// This row built a different shape from the recorded one, so it built no
						// nodes at all and has to run again. What the abandoned attempt asked for
						// through `mounted` and `cleanup` is dropped, so neither fires twice.
						rec.mountedCbs.length = callbacks;
						rec.cleanups.length = cleanups;
						result = body();
					}
				}
			} catch (error) {
				if (mode !== 0) abortRow(props, mode);
				rec.bodyDone = true;
				rec.mountedCbs.length = 0;
				complete(rec);
				if (error instanceof Error && !error.message.startsWith(`in ${nameOf(component)}: `)) {
					error.message = `in ${nameOf(component)}: ${error.message}`;
				}
				throw error;
			}
			rec.bodyDone = true;
			if (rec.dead) {
				complete(rec);
				return;
			}
			out = withRoot(ctx.root, scope, rec, () => mountItem(inner, result, innerBefore));
			complete(rec);
		});

		return {
			first: () => (out === null ? null : out.first()),
			remove: (gone) => {
				// Dead first, so a cleanup that reaches back sees the mount as already gone; a
				// second removal finds nothing left to remove and no cleanups left to run.
				rec.dead = true;
				out?.remove(gone);
				out = null;
				const fns = rec.cleanups.splice(0, rec.cleanups.length);
				for (const fn of fns) enqueue(rec.root, fn);
			},
		};
	});

export type { Handle };
/**
 * Is this already the mounter `h` makes of a component, rather than a bare function?
 *
 * Params:
 *   value: anything an application would hand `mount`, `render`, `hydrate` or `attach`
 *
 * Returns: true for what `h(Component, props)` answers, false for everything else, a bare
 * function included.
 *
 * Whoever wants a bare function mounted as a component with no props asks first, because
 * wrapping a component call a second time would call it with a component's arguments.
 * `hydrate` asks (design 157), and so does `ssg`'s `attach`.
 *
 * Example:
 *   const mounted = typeof item === 'function' && !isComponentCall(item) ? h(item) : item;
 */
export const isComponentCall = (value: unknown): boolean =>
	typeof value === 'function' && (value as Partial<Direct>)[DIRECT] !== undefined;
export const pendingOf = (root: Root): Set<Promise<unknown>> => root.pending;
export const drainRoot = drain;
export const hydrationOf = (root: Root): Hydration | null => root.hydration;
/** Whether the mount running right now is claiming server nodes. A hoisted template asks,
 * because a claimed node has to be one the binding made rather than a clone. */
export const hydrating = (): boolean => current !== null && current.root.hydration !== null;
export const endHydration = (root: Root): void => {
	root.hydration?.finish();
	root.hydration = null;
};
/** Close the pairing walk without checking it: the mount it belonged to has gone (design 243). */
export const dropHydration = (root: Root): void => {
	root.hydration = null;
};
export type { Root };
