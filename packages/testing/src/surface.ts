// The public surface of a package, written down so a change to it cannot be silent.
//
// The exports map says which file is public. It does not say what that file hands out, and a
// widened parameter, a dropped interface member or an accidental extra export all leave it
// untouched. This turns the module into text: one line per export, its kind, and its type as
// the compiler resolves it, so the diff of a generated file is the diff of the API.
//
// The type comes from the checker rather than from the source, because that is what a caller
// sees. A declaration whose text has not changed can still hand out a different type when
// something underneath it moved, and the checker notices while a text comparison does not.
// Interfaces and type aliases are the exception: their own text IS the surface, member by
// member, and printing it keeps a removed member visible as a removed member.

import ts from 'typescript';

import { aweftPackageOf } from './imports.ts';

// The root toolchain's options, minus everything that only matters for emit. No `paths`: the
// workspace links resolve `@aweftjs/*` the same way Node does at runtime.
const OPTIONS: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2023,
	module: ts.ModuleKind.NodeNext,
	moduleResolution: ts.ModuleResolutionKind.NodeNext,
	allowImportingTsExtensions: true,
	strict: true,
	skipLibCheck: true,
	noEmit: true,
};

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

/**
 * One program over several entry files, so a whole repo's surfaces share one checker.
 *
 * Params:
 *   indexPaths: absolute paths to the `src/index.ts` of each package
 *
 * Returns: a program those paths can be read from. Building one per package costs a fresh
 * parse of every file they share.
 *
 * Example:
 *   const program = surfaceProgram(['/repo/packages/core/src/index.ts']);
 */
export const surfaceProgram = (indexPaths: readonly string[]): ts.Program =>
	ts.createProgram([...indexPaths], OPTIONS);

// Where the entry file got this export from, when that is another package in the stack. Only
// the direct re-export counts: `export { x } from '@aweftjs/codec'` is codec's surface showing
// through, while a local file that happens to import codec is this package's own work.
const reExportedFrom = (exported: ts.Symbol): string | undefined => {
	for (const declaration of exported.declarations ?? []) {
		if (!ts.isExportSpecifier(declaration)) continue;

		const specifier = declaration.parent.parent.moduleSpecifier;
		if (specifier !== undefined && ts.isStringLiteral(specifier)) {
			return aweftPackageOf(specifier.text);
		}
	}
	return undefined;
};

const shapeOf = (declaration: ts.Declaration): string =>
	printer.printNode(ts.EmitHint.Unspecified, declaration, declaration.getSourceFile())
		.replace(/\s+/g, ' ')
		.replace(/^export /, '')
		.trim();

/**
 * The public surface of one package, as text.
 *
 * Params:
 *   indexPath: absolute path to the package's `src/index.ts`
 *   program: a program that already contains that file. One is built for it when omitted
 *
 * Returns: one line per export, sorted by name. A value reads `value name: type`, an
 * interface or type alias reads `type name: declaration`, and an export re-exported from
 * another package in the stack ends with ` (from @aweftjs/<name>)`.
 *
 * Example:
 *   surfaceOf('/repo/packages/sync/src/index.ts');
 *   // 'value track: (document: unknown, on: (event: Tracked) => void) => Tracker'
 */
export const surfaceOf = (indexPath: string, program = surfaceProgram([indexPath])): string[] => {
	const file = program.getSourceFile(indexPath);
	if (file === undefined) throw new Error(`${indexPath} is not part of the program`);

	const checker = program.getTypeChecker();
	const entry = checker.getSymbolAtLocation(file);
	if (entry === undefined) return [];

	const lines = checker.getExportsOfModule(entry).map((exported) => {
		const target = (exported.flags & ts.SymbolFlags.Alias) === 0
			? exported
			: checker.getAliasedSymbol(exported);

		const from = reExportedFrom(exported);
		const suffix = from === undefined ? '' : ` (from @aweftjs/${from})`;
		const declaration = target.declarations?.[0];

		const shape = declaration !== undefined
			&& (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration));

		const body = shape
			? `type ${exported.name}: ${shapeOf(declaration)}`
			: `value ${exported.name}: ${checker.typeToString(
				checker.getTypeOfSymbolAtLocation(target, file),
				undefined,
				ts.TypeFormatFlags.NoTruncation,
			)}`;

		return { name: exported.name, line: body + suffix };
	});

	// Two exports of a module cannot share a name, so there is no tie to break.
	lines.sort((one, two) => (one.name < two.name ? -1 : 1));
	return lines.map((found) => found.line);
};
