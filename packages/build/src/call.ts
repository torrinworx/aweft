// An `h` call read as an element, so a hand-written call gets hoisted like markup does.
//
// A call that cannot be hoisted is left exactly as it was written, comments and all, with only
// the transformable parts inside it replaced. That is what its fallback does, and it is why this
// reader exists separately from the two that print an `h` call from nothing.

import type { Node } from './ast.ts';
import type { Child, Element, Property } from './element.ts';
import { literalOr } from './jsx.ts';

export interface CallReader {
	/** Whether a node is a call to `dom`'s `h`. */
	isCall(node: Node): boolean;
	/** The code for an expression, with anything nested already transformed. */
	code(node: Node): string;
	/** The source of a node with only what is inside it transformed, leaving the node itself as
	 * it was written. */
	inner(node: Node): string;
	/** How an element becomes code, which is where hoisting happens. */
	emit(element: Element): string;
}

/** A tag argument that is a literal element name, or null when it is an expression. */
const tagOf = (node: Node | undefined): string | null =>
	(node !== undefined && node.type === 'StringLiteral' ? node['value'] as string : null);

/**
 * The properties an object literal spells out, or null when the argument is not one the reader
 * can take apart. A property whose key is computed, or written as a method, is not something the
 * transform can name, so the whole element stays as it was written.
 */
const propertiesOf = (node: Node | undefined, reader: CallReader): Property[] | null => {
	if (node === undefined) return [];
	if (node.type === 'NullLiteral') return [];
	if (node.type !== 'ObjectExpression') return null;

	const properties: Property[] = [];
	for (const entry of node['properties'] as Node[]) {
		if (entry.type === 'SpreadElement') {
			properties.push({ kind: 'spread', code: reader.code(entry['argument'] as Node) });
			continue;
		}
		if (entry.type !== 'ObjectProperty' || entry['computed'] === true) return null;
		const key = entry['key'] as Node;
		const name = key.type === 'Identifier' ? key['name'] as string
			: key.type === 'StringLiteral' ? key['value'] as string
				: null;
		if (name === null) return null;
		properties.push(literalOr(name, entry['value'] as Node, reader));
	}
	return properties;
};

const childrenOf = (nodes: readonly Node[], reader: CallReader): Child[] | null => {
	const children: Child[] = [];
	for (const node of nodes) {
		if (node.type === 'SpreadElement') return null;
		if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
			children.push({ kind: 'text', text: String(node['value']) });
		} else if (reader.isCall(node)) {
			const nested = readCall(node, reader);
			children.push(nested === null ? { kind: 'code', code: reader.code(node) } : { kind: 'element', element: nested });
		} else {
			children.push({ kind: 'code', code: reader.code(node) });
		}
	}
	return children;
};

/**
 * Read a call to `h` as an element.
 *
 * Params:
 *   node: a CallExpression whose callee is `dom`'s `h`
 *   reader: how to recognise a nested call, how to write an expression, and how to emit
 *
 * Returns: the element, or null when the call says something the reader cannot take apart, in
 * which case the caller leaves the call where it is.
 *
 * Example:
 *   const element = readCall(node, reader);
 */
export const readCall = (node: Node, reader: CallReader): Element | null => {
	const args = node['arguments'] as Node[];
	const tag = tagOf(args[0]);
	if (tag === null) return null;

	const properties = propertiesOf(args[1], reader);
	if (properties === null) return null;

	const children = childrenOf(args.slice(2), reader);
	if (children === null) return null;

	const element: Element = { tag, properties, children, at: node.start, fallback: () => reader.inner(node) };
	return element;
};
