// The text a page shows, found where it was written (design 277).
//
// With the `text` option on, every literal text child and every string literal on a text prop
// becomes a call to `ui`'s `text`, in place, and the key it looked up is answered so a build can
// write the source catalog. The pass runs over the one `Element` model every notation reads into,
// before hoisting, so a wrapped literal is a hole in the template like any varying child.

import type { Node } from './ast.ts';
import { forEachChild } from './ast.ts';
import type { Child, Element, Property } from './element.ts';

/**
 * The props whose string literal is text a person reads: HTML's own text-carrying attributes,
 * and the four names `ui`'s components take a label, a description, an error and a caption
 * under. A `class`, an `href`, a `name` or a `type` is a word for the machine and is never here.
 */
export const TEXT_PROPS: ReadonlySet<string> = new Set([
	'label', 'title', 'description', 'placeholder', 'alt', 'error', 'caption',
	'aria-label', 'aria-description', 'aria-placeholder', 'aria-valuetext', 'aria-roledescription',
]);

// A string with no letter in it is punctuation, a number or a separator, which no language
// translates.
const LETTER = /\p{L}/u;

/** Whether a literal is text a person reads. */
export const isWords = (value: unknown): value is string =>
	typeof value === 'string' && LETTER.test(value);

/** The key a source and a `context` word name, the way `ui`'s `text` builds it. */
export const keyOf = (source: string, context: string | null): string =>
	(context === null || context === '' ? source : `${source}|${context}`);

export interface TextPass {
	/**
	 * Wrap every literal in the tree, in place. A tree already wrapped is left as it is, so an
	 * element emitted a second time on its own, once its parent fell back to a call, is not
	 * wrapped twice.
	 */
	wrap(element: Element): void;
	/** Record the key of a call the page wrote itself. */
	record(key: string): void;
	/** Whether a literal was wrapped, which is what says the import is needed. */
	readonly used: boolean;
	/** Every key found, each once: the wrapped literals as the elements were emitted, then the calls the page wrote. */
	readonly keys: readonly string[];
}

/** Whether the element carries a literal `translate="no"`, which leaves it and its subtree alone. */
const untranslated = (element: Element): boolean =>
	element.properties.some((property) =>
		property.kind === 'static' && property.name === 'translate'
		&& typeof property.value === 'string' && property.value.toLowerCase() === 'no');

const spread = (element: Element): boolean => element.properties.some((property) => property.kind === 'spread');

/**
 * The pass for one file.
 *
 * Params:
 *   name: the local name `ui`'s `text` is bound under in the file
 *
 * Returns: the pass. Read `used` and `keys` after every element has been emitted.
 *
 * Example:
 *   const pass = createTextPass(freshName('_text', bindings.names));
 *   pass.wrap(element);
 */
export const createTextPass = (name: string): TextPass => {
	const seen = new WeakSet<Element>();
	const found = new Set<string>();
	let used = false;

	const call = (source: string): string => {
		used = true;
		found.add(source);
		return `${name}(${JSON.stringify(source)})`;
	};

	const walk = (element: Element): void => {
		if (seen.has(element)) return;
		seen.add(element);
		if (untranslated(element)) return;
		// The arrays are the reader's own and this is the one pass that writes into them; a copy
		// would break the identity `checkAccess` marks a tree by.
		if (!spread(element)) {
			const properties = element.properties as Property[];
			for (let i = 0; i < properties.length; i += 1) {
				const property = properties[i]!;
				if (property.kind !== 'static' || !TEXT_PROPS.has(property.name) || !isWords(property.value)) continue;
				properties[i] = { kind: 'expr', name: property.name, code: call(property.value) };
				element.rewritten = true;
			}
		}
		const children = element.children as Child[];
		for (let i = 0; i < children.length; i += 1) {
			const child = children[i]!;
			if (child.kind === 'element') walk(child.element);
			else if (child.kind === 'text' && isWords(child.text)) {
				children[i] = { kind: 'code', code: call(child.text) };
				element.rewritten = true;
			}
		}
	};

	return {
		wrap: walk,
		record: (key) => { found.add(key); },
		get used() { return used; },
		get keys() { return [...found]; },
	};
};

/** A property's literal `context` word on the values object of a `text` call, or null. */
const contextOf = (values: Node | undefined): string | null => {
	if (values === undefined || values.type !== 'ObjectExpression') return null;
	for (const entry of values['properties'] as Node[]) {
		if (entry.type !== 'ObjectProperty' || entry['computed'] === true) continue;
		const key = entry['key'] as Node;
		const named = key.type === 'Identifier' ? key['name'] as string
			: key.type === 'StringLiteral' ? key['value'] as string
				: null;
		if (named !== 'context') continue;
		const value = entry['value'] as Node;
		return value.type === 'StringLiteral' ? value['value'] as string : null;
	}
	return null;
};

/**
 * Record every call to `text` the file wrote itself, with a literal message.
 *
 * Params:
 *   program: the parsed file
 *   name: the local name `ui`'s `text` is bound under
 *   pass: where the keys go
 *
 * Example:
 *   if (bindings.uiText !== null) recordCalls(program, bindings.uiText, pass);
 */
export const recordCalls = (program: Node, name: string, pass: TextPass): void => {
	const search = (node: Node): void => {
		if (node.type === 'CallExpression') {
			const callee = node['callee'] as Node;
			const args = node['arguments'] as Node[];
			const first = args[0];
			if (callee.type === 'Identifier' && callee['name'] === name && first !== undefined && first.type === 'StringLiteral') {
				pass.record(keyOf(first['value'] as string, contextOf(args[1])));
			}
		}
		forEachChild(node, search);
	};
	search(program);
};
