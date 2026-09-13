// JSX read as elements.
//
// A tag that starts lowercase and has no dot in it is an element name; anything else is an
// expression and is resolved by ordinary scope, so a component is whatever the surrounding code
// calls it (design 092). Text follows JSX's own whitespace rules, which are the rules markup in
// a template literal already follows.

import type { Node } from './ast.ts';
import { type Child, type Element, type Property, childCode, collapseText, emitCall } from './element.ts';
import { transformError } from './error.ts';

export interface JsxReader {
	/** The name to call for an element, asked for only when one is printed as a call. */
	h(): string;
	/**
	 * The element's properties, once its tag is known and before anything is emitted. This is
	 * where a literal icon name on `Icon` becomes an import (design 141); everything else comes
	 * back as it went in.
	 */
	properties(tag: string, properties: readonly Property[]): readonly Property[];
	/** The code for an expression inside the JSX, with anything nested already transformed. */
	code(node: Node): string;
	/** The source text, for a tag written as a member expression. */
	readonly source: string;
	/** How an element becomes code, which is where hoisting happens. */
	emit(element: Element): string;
}

const tagOf = (name: Node, reader: JsxReader): { readonly tag: string | null; readonly code: string } => {
	if (name.type === 'JSXIdentifier') {
		const text = name['name'] as string;
		const element = /^[a-z]/.test(text);
		return { tag: element ? text : null, code: element ? JSON.stringify(text) : text };
	}
	if (name.type === 'JSXMemberExpression') {
		return { tag: null, code: reader.source.slice(name.start, name.end) };
	}
	throw transformError('namespaced-tag', 'a namespaced JSX tag has no meaning here',
		'Write the tag as a plain name or a member expression.', name.start);
};

const attributeValue = (attribute: Node, reader: JsxReader): Property => {
	const name = (attribute['name'] as Node);
	if (name.type !== 'JSXIdentifier') {
		throw transformError('namespaced-attribute', 'a namespaced JSX attribute has no meaning here',
			'Write the attribute name without a colon in it.', name.start);
	}
	const key = name['name'] as string;
	const value = attribute['value'] as Node | null;
	if (value === null || value === undefined) return { kind: 'static', name: key, value: true };
	if (value.type === 'StringLiteral') return { kind: 'static', name: key, value: value['value'] as string };
	if (value.type === 'JSXExpressionContainer') {
		const inner = value['expression'] as Node;
		if (inner.type === 'JSXEmptyExpression') {
			throw transformError('empty-expression', `${key} was given no value`,
				'Put an expression in the braces, or drop them to make the attribute true.', value.start);
		}
		return literalOr(key, inner, reader);
	}
	return { kind: 'expr', name: key, code: reader.code(value) };
};

/** A literal in the source can go straight into a template; anything else is code. */
export const literalOr = (name: string, node: Node, reader: { code(node: Node): string }): Property => {
	if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral') {
		return { kind: 'static', name, value: node['value'] as string | number | boolean };
	}
	if (node.type === 'NullLiteral') return { kind: 'static', name, value: null };
	return { kind: 'expr', name, code: reader.code(node) };
};

const childrenOf = (nodes: readonly Node[], reader: JsxReader): Child[] => {
	const children: Child[] = [];
	for (const node of nodes) {
		if (node.type === 'JSXText') {
			const text = collapseText(node['value'] as string);
			if (text !== '') children.push({ kind: 'text', text });
		} else if (node.type === 'JSXExpressionContainer') {
			const inner = node['expression'] as Node;
			if (inner.type === 'JSXEmptyExpression') continue;
			children.push({ kind: 'code', code: reader.code(inner) });
		} else if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
			children.push(childOf(node, reader));
		} else {
			throw transformError('unsupported-child', `${node.type} has no meaning inside JSX here`,
				'Write the child as text, an element, or an expression in braces.', node.start);
		}
	}
	return children;
};

const childOf = (node: Node, reader: JsxReader): Child =>
	(node.type === 'JSXFragment'
		? { kind: 'code', code: fragmentCode(node, reader) }
		: { kind: 'element', element: readElement(node, reader) });

/** A fragment is a list of items, which is what `mount` takes an array of children as. */
const fragmentCode = (node: Node, reader: JsxReader): string => {
	const children = childrenOf(node['children'] as Node[], reader);
	const parts = children.map((child) => childCode(child, reader.emit));
	return `[${parts.join(', ')}]`;
};

/**
 * Read one JSX element.
 *
 * Params:
 *   node: a JSXElement node
 *   reader: the `h` to call, how to write an expression, and the source
 *
 * Returns: the element, whose `fallback` prints it as an `h` call.
 *
 * Example:
 *   const element = readElement(node, reader);
 */
export const readElement = (node: Node, reader: JsxReader): Element => {
	const opening = node['openingElement'] as Node;
	const tag = tagOf(opening['name'] as Node, reader);

	const properties: Property[] = [];
	for (const attribute of opening['attributes'] as Node[]) {
		if (attribute.type === 'JSXSpreadAttribute') {
			properties.push({ kind: 'spread', code: reader.code(attribute['argument'] as Node) });
		} else {
			properties.push(attributeValue(attribute, reader));
		}
	}

	const element: Element = {
		tag: tag.tag,
		properties: reader.properties(tag.code, properties),
		children: childrenOf((node['children'] ?? []) as Node[], reader),
		at: node.start,
		rewritten: false,
		fallback: () => emitCall(reader.h(), tag.code, element, reader.emit),
	};
	return element;
};

/**
 * Read a JSX element or fragment as code.
 *
 * Params:
 *   node: a JSXElement or JSXFragment node
 *   reader: the `h` to call, how to write an expression, the source, and how to emit an element
 *
 * Returns: the code that replaces the JSX.
 *
 * Example:
 *   magic.overwrite(node.start, node.end, readJsx(node, reader));
 */
export const readJsx = (node: Node, reader: JsxReader): string =>
	(node.type === 'JSXFragment' ? fragmentCode(node, reader) : reader.emit(readElement(node, reader)));
