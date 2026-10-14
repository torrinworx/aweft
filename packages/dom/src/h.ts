// `h`: an element, its properties and attributes, its static children now, and the reactive
// parts as signals for the mount to bind.
//
// A node is made the moment `h` runs, so `h('div', { class: 'x' })` is an element the page
// can use as one. What varies (a scope in an attribute, a child that is a cell, a component)
// is recorded and bound when the element is mounted, because that is when its place in the
// document is known.

import type { Derived, Observer } from '@aweftjs/core';

import { assert } from './assert.ts';
import { activeDocument } from './ambient.ts';
import { bindAttribute, bindProperty } from './bind.ts';
import { type Bound, BOUND, type ChildSignal, type Signal, isBound } from './bound.ts';
import { type Component, type Mounter, componentMounter } from './mount.ts';
import { markMade } from './props.ts';
import { isRowRecording, isRowReplaying, replayCall, traceChild, traceClose, traceNode, traceProp, traceText } from './row-template.ts';
import type { ElementLike, NodeLike } from './types.ts';
import { isNodeLike } from './types.ts';

const SVG = 'http://www.w3.org/2000/svg';
let saidSvg = false;

/**
 * Warn, once, that an `<svg>` is about to be made as an HTML element (design 307).
 *
 * Not exported from the package: `h` and a hoisted template both call it. It returns true so the
 * call is the condition of an `assert`, and leaves a release build with it. It never refuses,
 * because a static render of the element is markup a browser reads as the SVG it looks like.
 */
export const warnHtmlSvg = (tag: string): boolean => {
	if (saidSvg || tag.toLowerCase() !== 'svg') return true;
	saidSvg = true;
	console.warn('dom: an <svg> made by h is an HTML element, which draws nothing in a browser and does not hydrate. '
		+ `Make it in the SVG namespace: createElement('svg', '${SVG}') handed to h as the tag, `
		+ 'or svg() from @aweftjs/ui, which does that for every element under it.');
	return true;
};

type Without<P> = { [K in keyof P as K extends 'each' | 'children' ? never : K]: P[K] };

// What `each` takes: a list, a document array or a list cell, or a cell or scope whose value is
// one, which the list follows. A scope reads its value as `unknown`, so it carries no item type.
// The item itself is taken too: a call written against the old `each?: unknown` cast its list to
// the item to compile, and that call keeps compiling. The runtime refuses an item that is no list.
type ListOf<I> = Iterable<I> | Derived<Iterable<I>> | Observer | I;

/**
 * What a call site writes for a component whose own props are `P` (design 308).
 *
 * The props the component declares, with `each` read as a list of the item it declares, since
 * `each` is the list where the component is called and one item in its body: an iterable of the
 * item, or a cell or scope holding one. `children` is left to the rest arguments. A component
 * whose props are `unknown`, or that takes none, takes any props. JSX checks a component's
 * attributes against this too.
 *
 * Example:
 *   const Row = (props: { each: Item, onPick(item: Item): void }) => h('li', null, props.each.label)
 *   const props: CallProps<{ each: Item, onPick(item: Item): void }> = { each: items, onPick: pick }
 */
export type CallProps<P> = unknown extends P ? Readonly<Record<string, unknown>> : P extends { readonly each: infer I }
	? Without<P> & { readonly each: ListOf<I>; readonly children?: unknown[] | null }
	: P extends { readonly each?: infer I }
		? Without<P> & { readonly each?: ListOf<I>; readonly children?: unknown[] | null }
		: Without<P> & { readonly children?: unknown[] | null };

/**
 * A component as `h` takes it: any function of props. Written as a method, so its parameter is
 * compared both ways and a generic component, whose props TypeScript cannot pin down here, is
 * still taken, with its props then left unchecked (design 308).
 */
export type ComponentTag<P> = { component(props: P, ...rest: never[]): unknown }['component'];

/**
 * Make an element, or a component's mounter.
 *
 * Params:
 *   tag: an element name, an existing node to use as the element, or a component function
 *   props: attributes by bare name, properties by `$name` (`$value`, `$onclick`, a `$style`
 *          object), each static or a scope, cell or derived value; `children` as an
 *          alternative to the rest arguments; `each` on a component to mount it once per
 *          item of a list. With a component as the tag they are checked against its own
 *          props, `each` as a list of its item (`CallProps`)
 *   children: what goes inside: primitives, nodes, `h()` output, iterables, scopes and cells,
 *             components. `null` is skipped and `undefined` is refused
 *
 * Returns: the element itself when nothing in it is reactive, so it can be used as a node;
 * otherwise a value `mount` binds. For a component, a mounter to hand to `mount`.
 *
 * Throws: an assert, loud in development and stripped in a release build, for a null tag, a
 * tag that is neither an element name nor a component, `undefined` as a child, children given
 * both ways, or an object written as an attribute.
 *
 * Example:
 *   mount(document.body, h('button', { $onclick: () => count.set(count.get() + 1) }, 'clicked ', count));
 *   mount(list, h(Row, { each: items, onPick: (item) => open(item) }))
 */
