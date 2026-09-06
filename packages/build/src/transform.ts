// The transform: one parse, one walk, one edit of the source.
//
// Every pass reads the same tree and writes into the same edit, so the file is parsed once and
// the source map has one generation behind it rather than one per pass. What is not transformed
// comes out byte for byte as it went in.
//
// The passes are not stages over the whole file. They are readers, and a node reaches the one
// that knows it: markup and JSX become elements, an element becomes a template where that is
// sound and an `h` call where it is not, and a release build then takes the asserts out.

import MagicString from 'magic-string';
import { parse } from '@babel/parser';

import { type Node, forEachChild } from './ast.ts';
import { type CallReader, readCall } from './call.ts';
import type { Element } from './element.ts';
import { createHoister } from './hoist.ts';
import { type JsxReader, readJsx } from './jsx.ts';
import { type MarkupReader, readMarkup } from './markup.ts';
import { freshName, freshPrefix, readBindings } from './bindings.ts';
import { stripAsserts } from './asserts.ts';

const DOM = '@aweftjs/dom';

/**
 * What a caller may say about the source it hands `transform`.
 *
 * Both are optional and both default to off: with no `filename` the source is read as JSX and
 * the map names no source, and with no `release` the asserts stay in.
 *
 * Example:
 *   transform(source, { filename: 'page.tsx', release: true });
 */
export interface TransformOptions {
	/** The file the source came from. Its extension picks the dialect, and it names the map. */
	readonly filename?: string;
	/** A release build: assert calls are removed. */
	readonly release?: boolean;
}

/** A source map in the shape every bundler and every browser reads. */
export interface SourceMap {
	readonly version: number;
	readonly sources: readonly string[];
	readonly names: readonly string[];
	readonly mappings: string;
	toString(): string;
	toUrl(): string;
}

/**
 * What `transform` answers: the compiled source and the map from it back to the original.
 *
 * `code` is the whole file. What the transform did not touch comes out byte for byte as it went
 * in, so a diff of the two shows only the elements that compiled.
 *
 * Example:
 *   const { code, map } = transform(source, { filename: 'page.ts' });
 *   write(code + `\n//# sourceMappingURL=` + map.toUrl());
 */
export interface TransformResult {
	readonly code: string;
	readonly map: SourceMap;
}

/** `.ts` is TypeScript without JSX, because `<T>x` there is a type assertion, not an element. */
const pluginsFor = (filename: string | undefined): ('jsx' | 'typescript')[] => {
	if (filename === undefined) return ['jsx'];
	if (filename.endsWith('.ts') || filename.endsWith('.mts') || filename.endsWith('.cts')) return ['typescript'];
	if (filename.endsWith('.tsx')) return ['typescript', 'jsx'];
	return ['jsx'];
};

/**
 * Compile markup, JSX and static subtrees, and take the asserts out of a release build.
 *
 * The same function is the whole of the bundler plugin and is callable in a browser, so source
 * compiled at build time and source compiled at run time cannot disagree.
 *
 * Params:
 *   source: the file's text
 *   options: `filename`, whose extension picks the dialect and which names the map; `release`,
 *            which removes assert calls
 *
 * Returns: the transformed code and its source map.
 *
 * Throws: a `TransformError` for a fault in the markup or the JSX, carrying `at`, the offset
 * in the source. Its `reason` names the rule broken: `unterminated-tag`, `unclosed-element`,
 * `mismatched-closing-tag`, `nothing-to-close`, `unterminated-closing-tag`, `tag-needs-name`,
 * `bad-attribute-name`, `attribute-needs-value`, `unterminated-attribute`, `spread-needs-hole`,
 * `unterminated-comment`, `invalid-escape`, `namespaced-tag`, `namespaced-attribute`,
 * `empty-expression` or `unsupported-child`. Source the parser cannot read throws the parser's
 * own error instead.
 *
 * Example:
 *   const { code, map } = transform(source, { filename: 'app.tsx', release: true });
 */
