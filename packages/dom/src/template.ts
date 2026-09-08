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
import { type Bound, BOUND, type ChildSignal, type Signal, isBound } from './bound.ts';
import { hydrating } from './mount.ts';
import { markMade } from './props.ts';
import { setAttribute } from './host.ts';
import type { DocumentLike, ElementLike, NodeLike } from './types.ts';
import { isNodeLike } from './types.ts';

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

/** An edit run: one element's child edits together, or one element's properties. `at` is where
 * each of the run's values sits in the values array. */
type Step =
	| { readonly kind: 'children'; readonly path: readonly number[]; readonly before: number[]; readonly at: number[] }
	| { readonly kind: 'props'; readonly path: readonly number[]; readonly at: number };

const nodeAt = (root: ElementLike, path: readonly number[]): ElementLike => {
	let node: NodeLike = root;
	for (const index of path) {
		let child = node.firstChild;
		for (let i = 0; i < index && child !== null; i++) child = child.nextSibling;
		assert(child !== null, 'a template edit names a node the template does not have; check the edit path against the element tree');
		node = child!;
	}
	return node as ElementLike;
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

/**
 * Group the flat edit list into runs once, at module load, so an instance does no grouping.
 *
 * The edits arrive in the order the source evaluates their values, which is not the order they
 * are applied in. Applying comes out of this: every element's children first, then every
 * element's properties, deepest element first. A property that rewrites its element's content,
 * `$textContent` above all, therefore runs after the children are in place, and an ancestor's
 * runs after a descendant's, which is what nested `h` calls do (design 093).
 *
 * One element's child edits are one run wherever they sit in the list, because a nested element's
 * whole subtree comes between two of them in source order, and the run is what works out each
 * varying child's anchor.
 */
const plan = (edits: readonly TemplateEdit[]): Step[] => {
	const children: Step[] = [];
	const properties: { readonly step: Step; readonly depth: number }[] = [];
	const runs = new Map<string, { readonly before: number[]; readonly at: number[] }>();
	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i]!;
		if (edit[0] === 'props') {
			properties.push({ step: { kind: 'props', path: edit[1], at: i }, depth: edit[1].length });
			continue;
		}
		const key = edit[1].join(',');
		let run = runs.get(key);
		if (run === undefined) {
			run = { before: [], at: [] };
			runs.set(key, run);
			children.push({ kind: 'children', path: edit[1], before: run.before, at: run.at });
		}
		run.before.push(edit[2]);
		run.at.push(i);
	}
	properties.sort((a, b) => b.depth - a.depth);
	return [...children, ...properties.map((entry) => entry.step)];
};

/**
 * The static shape of a subtree, made once per document and instanced per use.
 *
 * Params:
 *   spec: the element, its literal attributes and its static children, nested
 *   edits: where something varies, in the order a source evaluates the values: for each element
 *          its properties first, then its children, and a nested element's whole subtree where
 *          that child sits
 *
 * Returns: a function taking one value per edit, in the same order, and returning what `h`
 * would have returned. Hand that straight to `mount`. The values are applied in a different
 * order from the one they are given in: every element's children before its own properties,
 * so a property that rewrites the element's content still wins.
 *
 * Throws: the instancing function asserts, loud in development and stripped in a release
 * build, for an edit path the element tree does not have, one element's child edits listed in
 * two places, or `undefined` where a value goes.
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
			// A clone carries none of the marking, and it never needs to: an instance a hydration
			// will claim is built above, and `hydrate` takes what makes the item so that an
			// instance is never made outside the mount that claims it (design 157).
			root = typeof clone === 'function' ? clone.call(prototype, true) : build(spec, document, true);
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
					'a template property edit takes an object of properties; pass null for none');
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
	step: { readonly before: readonly number[]; readonly at: readonly number[] },
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

		const value = values[step.at[i]!];
		assert(value !== undefined, 'cannot mount undefined; hide something with null instead');
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
