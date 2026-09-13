// The strings a package shows, compared with the committed catalog (design 278).
//
// `text.json` next to a package is the list of keys its own `text()` calls look up, so an
// application's catalog can carry the library's strings beside its own. It is generated, never
// hand-written: a string written into a component lands here in the same change, and the diff is
// the change. The gate fails on a difference, the way it does for `surface.txt`.
//
// What this reads: every `text('…')` call in a package's source whose `text` came from `./text.ts`
// (inside `ui`) or from `@aweftjs/ui` (every other package), with a literal message and, when the
// second argument names a literal `context`, the key `message|context`. A package with no such
// call ships no catalog.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

const root = join(import.meta.dirname, '..', '..', '..');
const write = process.argv.includes('--write');

const packages = readdirSync(join(root, 'packages'))
	.filter((name) => statSync(join(root, 'packages', name)).isDirectory())
	.filter((name) => existsSync(join(root, 'packages', name, 'src')))
	.sort();

/** Every `.ts` and `.tsx` under a directory, deepest last, as absolute paths. */
const sourcesOf = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourcesOf(path);
		return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
	}).sort();

const TEXT_MODULES = new Set(['./text.ts', '@aweftjs/ui']);

/** The local name `text` is bound under in a file, or null when the file has no such import. */
const bindingOf = (file: ts.SourceFile): string | null => {
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		if (!TEXT_MODULES.has(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			const imported = (element.propertyName ?? element.name).text;
			if (imported === 'text') return element.name.text;
		}
	}
	return null;
};

/** The literal `context` on a call's values object, or null. */
const contextOf = (values: ts.Expression | undefined): string | null => {
	if (values === undefined || !ts.isObjectLiteralExpression(values)) return null;
	for (const property of values.properties) {
		if (!ts.isPropertyAssignment(property)) continue;
		const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
		if (name !== 'context') continue;
		return ts.isStringLiteral(property.initializer) ? property.initializer.text : null;
	}
	return null;
};

/** The keys the `text()` calls in one file look up. */
const keysIn = (path: string): string[] => {
	const source = readFileSync(path, 'utf8');
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const name = bindingOf(file);
	if (name === null) return [];
	const keys: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
			const [message, values] = node.arguments;
			if (message !== undefined && ts.isStringLiteralLike(message)) {
				const context = contextOf(values);
				keys.push(context === null || context === '' ? message.text : `${message.text}|${context}`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return keys;
};

let changed = 0;
let shipped = 0;
for (const name of packages) {
	const dir = join(root, 'packages', name);
	const found = new Map<string, Set<string>>();
	for (const path of sourcesOf(join(dir, 'src'))) {
		for (const key of keysIn(path)) {
			let files = found.get(key);
			if (files === undefined) {
				files = new Set();
				found.set(key, files);
			}
			files.add(relative(dir, path).split('\\').join('/'));
		}
	}
	const path = join(dir, 'text.json');
	if (found.size === 0) {
		if (existsSync(path)) {
			changed += 1;
			console.error(`packages/${name}/text.json exists and the source has no text() call left`);
		}
		continue;
	}
	shipped += 1;
	const catalog: Record<string, string[]> = {};
	for (const key of [...found.keys()].sort()) catalog[key] = [...found.get(key)!].sort();
	const text = `${JSON.stringify(catalog, null, '\t')}\n`;

	if (write) {
		writeFileSync(path, text);
		continue;
	}
	const committed = existsSync(path) ? readFileSync(path, 'utf8') : '';
	if (committed === text) continue;
	changed += 1;
	console.error(`packages/${name}/text.json`);
	const before = new Set(Object.keys(committed === '' ? {} : JSON.parse(committed) as Record<string, unknown>));
	for (const key of before) if (!found.has(key)) console.error(`  -${JSON.stringify(key)}`);
	for (const key of found.keys()) if (!before.has(key)) console.error(`  +${JSON.stringify(key)}`);
}

if (changed > 0) {
	console.error('\ntext changed: regenerate with npm run text, and check the catalog in with the component that shows the string');
	process.exit(1);
}

console.log(`text: ${shipped} packages ship a catalog, each matching its source`);
