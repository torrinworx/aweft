// The row template: build one row of a list through `h`, remember its nodes and the places
// that vary, and clone that row for every later row of the same list (design 099).
//
// The other template is `template.ts`, the hoisted one `build` emits. That one learns the shape
// at compile time from the source and is the primary path; this one learns it at run time from
// the first row, and is what an application that does not run `build` gets instead. A compiled
// row body calls `template` and never `h`, so the recorder here finds nothing it made, gives the
// call site up on the first row, and every row after it goes straight through.
//
// The first call of a component used under `each` runs the ordinary path and records, as it
// goes, one hole for every value the body handed `h`: each text child, each reactive child,
// each attribute, each property. The element it returns is cloned before anything is bound, so
// the clone holds the static shape and none of the reactive writes.
//
// Later rows run their body again, because the body is where a row's own sources come from,
// but `h` builds nothing: it files the call's props and children away and returns CLONED. The
// clone then takes those values. A value equal to the one the first row wrote costs no DOM
// call, which is most of the saving: an attribute the same on every row is written once, ever.
//
// The shape contract is that every call renders the same node shape: the same tags in the same
// order, the same prop keys, and a child present on one row present on all of them. This file does
// not verify it. Two breaks are caught because catching them is free: a row that did not return
// the element the first row returned, which `endRow` answers with RERUN so the row runs again
// untemplated, and a row that called `h` a different number of times, which is a loud assert
// because there is nothing sane to do with values that no longer line up with the holes.

import { assert } from './assert.ts';
import { BOUND, type Bound, type ChildSignal, type Signal, isBound } from './bound.ts';
import { bindAttribute, bindProperty } from './bind.ts';
import type { ElementLike, NodeLike, TextLike } from './types.ts';
import { isSource } from './types.ts';

const TEXT = 0;
const CHILD = 1;
const ATTR = 2;
const PROP = 3;

interface Hole {
	readonly kind: number;
	/** Which recorded node it writes to, as an index into the template's nodes. */
	at: number;
	/** The attribute name, or the property key with its `$`. */
	readonly name: string;
	/** Where the value sits in the call's children. */
	readonly child: number;
	/** What the first row wrote, so an identical value costs no DOM call. */
	readonly was: unknown;
	/** For a reactive child: the recorded node it goes before, or -1 for the end of its parent. */
	anchor: number;
	/** Record time only: the node and the signal the hole was found on. */
	node: NodeLike | null;
	signal: ChildSignal | null;
}

interface Call {
	readonly holes: Hole[];
}

interface RowTemplate {
	/** The row itself, already cloned, so stamping never touches what the first row mounted. */
	readonly row: NodeLike;
	readonly calls: readonly Call[];
	/** One path of child indices per recorded node, from the row's own element down. */
	readonly paths: readonly number[][];
}

/** The values one replayed `h` call was given, read back when the clone is stamped. */
interface Values {
	readonly given: Record<string, unknown>;
	readonly children: unknown[];
}

interface Trace {
	readonly calls: Call[];
	readonly made: Set<unknown>;
	/** Every element the row's `h` calls made, so `build` can refuse one that is not in the row. */
	readonly built: NodeLike[];
	/** Every node the row's `h` calls made, so `build` can refuse a row holding anything else. */
	readonly own: Set<NodeLike>;
	readonly indexOf: Map<NodeLike, number>;
	readonly nodes: NodeLike[];
	open: Hole[];
	failed: boolean;
}

type Entry = RowTemplate | 'off';

/**
 * One template per call site, not per component. The same component under two `each` lists is
 * two shapes whenever a prop of the list decides the markup, and a per-function cache hands
 * the second list the first one's row. `h` makes one props object per call site, so that
 * object's identity is the call site.
 */
const cache = new WeakMap<object, Entry>();

let recording: Trace | null = null;
let replaying: { template: RowTemplate; values: Values[] } | null = null;

/** What a replayed `h` returns: the clone already holds this element. */
export const CLONED: unique symbol = Symbol('aweft.cloned');

/** `endRow`'s answer when the body did not build the row the first one built. */
export const RERUN: unique symbol = Symbol('aweft.rerun');

export const isRowRecording = (): boolean => recording !== null;
export const isRowReplaying = (): boolean => replaying !== null;

const indexOf = (trace: Trace, node: NodeLike): number => {
	const known = trace.indexOf.get(node);
	if (known !== undefined) return known;
	const at = trace.nodes.length;
	trace.nodes.push(node);
	trace.indexOf.set(node, at);
	return at;
};

