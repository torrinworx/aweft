// The pieces a custom `h` needs: node factories that create through the document the current
// mount renders into, the attribute setter with the binding's rules, and `watch`.

import type { ElementLike, TextLike } from './types.ts';
import { isSource } from './types.ts';
import { activeDocument } from './ambient.ts';
import { markMade } from './props.ts';

/**
 * Make an element through the document the current mount renders into.
 *
 * Params:
 *   tag: the element name
 *   namespace: an XML namespace, for `svg` and the like; omitted for HTML
 *
 * Returns: a fresh, unattached element. Outside any mount it comes from the page's document,
 * or from a light document where there is no page.
 *
 * Example:
 *   const circle = createElement('circle', 'http://www.w3.org/2000/svg');
 */
export const createElement = (tag: string, namespace?: string): ElementLike =>
	markMade(namespace === undefined ? activeDocument().createElement(tag) : activeDocument().createElementNS(namespace, tag));

/**
 * Make a text node through the document the current mount renders into.
 *
 * Params:
 *   text: its content
 *
 * Returns: a fresh, unattached text node.
 *
 * Example:
 *   const label = createTextNode('hello');
 */
export const createTextNode = (text: string): TextLike => markMade(activeDocument().createTextNode(text));

/**
 * Write an attribute the way the binding does.
 *
 * Params:
 *   element: the element
 *   name: the attribute
 *   value: `null`, `undefined` and `false` remove it; `true` sets it empty; anything else is
 *          written as text
 *
 * Example:
 *   setAttribute(input, 'disabled', busy.get());
 */
export const setAttribute = (element: ElementLike, name: string, value: unknown): void => {
	if (value === null || value === undefined || value === false) element.removeAttribute(name);
	else if (value === true) element.setAttribute(name, '');
	else element.setAttribute(name, String(value));
};

/**
 * Run a callback for a value now and, when the value is a scope, cell or derived value, again
 * after every change.
 *
 * Params:
 *   value: a plain value, or anything with `get` and `effect`
 *   callback: what to run with each value
 *
 * Returns: the unsubscribe. For a plain value it does nothing.
 *
 * Example:
 *   const stop = watch(props.title, (title) => { element.title = String(title); });
 */
export const watch = (value: unknown, callback: (value: unknown) => void): (() => void) => {
	if (isSource(value)) return value.effect(callback);
	callback(value);
	return () => undefined;
};