export const transform = (source: string, options: TransformOptions = {}): TransformResult => {
	const filename = options.filename;
	const ast = parse(source, { sourceType: 'module', plugins: pluginsFor(filename) }) as unknown as Node;
	const program = ast['program'] as Node;
	const magic = new MagicString(source);

	const bindings = readBindings(program);
	// `h` resolves by ordinary scope, so an element compiles to the plain name `h` and the file
	// says what that is. `h` is imported from `dom` only when the file binds no `h` of its own
	// (design 092), so a file that declares one, or imports one from elsewhere, keeps it even
	// when it also has `dom`'s under another name.
	const needsH = !bindings.binds.has('h');
	// Hoisting needs `h` to be provably `dom`'s: either the file binds none and the import above
	// supplies it, or its one binding of the name is that import (design 095, case 4).
	const domIsH = needsH || bindings.domH === 'h';
	const jsxH = 'h';
	// Markup is `dom`'s tag and means `dom`'s `h`, whatever else this file calls `h`. When the
	// file's `h` is its own, `dom`'s comes in under a name nothing else in the file uses.
	const markupH = domIsH ? 'h' : bindings.domH ?? freshName('_h', bindings.names);
	const templateName = freshName('_template', bindings.names);
	const joinedName = freshName('_joined', bindings.names);
	const hoister = createHoister(domIsH, templateName, freshPrefix('_t', bindings.names));

	let usedJsxH = false;
	let usedMarkupH = false;
	let usedJoined = false;

	const isDomHCall = (node: Node): boolean =>
		node.type === 'CallExpression' && bindings.domH !== null
		&& (node['callee'] as Node).type === 'Identifier'
		&& (node['callee'] as Node)['name'] === bindings.domH;

	const isMarkup = (node: Node): boolean =>
		node.type === 'TaggedTemplateExpression' && bindings.domHtml !== null
		&& (node['tag'] as Node).type === 'Identifier'
		&& (node['tag'] as Node)['name'] === bindings.domHtml;

	const isJsx = (node: Node): boolean => node.type === 'JSXElement' || node.type === 'JSXFragment';

	const transformable = (node: Node): boolean => isJsx(node) || isMarkup(node) || isDomHCall(node);

	/** The outermost transformable nodes strictly inside a node. Their own readers go deeper. */
	const inside = (root: Node): Node[] => {
		const found: Node[] = [];
		const search = (node: Node): void => {
			forEachChild(node, (child) => {
				if (transformable(child)) found.push(child);
				else search(child);
			});
		};
		search(root);
		return found;
	};

	/** The source of a node with every transformable strictly inside it replaced. */
	const inner = (node: Node): string => {
		const parts: string[] = [];
		let at = node.start;
		for (const found of inside(node)) {
			parts.push(source.slice(at, found.start), code(found));
			at = found.end;
		}
		parts.push(source.slice(at, node.end));
		return parts.join('');
	};

	const code = (node: Node): string => {
		if (isJsx(node)) return readJsx(node, jsxReader);
		if (isMarkup(node)) return readMarkup(node, markupReader);
		if (isDomHCall(node)) {
			const element = readCall(node, callReader);
			return element === null ? inner(node) : hoister.emit(element);
		}
		return inner(node);
	};

	const emit = (element: Element): string => hoister.emit(element);

	// The two `h` names are asked for when an element is printed as a call, never when it hoists,
	// so the import below is emitted for calls that are actually in the output.
	const jsxReader: JsxReader = {
		h: () => {
			usedJsxH = true;
			return jsxH;
		},
		code,
		source,
		emit,
	};
	const markupReader: MarkupReader = {
		h: () => {
			usedMarkupH = true;
			return markupH;
		},
		joined: (pieces) => {
			usedJoined = true;
			return `${joinedName}([${pieces.join(', ')}])`;
		},
		code,
		emit,
	};
	const callReader: CallReader = { isCall: isDomHCall, code, inner, emit };

	for (const found of inside(program)) magic.overwrite(found.start, found.end, code(found));

	if (options.release === true && bindings.assert !== null) {
		stripAsserts(program, bindings.assert, magic);
	}

	const imported: string[] = [];
	if (needsH && (usedJsxH || usedMarkupH)) imported.push('h');
	if (!domIsH && bindings.domH === null && usedMarkupH) imported.push(`h as ${markupH}`);
	if (usedJoined) imported.push(`joined as ${joinedName}`);
	if (hoister.declarations.length > 0) imported.push(`template as ${templateName}`);

	const preamble = imported.length > 0 ? `import { ${imported.join(', ')} } from '${DOM}';\n` : '';
	const declarations = hoister.declarations.length > 0 ? `${hoister.declarations.join('\n')}\n` : '';

	// Above everything, not after the last import. A module may legally put a statement before an
	// import, because imports hoist, and a declaration placed after that statement is in a temporal
	// dead zone when the statement uses it. A declaration holds only a `template` call over literal
	// data, and every import binding is live before the body runs, so the top is always safe.
	if (preamble !== '' || declarations !== '') magic.prepend(preamble + declarations);

	return {
		code: magic.toString(),
		map: magic.generateMap({ hires: true, includeContent: true, ...(filename === undefined ? {} : { source: filename }) }) as unknown as SourceMap,
	};
};
