// `h`: an element, its properties and attributes, its static children now, and the reactive
// parts as signals for the mount to bind.
//
// A node is made the moment `h` runs, so `h('div', { class: 'x' })` is an element the page
// can use as one. What varies (a scope in an attribute, a child that is a cell, a component)
// is recorded and bound when the element is mounted, because that is when its place in the
// document is known.

import { assert } from './assert.ts';
import { activeDocument } from './ambient.ts';
import { bindAttribute, bindProperty } from './bind.ts';
import { type Bound, BOUND, type ChildSignal, type Signal, isBound } from './bound.ts';
import { type Component, type Mounter, componentMounter } from './mount.ts';
import { markMade } from './props.ts';
import { isRowRecording, isRowReplaying, replayCall, traceChild, traceClose, traceNode, traceProp, traceText } from './row-template.ts';
import type { ElementLike, NodeLike } from './types.ts';
import { isNodeLike } from './types.ts';

/**
 * Make an element, or a component's mounter.
 *
 * Params:
 *   tag: an element name, an existing node to use as the element, or a component function
 *   props: attributes by bare name, properties by `$name` (`$value`, `$onclick`, a `$style`
 *          object), each static or a scope, cell or derived value; `children` as an
 *          alternative to the rest arguments; `each` on a component to mount it once per
 *          item of a list
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
 */
export const h = (tag: unknown, props: Record<string, unknown> | null = {}, ...children: unknown[]): unknown => {
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
};

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