const hole = (kind: number, node: NodeLike | null, name: string, child: number, was: unknown, signal: ChildSignal | null): Hole =>
	({ kind, at: -1, name, child, was, anchor: -1, node, signal });

/**
 * A node this row did not make: fine when this row's own `h` made it, because the template
 * holds it, and fatal otherwise, because no clone can carry a node the application owns.
 */
export const traceNode = (child: unknown): void => {
	if (recording !== null && !recording.made.has(child)) recording.failed = true;
};

export const traceText = (node: NodeLike, child: number, value: unknown): void => {
	if (recording === null) return;
	recording.own.add(node);
	recording.open.push(hole(TEXT, node, '', child, value, null));
};

export const traceChild = (signal: ChildSignal, child: number): void => {
	if (recording !== null) recording.open.push(hole(CHILD, signal.parent, '', child, undefined, signal));
};

export const traceProp = (element: ElementLike, key: string, value: unknown): void => {
	// A source is never compared against, and holding the first row's would keep that row's
	// observer chain alive for as long as the list's call site exists.
	if (recording !== null) {
		recording.open.push(hole(key[0] === '$' ? PROP : ATTR, element, key, -1, isSource(value) ? undefined : value, null));
	}
};

/** Close one `h` call: its holes take their node indices, and a reactive child its anchor. */
export const traceClose = (element: ElementLike, result: unknown): void => {
	const trace = recording;
	if (trace === null) return;
	for (const open of trace.open) {
		open.at = indexOf(trace, open.node!);
		open.node = null;
		const signal = open.signal;
		if (signal !== null) {
			open.anchor = signal.staticNext === null ? -1 : indexOf(trace, signal.staticNext);
			open.signal = null;
		}
	}
	trace.calls.push({ holes: trace.open });
	trace.open = [];
	trace.built.push(element);
	trace.own.add(element);
	trace.made.add(element);
	trace.made.add(result);
};

export const replayCall = (given: Record<string, unknown>, children: unknown[]): symbol => {
	// `h`'s own per-child guard sits below the replay, so it never runs on a row after the first.
	// The refusal is repeated here, in the same words, because a footgun that goes quiet under
	// `each` is worse than one that is loud everywhere: without it a value that went missing on
	// the second row renders an empty gap and says nothing.
	for (const child of children) assert(child !== undefined, 'cannot mount undefined; hide something with null');
	replaying!.values.push({ given, children });
	return CLONED;
};

/** The path of child indices from the row's element down to a recorded node. */
const pathTo = (row: NodeLike, node: NodeLike): number[] | null => {
	const path: number[] = [];
	let n: NodeLike | null = node;
	while (n !== null && n !== row) {
		let at = 0;
		for (let p = n.previousSibling; p !== null; p = p.previousSibling) at += 1;
		path.push(at);
		n = n.parentNode as NodeLike | null;
	}
	if (n !== row) return null;
	return path.reverse();
};

const nodeAt = (row: NodeLike, path: readonly number[]): NodeLike => {
	let n = row;
	for (let i = 0; i < path.length; i += 1) {
		let child = n.firstChild!;
		for (let k = path[i]!; k > 0; k -= 1) child = child.nextSibling!;
		n = child;
	}
	return n;
};

const clonable = (node: NodeLike): node is NodeLike & { cloneNode(deep: boolean): NodeLike } =>
	typeof (node as { cloneNode?: unknown }).cloneNode === 'function';

/**
 * Start a row. 0 builds it the ordinary way, 1 records it, 2 clones the recorded one.
 *
 * Hydration never templates: there the document already exists and the fresh nodes are only
 * there to be paired, one by one, against the server's.
 */
export const beginRow = (site: object, hydrating: boolean): number => {
	if (hydrating || recording !== null || replaying !== null) return 0;
	const entry = cache.get(site);
	if (entry === 'off') return 0;
	if (entry === undefined) {
		recording = { calls: [], made: new Set(), built: [], own: new Set(), indexOf: new Map(), nodes: [], open: [], failed: false };
		return 1;
	}
	replaying = { template: entry, values: [] };
	return 2;
};

/** A row whose body threw. A first row that throws takes its call site out for good. */
export const abortRow = (site: object, mode: number): void => {
	if (mode === 1) cache.set(site, 'off');
	recording = null;
	replaying = null;
};

