// A hoisted template: the static shape of a subtree, made once per document and instanced per
// use (designs 089, 093, 094).
//
// `build` emits a call to `template` at module scope and a call to what it returns wherever the
// subtree appears. The instance is exactly what the `h` calls it replaced would have returned,
// so nothing downstream can tell the two apart: the element itself when nothing turned out to be
// reactive, and otherwise the element with one flat list of every signal below it.
//
// The prototype belongs to the document that is active, never to the module, because a server
// rendering two pages at once would otherwise hand one page the other's nodes.

import { assert } from './assert.ts';
import { activeDocument } from './ambient.ts';
import { bindProps } from './h.ts';
import { type Bound, BOUND, type ChildSignal, type Signal, hydrating, isBound } from './mount.ts';
import { markMade } from './props.ts';
import { setAttribute } from './host.ts';
import type { DocumentLike, ElementLike, NodeLike } from './types.ts';
import { ELEMENT, isNodeLike } from './types.ts';

/** The attributes of one element in a template: only values that were literal in the source. */
export type TemplateAttributes = Readonly<Record<string, string | number | boolean>>;

/** What sits inside an element in a template: text, or another element. */
export type TemplateChild = string | TemplateElement;

/** One element in a template: its name, its literal attributes, and its static children. */
export type TemplateElement = readonly [
	tag: string,
	attributes: TemplateAttributes | null,
	...children: TemplateChild[],
];

/**
 * Where something varies. `path` is the child indices from the root to the element it belongs
 * to; `[]` is the root itself. A `props` edit takes an object of properties and attributes; a
 * `child` edit takes one item, and `before` is the index of the static child it goes in front
 * of, or -1 for the end.
 */
export type TemplateEdit =
	| readonly ['props', path: readonly number[]]
	| readonly ['child', path: readonly number[], before: number];

/** One instance of a template: what `h` would have returned for the same subtree. */
export type Template = (values: readonly unknown[]) => unknown;

/** An edit run: one element's child edits together, or one element's properties. */
type Step =
	| { readonly kind: 'children'; readonly path: readonly number[]; readonly before: readonly number[]; readonly from: number }
	| { readonly kind: 'props'; readonly path: readonly number[]; readonly at: number };

const nodeAt = (root: ElementLike, path: readonly number[]): ElementLike => {
	let node: NodeLike = root;
	for (const index of path) {
		let child = node.firstChild;
		for (let i = 0; i < index && child !== null; i++) child = child.nextSibling;
		assert(child !== null, 'a template edit names a node the template does not have');
		node = child!;
	}
	return node as ElementLike;
};

/**
 * Mark every node of a clone as the binding's own.
 *
 * `claim` adopts a server node only where the fresh node is one the binding made, and `cloneNode`
 * carries none of that: the copies are new objects the marking never reached. A page builds its
 * top-level item before it hands it to `hydrate`, so an instance cannot know whether it is about
 * to be hydrated, and marks either way, as `h` does.
 */
const markTree = (node: NodeLike): void => {
	markMade(node);
	if (node.nodeType !== ELEMENT) return;
	for (let child = node.firstChild; child !== null; child = child.nextSibling) markTree(child);
};

const build = (spec: TemplateElement, document: DocumentLike, mark: boolean): ElementLike => {
	const element = document.createElement(spec[0]);
	if (mark) markMade(element);
	const attributes = spec[1];
	if (attributes !== null) {
		for (const name of Object.keys(attributes)) setAttribute(element, name, attributes[name]);
	}
	for (let i = 2; i < spec.length; i++) {
		const child = spec[i] as TemplateChild;
		if (typeof child === 'string') {
			const text = document.createTextNode(child);
			element.insertBefore(mark ? markMade(text) : text, null);
		} else {
			element.insertBefore(build(child, document, mark), null);
		}
	}
	return element;
};

/** Group the flat edit list into runs once, at module load, so an instance does no grouping. */
const plan = (edits: readonly TemplateEdit[]): Step[] => {
	const steps: Step[] = [];
	const done = new Set<string>();
	for (let i = 0; i < edits.length;) {
		const edit = edits[i]!;
		if (edit[0] === 'props') {
			steps.push({ kind: 'props', path: edit[1], at: i });
			i += 1;
			continue;
		}
		const key = edit[1].join(',');
		assert(!done.has(key), 'a template lists one element\'s child edits in two places');
		done.add(key);
		const before: number[] = [];
		const from = i;
		while (i < edits.length) {
			const next = edits[i]!;
			if (next[0] !== 'child' || next[1].join(',') !== key) break;
			before.push(next[2]);
			i += 1;
		}
		steps.push({ kind: 'children', path: edit[1], before, from });
	}
	return steps;
};

