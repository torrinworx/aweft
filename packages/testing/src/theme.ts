// The rule that a component of this library uses named values and never writes one where it
// stands, and the snapshot of every name there is (design 119).
//
// **What a theme definition is, precisely.** A theme definition is where a value is given a name.
// A literal is allowed there and nowhere else. The source is read as a tree, not as text, and
// only three positions are read:
//
// 1. Inside an object handed to `Theme.define(...)` or `defineTheme(...)`, every property whose
//    key does NOT start with `$`, following the nested blocks (`_cssProp_`, `_media_`, `_elem_`,
//    `_children_`). A `$name` property is the definition of a value and its literal is skipped.
// 2. Inside a `style` object: `style={{ ... }}` in JSX, and any `style:` property holding an
//    object literal, which is how `h(tag, { style: { ... } })` writes one.
// 3. Nowhere else. A string sitting in ordinary code is not in a CSS position and is not read.
//
// The `value` given to a `Theme` provider is skipped whole, in either spelling. That is what keeps
// the check off a page's own theme and off a nested theme.
//
// Three limits, written down because a checker whose gaps are unknown is worse than one whose gaps
// are written down.
//
// 1. Only an object literal written where it is used is read. A style object built by a helper and
//    returned is invisible.
// 2. The size-property list below is a copy of the one in `packages/ui/src/values.ts`. A gate
//    script runs without this stack's own loader and cannot import a `.tsx` package, so the two
//    can drift; what drifting costs is a bare number that goes unchecked.
// 3. A `$name` may hold anything, so a component that gives a literal a name has got past this.
//    That is the intended escape hatch, and it is one word in review.

import ts from 'typescript';

/** One value written where it stands rather than named. */
export interface ThemeViolation {
	/** The file, as it was handed in. */
	readonly path: string;
	/** One-based. */
	readonly line: number;
	/** The theme entry or `style` the declaration sits in. */
	readonly where: string;
	/** The CSS property. */
	readonly property: string;
	/** What was written. */
	readonly literal: string;
	/** The named value to use instead. */
	readonly fix: string;
}

/** One file to read. */
export interface ThemeSource {
	readonly path: string;
	readonly text: string;
}