/** Close a row: keep what the first one made, or stamp a later one's values onto a clone. */
export const endRow = (site: object, mode: number, result: unknown): unknown => {
	if (mode === 1) {
		const trace = recording!;
		recording = null;
		cache.set(site, build(trace, result) ?? 'off');
		return result;
	}
	const state = replaying!;
	replaying = null;
	if (result !== CLONED) {
		// This row did not return the element the first one returned, so there is nothing to
		// stamp. Its body runs again untemplated, and the call site stops templating rather
		// than paying a second run for every row like it.
		cache.set(site, 'off');
		return RERUN;
	}
	return stamp(state.template, state.values);
};

/** Whether every node in the row is one the row's own `h` calls made. */
const ownsAll = (trace: Trace, row: NodeLike): boolean => {
	for (let n = row.firstChild; n !== null; n = n.nextSibling) {
		if (!trace.own.has(n) || !ownsAll(trace, n)) return false;
	}
	return true;
};

const build = (trace: Trace, result: unknown): RowTemplate | null => {
	if (trace.failed || !trace.made.has(result)) return null;
	const row = isBound(result) ? result.node : result as NodeLike;
	if (!clonable(row)) return null;
	// A replay builds nothing: every `h` under one files its values away and answers CLONED. So a
	// template is only sound when the first row's `h` calls and the first row's nodes are the
	// same set. An element `h` made that the row does not hold means the body did something with
	// it that a later row cannot repeat; a node in the row that `h` did not make means something
	// else, a `mount` inside the body most likely, wrote into the row and would be frozen into
	// the clone. Either way the call site gives up its template and every row builds its own.
	for (const element of trace.built) if (pathTo(row, element) === null) return null;
	if (!ownsAll(trace, row)) return null;
	const paths: number[][] = [];
	for (const node of trace.nodes) {
		const path = pathTo(row, node);
		if (path === null) return null;
		paths.push(path);
	}
	return { row: row.cloneNode(true), calls: trace.calls, paths };
};

/**
 * Clone the recorded row and write this row's values into it.
 *
 * Every hole is written, not only the reactive ones, because a per-row constant is exactly
 * what the recorded clone froze. A value equal to the recorded one is skipped, which is where
 * the DOM calls go.
 */
const stamp = (template: RowTemplate, values: readonly Values[]): unknown => {
	// The one shape break with a number on it, so it is loud rather than left to write values
	// onto the wrong elements. Everything else the contract asks for is still unchecked.
	assert(values.length === template.calls.length,
		`a component under each must call h the same number of times on every row: the first row made `
		+ `${template.calls.length} and this one made ${values.length}`);
	const row = (template.row as NodeLike & { cloneNode(deep: boolean): NodeLike }).cloneNode(true);
	const nodes: NodeLike[] = [];
	for (const path of template.paths) nodes.push(nodeAt(row, path));

	const signals: Signal[] = [];
	for (let c = 0; c < template.calls.length; c += 1) {
		const holes = template.calls[c]!.holes;
		const { given, children } = values[c]!;
		let lastChild: ChildSignal | null = null;
		for (const hole of holes) {
			const target = nodes[hole.at]!;
			if (hole.kind === TEXT) {
				const value = children[hole.child];
				// A null here is a shape break: the first row made a text node and this one has
				// nothing for it. Empty text is the closest a clone gets to `h` skipping it.
				if (value !== hole.was) (target as TextLike).data = value === null || value === undefined ? '' : String(value);
			} else if (hole.kind === CHILD) {
				const item = children[hole.child];
				if (item === null || item === undefined) continue;
				const signal: ChildSignal = {
					kind: 'child', parent: target as ElementLike, item,
					staticNext: hole.anchor < 0 ? null : nodes[hole.anchor]!, next: null, handle: null,
				};
				if (lastChild !== null) lastChild.next = signal;
				lastChild = signal;
				signals.push(signal);
			} else if (hole.kind === ATTR) {
				// A value equal to the one the recorded row wrote is already on the clone, which is
				// where most of the saving is. `was` is undefined for a source, so a reactive value
				// never matches and always binds.
				const value = given[hole.name];
				if (value !== hole.was) bindAttribute(target as ElementLike, hole.name, value, signals);
			} else {
				// A property is never on the clone: `cloneNode` copies attributes, not what
				// JavaScript wrote. Every row writes its own, the first one included.
				bindProperty(target as ElementLike, hole.name.slice(1), given[hole.name], signals);
			}
		}
	}

	if (signals.length === 0) return row;
	const bound: Bound = { [BOUND]: true, node: row as ElementLike, signals };
	return bound;
};
