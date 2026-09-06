// Writing one property or one attribute onto an element, the way the binding writes it.
//
// Three paths put values on elements: `h` on the element it just made, the hoisted template on a
// clone or a built instance, and the row template on a cloned row. All three have to write a
// value exactly as `h` does, down to which refusals are loud and what hydration is told, so this
// is the one implementation of it and each of them calls in here.
//
// What decides the branch is the key, which the caller has already split: a `$name` key is a
// property and every other key is an attribute.

import { assert } from './assert.ts';
import { type Signal, attributeSet, isPlainObject, propertySet } from './bound.ts';
import { setProperty } from './hydration.ts';
import { recordProperty, recordReactiveAttribute } from './props.ts';
import type { ElementLike } from './types.ts';
import { isSource } from './types.ts';

/**
 * Write one `$name` property, collecting a signal when the value is reactive.
 *
 * `name` is the key with its `$` already taken off.
 */
export const bindProperty = (element: ElementLike, name: string, value: unknown, signals: Signal[]): void => {
	if (isSource(value)) {
		signals.push({ kind: 'prop', element, via: null, name, source: value, set: propertySet });
		return;
	}
	if (isPlainObject(value)) {
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
		return;
	}
	propertySet(element, name, value);
	recordProperty(element, name, value);
};

/** Write one bare-name attribute, collecting a signal when the value is reactive. */
export const bindAttribute = (element: ElementLike, name: string, value: unknown, signals: Signal[]): void => {
	if (isSource(value)) {
		recordReactiveAttribute(element, name);
		signals.push({ kind: 'prop', element, via: null, name, source: value, set: attributeSet });
		return;
	}
	assert(!isPlainObject(value), `attribute ${name} cannot take an object; use $${name} for a property`);
	attributeSet(element, name, value);
};