// The sixteen names CSS has had since level 2. `transparent`, `currentColor` and `inherit` are
// keywords rather than colour choices and pass.
const COLOUR_NAMES = [
	'black', 'silver', 'gray', 'white', 'maroon', 'red', 'purple', 'fuchsia',
	'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua',
];

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOUR_CALL = /\b(?:rgb|rgba|hsl|hsla)\s*\(/;
const COLOUR_NAME = new RegExp(`\\b(?:${COLOUR_NAMES.join('|')})\\b`);
const SIZE = /(?:^|[^\w.$-])(\d+(?:\.\d+)?|\.\d+)(px|rem|em)\b/;
const DURATION = /(?:^|[^\w.$-])(\d+(?:\.\d+)?|\.\d+)(ms|s)\b/;
const RING = /\$ring\b/;

// A copy of `sizeProperties`; see limit 2 above.
const SIZE_PROPERTIES = new Set([
	'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
	'top', 'right', 'bottom', 'left', 'inset',
	'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
	'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
	'gap', 'rowGap', 'columnGap', 'fontSize', 'lineHeight', 'letterSpacing',
	'borderRadius', 'borderWidth', 'outlineWidth', 'outlineOffset', 'strokeWidth',
	'flexBasis', 'translate', 'textIndent',
]);

/** The role a colour in this property should have come from. */
const colourRole = (property: string): string => {
	const name = property.toLowerCase();
	if (name.includes('background')) return '$surface';
	if (name.includes('outline')) return '$ring';
	if (name.includes('border') || name.includes('shadow')) return '$border';
	return '$foreground';
};

/** The named size this property should have come from. */
const sizeRole = (property: string): string => {
	const name = property.toLowerCase();
	if (name.includes('radius')) return '$radius';
	if (name === 'fontsize') return '$textMd';
	if (name === 'lineheight') return '$textMdLine';
	if (name === 'outline' || name === 'outlinewidth') return '$ringWidth';
	if (name === 'outlineoffset') return '$ringOffset';
	if (name === 'borderwidth' || name === 'border') return '$borderWidth';
	if (name === 'minwidth' || name === 'minheight') return '$target';
	return '$space';
};

const keyOf = (name: ts.PropertyName): string | undefined => {
	if (ts.isIdentifier(name)) return name.text;
	if (ts.isStringLiteral(name)) return name.text;
	return undefined;
};

const textOf = (node: ts.Expression): string | undefined =>
	(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined);

const isDirective = (key: string): boolean => /^_[A-Za-z]+_/.test(key);

/** One declaration, flattened out of an entry and its nested blocks. */
interface Declaration {
	readonly property: string;
	readonly value: ts.Expression;
	readonly text: string | undefined;
}

const flatten = (block: ts.ObjectLiteralExpression, out: Declaration[]): void => {
	for (const member of block.properties) {
		if (!ts.isPropertyAssignment(member)) continue;
		const key = keyOf(member.name);
		if (key === undefined || key.startsWith('$') || key === 'extends') continue;

		const value = member.initializer;
		if (ts.isObjectLiteralExpression(value)) {
			// A directive block holds declarations of its own; anything else keyed to an object is
			// not CSS this check knows how to read.
			if (isDirective(key)) flatten(value, out);
			continue;
		}
		out.push({ property: key, value, text: textOf(value) });
	}
};

const violationsIn = (
	source: ts.SourceFile,
	path: string,
	where: string,
	block: ts.ObjectLiteralExpression,
	out: ThemeViolation[],
): void => {
	const declarations: Declaration[] = [];
	flatten(block, declarations);

	const at = (node: ts.Node): number =>
		source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

	let sawRing = false;
	let outlineOff: Declaration | undefined;

	for (const declaration of declarations) {
		const { property, value, text } = declaration;

		if (text !== undefined && RING.test(text)) sawRing = true;
		if (property === 'outline' || property === 'outlineStyle' || property === 'outlineWidth') {
			const off = text === 'none' || text === '0'
				|| (ts.isNumericLiteral(value) && Number(value.text) === 0);
			if (off) outlineOff = declaration;
		}

		if (text === undefined) {
			// A bare number in a property where a bare number means pixels is a size written where
			// it stands, the same as `8px` would be. Zero is not a design value.
			if (ts.isNumericLiteral(value) && SIZE_PROPERTIES.has(property) && Number(value.text) !== 0) {
				out.push({ path, line: at(value), where, property, literal: value.text, fix: sizeRole(property) });
			}
			continue;
		}

		const colour = HEX.exec(text) ?? COLOUR_CALL.exec(text) ?? COLOUR_NAME.exec(text);
		if (colour !== null) {
			out.push({ path, line: at(value), where, property, literal: colour[0], fix: colourRole(property) });
		}
		const size = SIZE.exec(text);
		if (size !== null && Number(size[1]) !== 0) {
			out.push({ path, line: at(value), where, property, literal: size[1]! + size[2]!, fix: sizeRole(property) });
		}
		const duration = DURATION.exec(text);
		if (duration !== null) {
			out.push({ path, line: at(value), where, property, literal: duration[1]! + duration[2]!, fix: '$fast' });
		}
	}

	if (outlineOff !== undefined && !sawRing) {
		out.push({
			path,
			line: at(outlineOff.value),
			where,
			property: 'outline',
			literal: outlineOff.text ?? '0',
			fix: '$ring',
		});
	}
};

const isThemeDefine = (call: ts.CallExpression): boolean => {
	const callee = call.expression;
	if (ts.isIdentifier(callee)) return callee.text === 'defineTheme';
	return ts.isPropertyAccessExpression(callee)
		&& callee.name.text === 'define'
		&& ts.isIdentifier(callee.expression)
		&& callee.expression.text === 'Theme';
};

const parse = (file: ThemeSource): ts.SourceFile =>
	ts.createSourceFile(
		file.path,
		file.text,
		ts.ScriptTarget.ES2023,
		true,
		file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);

/**
 * Every value written where it stands rather than named.
 *
 * Params:
 *   files: the source files to read, each with the path to report it under
 *
 * Returns: one entry per literal, in file then position order. Empty means every value in a CSS
 * position came through a `$name`.
 *
 * Example:
 *   const found = checkTheme([{ path: 'a.tsx', text: readFileSync('a.tsx', 'utf8') }]);
 */
export const checkTheme = (files: readonly ThemeSource[]): ThemeViolation[] => {
	const out: ThemeViolation[] = [];

	for (const file of files) {
		const source = parse(file);
		const skip = new Set<ts.Node>();

		const walk = (node: ts.Node): void => {
			if (skip.has(node)) return;

			// A `Theme` provider's value is a page's own theme, and this check does not police one.
			if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
				if (ts.isIdentifier(node.tagName) && node.tagName.text === 'Theme') {
					for (const attribute of node.attributes.properties) {
						if (ts.isJsxAttribute(attribute) && keyOf(attribute.name as ts.PropertyName) === 'value') {
							skip.add(attribute);
						}
					}
				}
			}

			if (ts.isCallExpression(node)) {
				const [first, second] = node.arguments;
				if (first !== undefined && ts.isIdentifier(first) && first.text === 'Theme'
					&& second !== undefined && ts.isObjectLiteralExpression(second)) {
					for (const member of second.properties) {
						if (ts.isPropertyAssignment(member) && keyOf(member.name) === 'value') skip.add(member);
					}
				}

				if (isThemeDefine(node)) {
					for (const argument of node.arguments) {
						if (!ts.isObjectLiteralExpression(argument)) continue;
						skip.add(argument);
						for (const member of argument.properties) {
							if (!ts.isPropertyAssignment(member)) continue;
							const name = keyOf(member.name);
							if (name === undefined || !ts.isObjectLiteralExpression(member.initializer)) continue;
							violationsIn(source, file.path, name, member.initializer, out);
						}
					}
				}
			}

			// A `style` object is CSS wherever it is written: `style={{ ... }}` in JSX, and the
			// `style` property of a props object.
			if (ts.isPropertyAssignment(node) && keyOf(node.name) === 'style'
				&& ts.isObjectLiteralExpression(node.initializer)) {
				skip.add(node.initializer);
				violationsIn(source, file.path, 'style', node.initializer, out);
			}
			if (ts.isJsxAttribute(node) && keyOf(node.name as ts.PropertyName) === 'style'
				&& node.initializer !== undefined && ts.isJsxExpression(node.initializer)
				&& node.initializer.expression !== undefined
				&& ts.isObjectLiteralExpression(node.initializer.expression)) {
				skip.add(node.initializer.expression);
				violationsIn(source, file.path, 'style', node.initializer.expression, out);
			}

			ts.forEachChild(node, walk);
		};

		walk(source);
	}

	return out;
};

/**
 * Every `$name` these files define.
 *
 * Params:
 *   files: the source files to read
 *
 * Returns: the names, sorted, without their `$`, each once. Every scale step, every role, every
 * size, every duration and every theme function the package ships.
 *
 * Example:
 *   const names = themeTokens([{ path: 'roles.ts', text }]);
 */
export const themeTokens = (files: readonly ThemeSource[]): string[] => {
	const found = new Set<string>();

	for (const file of files) {
		const source = parse(file);
		const walk = (node: ts.Node): void => {
			if (ts.isPropertyAssignment(node)) {
				const key = keyOf(node.name);
				if (key !== undefined && key.startsWith('$') && key.length > 1) found.add(key.slice(1));
			}
			ts.forEachChild(node, walk);
		};
		walk(source);
	}

	return [...found].sort();
};
