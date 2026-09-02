// Module specifier extraction, by parsing rather than pattern matching.
//
// The tier rule is only as good as the extraction feeding it, and a text scan misses
// spellings: quote styles, subpaths, template literals, a bare side-effect import. Parsing
// the source the way the compiler does leaves one honest boundary: a specifier that is not
// written as a literal (a variable, a concatenation, a renamed require) cannot be seen by
// any scanner, and evading the rule that way is deliberate, which review catches.

import ts from 'typescript';

/**
 * Every module specifier a source file names with a literal.
 *
 * Params:
 *   source: the file's text
 *   fileName: used only for parser diagnostics
 *
 * Returns: the specifiers of static imports and re-exports, dynamic `import()` calls whose
 * argument is a string or substitution-free template, and direct `require()` calls, in
 * order of appearance. Comments and ordinary strings are not imports and are not here.
 *
 * Example:
 *   const packages = moduleSpecifiers(text).map(aweftPackageOf).filter((p) => p !== undefined);
 */
export const moduleSpecifiers = (source: string, fileName = 'module.ts'): string[] => {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true);
	const found: string[] = [];

	const literal = (node: ts.Node): string | undefined => {
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
		return undefined;
	};

	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const from = node.moduleSpecifier === undefined ? undefined : literal(node.moduleSpecifier);
			if (from !== undefined) found.push(from);
		} else if (ts.isCallExpression(node)) {
			const callee = node.expression;
			const dynamic = callee.kind === ts.SyntaxKind.ImportKeyword;
			const required = ts.isIdentifier(callee) && callee.text === 'require';
			if ((dynamic || required) && node.arguments.length > 0) {
				const from = literal(node.arguments[0]!);
				if (from !== undefined) found.push(from);
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(file);
	return found;
};

/**
 * The package a specifier reaches inside this stack, or undefined for anything else.
 *
 * Params:
 *   specifier: a module specifier as written
 *
 * Returns: the package name for `@aweftjs/<name>` and any subpath under it. A subpath
 * import is still an edge to that package; whether reaching a subpath is legal is the
 * exports map's question, not this one's.
 *
 * Example:
 *   aweftPackageOf('@aweftjs/dom/router'); // 'dom'
 */
export const aweftPackageOf = (specifier: string): string | undefined => {
	if (!specifier.startsWith('@aweftjs/')) return undefined;
	const rest = specifier.slice('@aweftjs/'.length);
	const name = rest.split('/', 1)[0]!;
	return name === '' ? undefined : name;
};
