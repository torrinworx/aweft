// `h`: an element, its properties and attributes, its static children now, and the reactive
// parts as signals for the mount to bind.
//
// A node is made the moment `h` runs, so `h('div', { class: 'x' })` is an element the page
// can use as one. What varies (a scope in an attribute, a child that is a cell, a component)
// is recorded and bound when the element is mounted, because that is when its place in the
// document is known.

import { assert } from './assert.ts';
import { activeDocument } from './ambient.ts';
import { type Bound, BOUND, type ChildSignal, type Signal, attributeSet, isBound, isPlainObject, propertySet } from './bound.ts';
import { setProperty } from './hydration.ts';
import { type Component, type Mounter, componentMounter } from './mount.ts';
import { markMade, recordProperty, recordReactiveAttribute } from './props.ts';
import type { ElementLike, NodeLike } from './types.ts';
import { isNodeLike, isSource } from './types.ts';

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
 * Example:
 *   mount(document.body, h('button', { $onclick: () => count.set(count.get() + 1) }, 'clicked ', count));
 */
export const h = (tag: unknown, props: Record<string, unknown> | null = {}, ...children: unknown[]): unknown => {
	assert(tag !== null && tag !== undefined, 'a tag name cannot be null or undefined');
	const given = props ?? {};

	if (children.length === 0) {
		assert(given['children'] === undefined || given['children'] === null || Array.isArray(given['children']),
			'children must be null or an array');
		children = (given['children'] as unknown[] | null | undefined) ?? [];
	} else {
		assert(given['children'] === undefined || given['children'] === null
			|| (Array.isArray(given['children']) && given['children'].length === 0),
			'an element with a body cannot also take children as a property');
	}

	if (typeof tag === 'function') {
		const own: Record<string, unknown> = { ...given, children };
		return componentMounter(tag as Component, own, 'each' in own);
	}

	let element: ElementLike;
	if (isNodeLike(tag)) {
		element = tag as ElementLike;
	} else {
		assert(typeof tag === 'string', `unsupported tag: ${typeof tag}`);
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

	for (const child of children) {
		assert(child !== undefined, 'cannot mount undefined; hide something with null');
		if (child === null || child === undefined) continue;
		if (isBound(child)) {
			signals.push(...child.signals);
			placed(child.node);
		} else if (isNodeLike(child)) {
			placed(child);
		} else if (typeof child !== 'object' && typeof child !== 'function') {
			placed(markMade(activeDocument().createTextNode(String(child))));
		} else {
			const signal: ChildSignal = { kind: 'child', parent: element, item: child, staticNext: null, next: null, handle: null };
			if (lastChild !== null) lastChild.next = signal;
			lastChild = signal;
			pendingAnchor.push(signal);
			signals.push(signal);
		}
	}

	bindProps(element, given, signals);

	if (signals.length === 0) return element;
	const bound: Bound = { [BOUND]: true, node: element, signals };
	return bound;
};

/**
 * Write one element's properties and attributes, collecting a signal for each reactive one.
 *
 * Not exported from the package: a hoisted template applies the properties of the elements
 * inside it, and it has to apply them exactly as `h` does, so it runs this rather than a copy.
 */
export const bindProps = (element: ElementLike, given: Record<string, unknown>, signals: Signal[]): void => {
	for (const key of Object.keys(given)) {
		if (key === 'children') continue;
		const value = given[key];
		if (key[0] === '$') {
			const name = key.slice(1);
			if (isSource(value)) {
				signals.push({ kind: 'prop', element, via: null, name, source: value, set: propertySet });
			} else if (isPlainObject(value)) {
				// A nested object writes its keys onto the property's value, `style` above all.
				const inner = (element as Record<string, unknown>)[name];
				const statics: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(value)) {
					if (isSource(v)) signals.push({ kind: 'prop', element, via: name, name: k, source: v, set: propertySet });
					else statics[k] = v;
				}
				if (inner !== null && typeof inner === 'object') setProperty(element, name, statics);
				else propertySet(element, name, value);
				recordProperty(element, name, statics);
			} else {
				propertySet(element, name, value);
				recordProperty(element, name, value);
			}
		} else if (isSource(value)) {
			recordReactiveAttribute(element, key);
			signals.push({ kind: 'prop', element, via: null, name: key, source: value, set: attributeSet });
		} else {
			assert(!isPlainObject(value), `attribute ${key} cannot take an object; use $${key} for a property`);
			attributeSet(element, key, value);
		}
	}
};

export type { Mounter };