export function h<P>(tag: ComponentTag<P>, props?: NoInfer<CallProps<P>> | null, ...children: unknown[]): unknown;
export function h(tag: string | NodeLike, props?: Readonly<Record<string, unknown>> | null, ...children: unknown[]): unknown;
export function h(tag: unknown, props: Readonly<Record<string, unknown>> | null = {}, ...children: unknown[]): unknown {
	assert(tag !== null && tag !== undefined, 'a tag name cannot be null or undefined; pass an element name, a node or a component');
	const given = props ?? {};

	if (children.length === 0) {
		assert(given['children'] === undefined || given['children'] === null || Array.isArray(given['children']),
			'children must be null or an array; wrap a single child in an array');
		children = (given['children'] as unknown[] | null | undefined) ?? [];
	} else {
		assert(given['children'] === undefined || given['children'] === null
			|| (Array.isArray(given['children']) && given['children'].length === 0),
			'an element with a body cannot also take children as a property; drop one of the two');
	}

	if (typeof tag === 'function') {
		const own: Record<string, unknown> = { ...given, children };
		return componentMounter(tag as Component, own, 'each' in own);
	}

	// A row being cloned files its values away; the clone already holds this element.
	if (isRowReplaying()) return replayCall(given, children);
	const tracing = isRowRecording();

	let element: ElementLike;
	if (isNodeLike(tag)) {
		element = tag as ElementLike;
		// A node from outside this row: nothing a clone could carry.
		if (tracing) traceNode(element);
	} else {
		assert(typeof tag === 'string', `unsupported tag: ${typeof tag}; pass an element name, a node or a component`);
		assert(warnHtmlSvg(String(tag)), 'the svg warning never refuses an element');
		element = markMade(activeDocument().createElement(String(tag)));
	}

	const signals: Signal[] = [];
	const pendingAnchor: ChildSignal[] = [];
	let lastChild: ChildSignal | null = null;

	const placed = (node: NodeLike): void => {
		element.insertBefore(node, null);
		for (const signal of pendingAnchor) signal.staticNext = node;
		pendingAnchor.length = 0;
	};

	for (let at = 0; at < children.length; at += 1) {
		const child = children[at];
		assert(child !== undefined, 'cannot mount undefined; hide something with null instead');
		if (child === null || child === undefined) continue;
		if (isBound(child)) {
			if (tracing) traceNode(child);
			signals.push(...child.signals);
			placed(child.node);
		} else if (isNodeLike(child)) {
			if (tracing) traceNode(child);
			placed(child);
		} else if (typeof child !== 'object' && typeof child !== 'function') {
			const text = markMade(activeDocument().createTextNode(String(child)));
			if (tracing) traceText(text, at, child);
			placed(text);
		} else {
			const signal: ChildSignal = { kind: 'child', parent: element, item: child, staticNext: null, next: null, handle: null };
			if (lastChild !== null) lastChild.next = signal;
			lastChild = signal;
			pendingAnchor.push(signal);
			signals.push(signal);
			if (tracing) traceChild(signal, at);
		}
	}

	bindProps(element, given, signals, tracing);

	if (signals.length === 0) {
		if (tracing) traceClose(element, element);
		return element;
	}
	const bound: Bound = { [BOUND]: true, node: element, signals };
	if (tracing) traceClose(element, bound);
	return bound;
}

/**
 * Write one element's properties and attributes, collecting a signal for each reactive one.
 *
 * Not exported from the package: a hoisted template applies the properties of the elements
 * inside it, and it has to apply them exactly as `h` does, so it runs this rather than a copy.
 * The two branches are in `bind.ts` because the row template writes one hole at a time and has
 * no object to loop over.
 *
 * `tracing` is only ever true from `h`. A hoisted template is the compiled path and a row
 * recorder never templates one, so it passes false and files no holes.
 */
export const bindProps = (
	element: ElementLike,
	given: Record<string, unknown>,
	signals: Signal[],
	tracing = false,
): void => {
	for (const key of Object.keys(given)) {
		if (key === 'children') continue;
		const value = given[key];
		if (tracing) traceProp(element, key, value);
		if (key[0] === '$') bindProperty(element, key.slice(1), value, signals);
		else bindAttribute(element, key, value, signals);
	}
};

export type { Mounter };
