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
import type { Element, Property } from './element.ts';
import { createIconImports } from './icons.ts';
import { createHoister } from './hoist.ts';
import { type JsxReader, readJsx } from './jsx.ts';
import { type MarkupReader, readMarkup } from './markup.ts';
import { freshName, freshPrefix, readBindings } from './bindings.ts';
import { stripAsserts } from './asserts.ts';

const DOM = '@aweftjs/dom';
const UI = '@aweftjs/ui';

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
	/**
	 * The package a file that binds no `h` of its own gets one from. `@aweftjs/dom` when it is
	 * left off, so `build` assumes nothing about `ui`.
	 *
	 * An application whose pages are `ui` pages sets it to `@aweftjs/ui`. Without it, JSX in a
	 * file that imports `Theme` and `mount` but forgets `h` compiles to `dom`'s `h`, and a
	 * `theme` prop is written out as a literal attribute that nothing reads.
	 */
	readonly defaultH?: '@aweftjs/dom' | '@aweftjs/ui';
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
	// Hoisting needs `h` to be provably `dom`'s or `ui`'s: either the file binds none and the
	// import below supplies the caller's default, or its one binding of the name is one of those
	// two imports (designs 095 case 4, and 108).
	const uiIsH = bindings.uiH === 'h' || (needsH && options.defaultH === UI);
	const domIsH = !uiIsH && (needsH || bindings.domH === 'h');
	const hoisting = domIsH || uiIsH;
	const jsxH = 'h';
	// A hand-written call is read as an element only when it calls the same `h` a hoisted
	// template would stand in for. A file holding both packages' `h` keeps the other one's calls
	// exactly as written.
	const primaryH = uiIsH ? bindings.uiH : bindings.domH;
	// Markup means whichever package's `html` tagged it. When that package's `h` is not the
	// file's own `h`, it comes in under a name nothing else in the file uses.
	const domMarkupH = domIsH ? 'h' : bindings.domH ?? freshName('_h', bindings.names);
	const uiMarkupH = uiIsH ? 'h' : bindings.uiH ?? freshName('_uh', bindings.names);
	const templateName = freshName('_template', bindings.names);
	const joinedName = freshName('_joined', bindings.names);
	// A `ui` file's properties never go in the prototype, because `theme` is not an attribute and
	// `build` does not carry `ui`'s vocabulary (design 108).
	const hoister = createHoister(hoisting, templateName, freshPrefix('_t', bindings.names), !uiIsH);
	const icons = createIconImports(freshPrefix('_icon', bindings.names));

	let usedJsxH = false;
	let usedDomMarkupH = false;
	let usedUiMarkupH = false;
	let usedJoined = false;

	const isDomHCall = (node: Node): boolean =>
		node.type === 'CallExpression' && primaryH !== null
		&& (node['callee'] as Node).type === 'Identifier'
		&& (node['callee'] as Node)['name'] === primaryH;

	const markupTagOf = (node: Node): string | null => {
		if (node.type !== 'TaggedTemplateExpression') return null;
		const tag = node['tag'] as Node;
		if (tag.type !== 'Identifier') return null;
		const name = tag['name'] as string;
		if (bindings.uiHtml !== null && name === bindings.uiHtml) return UI;
		if (bindings.domHtml !== null && name === bindings.domHtml) return DOM;
		return null;
	};

	const isMarkup = (node: Node): boolean => markupTagOf(node) !== null;

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

	/** The source of a node with the given pieces of it replaced, in source order. */
	const spliced = (node: Node, pieces: readonly (readonly [Node, string])[]): string => {
		const parts: string[] = [];
		let at = node.start;
		for (const [found, text] of [...pieces].sort((a, b) => a[0].start - b[0].start)) {
			parts.push(source.slice(at, found.start), text);
			at = found.end;
		}
		parts.push(source.slice(at, node.end));
		return parts.join('');
	};

	/** The source of a node with every transformable strictly inside it replaced. */
	const inner = (node: Node): string =>
		spliced(node, inside(node).map((found) => [found, code(found)] as const));

	/**
	 * The `name` string literal of an `h(Icon, { name: 'set:name' })` call, or null.
	 *
	 * A spread anywhere in the properties answers null: it may carry a `name` of its own at run
	 * time, and which of the two wins is not something the source says.
	 */
	const iconName = (node: Node): Node | null => {
		if (bindings.uiIcon === null) return null;
		const args = node['arguments'] as Node[];
		const callee = args[0];
		if (callee === undefined || callee.type !== 'Identifier' || callee['name'] !== bindings.uiIcon) return null;
		const properties = args[1];
		if (properties === undefined || properties.type !== 'ObjectExpression') return null;

		let found: Node | null = null;
		for (const entry of properties['properties'] as Node[]) {
			if (entry.type === 'SpreadElement') return null;
			if (entry.type !== 'ObjectProperty' || entry['computed'] === true) continue;
			const key = entry['key'] as Node;
			const named = key.type === 'Identifier' ? key['name'] as string
				: key.type === 'StringLiteral' ? key['value'] as string
					: null;
			if (named !== 'name') continue;
			const value = entry['value'] as Node;
			found = value.type === 'StringLiteral' ? value : null;
		}
		return found;
	};

	/** An `h(Icon, ...)` call with its literal name replaced, or null when nothing is rewritten. */
	const iconCall = (node: Node): string | null => {
		const literal = iconName(node);
		if (literal === null) return null;
		const bound = icons.take(literal['value'] as string);
		if (bound === null) return null;
		return spliced(node, [
			...inside(node).map((found) => [found, code(found)] as const),
			[literal, bound] as const,
		]);
	};

	const code = (node: Node): string => {
		if (isJsx(node)) return readJsx(node, jsxReader);
		if (isMarkup(node)) return readMarkup(node, markupTagOf(node) === UI ? uiMarkupReader : domMarkupReader);
		if (isDomHCall(node)) {
			const element = readCall(node, callReader);
			if (element !== null) return hoister.emit(element);
			return iconCall(node) ?? inner(node);
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
		properties: (tag, properties) => {
			if (bindings.uiIcon === null || tag !== bindings.uiIcon) return properties;
			// A spread may carry a `name` of its own, and which of the two wins is not something
			// the source says, so a spread anywhere leaves the element alone.
			if (properties.some((property) => property.kind === 'spread')) return properties;
			return properties.map((property): Property => {
				if (property.kind !== 'static' || property.name !== 'name') return property;
				if (typeof property.value !== 'string') return property;
				const bound = icons.take(property.value);
				return bound === null ? property : { kind: 'expr', name: 'name', code: bound };
			});
		},
		code,
		source,
		emit,
	};
	const joinedCode = (pieces: string[]): string => {
		usedJoined = true;
		return `${joinedName}([${pieces.join(', ')}])`;
	};
	const domMarkupReader: MarkupReader = {
		h: () => {
			usedDomMarkupH = true;
			return domMarkupH;
		},
		joined: joinedCode,
		code,
		emit,
	};
	const uiMarkupReader: MarkupReader = {
		h: () => {
			usedUiMarkupH = true;
			return uiMarkupH;
		},
		joined: joinedCode,
		code,
		emit,
	};
	const callReader: CallReader = { isCall: isDomHCall, code, inner, emit };

	for (const found of inside(program)) magic.overwrite(found.start, found.end, code(found));

	if (options.release === true && bindings.assert !== null) {
		stripAsserts(program, bindings.assert, magic);
	}

	const fromDom: string[] = [];
	const fromUi: string[] = [];
	// The injected `h` comes from whichever package this file's `h` is, which is the default when
	// the file binds none.
	if (needsH && (usedJsxH || (domIsH && usedDomMarkupH) || (uiIsH && usedUiMarkupH))) (uiIsH ? fromUi : fromDom).push('h');
	if (!domIsH && bindings.domH === null && usedDomMarkupH) fromDom.push(`h as ${domMarkupH}`);
	if (!uiIsH && bindings.uiH === null && usedUiMarkupH) fromUi.push(`h as ${uiMarkupH}`);
	if (usedJoined) fromDom.push(`joined as ${joinedName}`);
	if (hoister.declarations.length > 0) (uiIsH ? fromUi : fromDom).push(`template as ${templateName}`);

	const preamble = [
		icons.declarations.length > 0 ? `${icons.declarations.join('\n')}\n` : '',
		fromDom.length > 0 ? `import { ${fromDom.join(', ')} } from '${DOM}';\n` : '',
		fromUi.length > 0 ? `import { ${fromUi.join(', ')} } from '${UI}';\n` : '',
	].join('');
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