/**
 * The static shape of a subtree, made once per document and instanced per use.
 *
 * Params:
 *   spec: the element, its literal attributes and its static children, nested
 *   edits: where something varies, in the order the `h` calls this replaces would have run:
 *          for each element, its children first and then its own properties
 *
 * Returns: a function taking one value per edit, in the same order, and returning what `h`
 * would have returned. Hand that straight to `mount`.
 *
 * Example:
 *   const row = template(['li', { class: 'row' }, ['span', null]], [['child', [0], -1]]);
 *   mount(list, row([title]));
 */
export const template = (spec: TemplateElement, edits: readonly TemplateEdit[]): Template => {
	const prototypes = new WeakMap<DocumentLike, ElementLike>();
	const steps = plan(edits);

	return (values) => {
		const document = activeDocument();
		let root: ElementLike;
		if (hydrating()) {
			// Hydration happens once per page and cloning happens once per row, so the mode that is not
			// in the hot path builds rather than keeping a prototype it would use once.
			root = build(spec, document, true);
		} else {
			let prototype = prototypes.get(document);
			if (prototype === undefined) {
				prototype = build(spec, document, false);
				prototypes.set(document, prototype);
			}
			const clone = (prototype as { cloneNode?: (deep: boolean) => ElementLike }).cloneNode;
			if (typeof clone === 'function') {
				root = clone.call(prototype, true);
				markTree(root);
			} else {
				root = build(spec, document, true);
			}
		}

		// Every path is resolved against the instance before anything is put into it. A varying
		// child inserted into an element would otherwise shift the child indices a later step
		// counts through.
		const targets = steps.map((step) => nodeAt(root, step.path));

		const signals: Signal[] = [];
		for (let i = 0; i < steps.length; i++) {
			const step = steps[i]!;
			const element = targets[i]!;
			if (step.kind === 'props') {
				const props = values[step.at];
				assert(props === null || props === undefined || typeof props === 'object',
					'a template property edit takes an object of properties');
				bindProps(element, (props ?? {}) as Record<string, unknown>, signals);
			} else {
				applyChildren(element, step, values, document, signals);
			}
		}

		if (signals.length === 0) return root;
		const bound: Bound = { [BOUND]: true, node: root, signals };
		return bound;
	};
};

/**
 * One element's varying children, in document order among its static ones.
 *
 * This is `h`'s own child loop with the static children already in place: a value that is a node
 * or a primitive goes into the tree now, anything else becomes a signal the mount binds, and a
 * signal's anchor is the first node placed after it, whether that node is a static child or one
 * an earlier value turned into.
 */
const applyChildren = (
	element: ElementLike,
	step: { readonly before: readonly number[]; readonly from: number },
	values: readonly unknown[],
	document: DocumentLike,
	signals: Signal[],
): void => {
	const statics: NodeLike[] = [];
	for (let n = element.firstChild; n !== null; n = n.nextSibling) statics.push(n);

	const pending: ChildSignal[] = [];
	let last: ChildSignal | null = null;
	let staticAt = 0;
	const anchored = (node: NodeLike): void => {
		for (const signal of pending) signal.staticNext = node;
		pending.length = 0;
	};

	for (let i = 0; i < step.before.length; i++) {
		const before = step.before[i]!;
		const target = before < 0 ? statics.length : before;
		while (staticAt < target) anchored(statics[staticAt++]!);
		const anchor = target < statics.length ? statics[target]! : null;

		const value = values[step.from + i];
		assert(value !== undefined, 'cannot mount undefined; hide something with null');
		if (value === null || value === undefined) continue;

		const placed = (node: NodeLike): void => {
			element.insertBefore(node, anchor);
			anchored(node);
		};
		if (isBound(value)) {
			signals.push(...value.signals);
			placed(value.node);
		} else if (isNodeLike(value)) {
			placed(value);
		} else if (typeof value !== 'object' && typeof value !== 'function') {
			placed(markMade(document.createTextNode(String(value))));
		} else {
			const signal: ChildSignal = {
				kind: 'child', parent: element, item: value, staticNext: anchor, next: null, handle: null,
			};
			if (last !== null) last.next = signal;
			last = signal;
			pending.push(signal);
			signals.push(signal);
		}
	}
	while (staticAt < statics.length) anchored(statics[staticAt++]!);
};
