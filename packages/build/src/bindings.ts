// What names the file already has, and which of them came from `@aweftjs/dom`.
//
// Three answers come out of this: which `h` the JSX pass should call, whether that `h` is
// provably the binding's own so a static subtree may be hoisted (design 092), and which name,
// if any, is an assert the release build removes (design 097).

import { type Node, patternNames, walk } from './ast.ts';

const DOM = '@aweftjs/dom';
// The second blessed identity (design 108). `build` knows this specifier and nothing else about
// the package behind it.
const UI = '@aweftjs/ui';

// A neighbouring assert module: a relative specifier whose last segment is `assert`. That is how
// every assert in this stack is imported, and it never matches `node:assert/strict`.
const NEIGHBOURING_ASSERT = /^\.{1,2}\/(?:[^/]+\/)*assert(?:\.[cm]?[jt]sx?)?$/;

export interface Bindings {
	/** The local name bound to `dom`'s `h`, or null when the file has no `h` from `dom`. */
	readonly domH: string | null;
	/** The local name bound to `dom`'s `html` tag, or null. */
	readonly domHtml: string | null;
	/** The local name bound to `ui`'s `h`, or null when the file has no `h` from `ui`. */
	readonly uiH: string | null;
	/** The local name bound to `ui`'s `html` tag, or null. */
	readonly uiHtml: string | null;
	/** The local name of an assert imported from a neighbouring assert module, or null. */
	readonly assert: string | null;
	/** The local name bound to `ui`'s `Icon`, or null when the file has no `Icon` from `ui`. */
	readonly uiIcon: string | null;
	/** Every name the file binds, however it binds it. */
	readonly binds: ReadonlySet<string>;
	/** Every name that appears in the file, bound or merely used, so a generated name can dodge
	 * all of them. */
	readonly names: ReadonlySet<string>;
}

/** A name is bound once by the import that names it and nowhere else in the file. */
const boundOnlyByImport = (name: string, counts: ReadonlyMap<string, number>): boolean =>
	counts.get(name) === 1;

/**
 * Read the file's bindings.
 *
 * Params:
 *   program: the parsed file's Program node
 *
 * Returns: which names came from `@aweftjs/dom` and `@aweftjs/ui`, the assert to strip, and
 * every name the file binds or merely mentions. A name the file binds twice, by its import and
 * again by something else, is answered as null: what it means at a given line is no longer the
 * import's business.
 *
 * Example:
 *   const bindings = readBindings(ast.program);
 *   if (bindings.domH !== null) { ... }
 */
export const readBindings = (program: Node): Bindings => {
	const counts = new Map<string, number>();
	const names = new Set<string>();
	const add = (name: string): void => { counts.set(name, (counts.get(name) ?? 0) + 1); };

	let importedH: string | null = null;
	let importedHtml: string | null = null;
	let importedUiH: string | null = null;
	let importedUiHtml: string | null = null;
	let importedAssert: string | null = null;
	let importedIcon: string | null = null;

	for (const statement of program['body'] as Node[]) {
		if (statement.type !== 'ImportDeclaration') continue;
		const from = (statement['source'] as Node)['value'] as string;
		for (const specifier of statement['specifiers'] as Node[]) {
			const local = (specifier['local'] as Node)['name'] as string;
			add(local);
			if (specifier.type !== 'ImportSpecifier') continue;
			const imported = specifier['imported'] as Node;
			const name = imported.type === 'Identifier' ? imported['name'] as string : imported['value'] as string;
			if (from === DOM && name === 'h') importedH = local;
			if (from === DOM && name === 'html') importedHtml = local;
			if (from === UI && name === 'h') importedUiH = local;
			if (from === UI && name === 'html') importedUiHtml = local;
			if (from === UI && name === 'Icon') importedIcon = local;
			if (NEIGHBOURING_ASSERT.test(from) && name === 'assert') importedAssert = local;
		}
	}

	walk(program, (node) => {
		if (node.type === 'Identifier') names.add(node['name'] as string);
		switch (node.type) {
			case 'VariableDeclarator':
				patternNames(node['id'] as Node, add);
				return true;
			case 'FunctionDeclaration':
			case 'FunctionExpression':
			case 'ArrowFunctionExpression':
			case 'ObjectMethod':
			case 'ClassMethod':
				if (node['id'] !== null && node['id'] !== undefined) add(((node['id'] as Node)['name']) as string);
				for (const param of node['params'] as Node[]) patternNames(param, add);
				return true;
			case 'ClassDeclaration':
			case 'ClassExpression':
				if (node['id'] !== null && node['id'] !== undefined) add(((node['id'] as Node)['name']) as string);
				return true;
			case 'CatchClause':
				if (node['param'] !== null && node['param'] !== undefined) {
					patternNames(node['param'] as Node, add);
				}
				return true;
			default:
				return true;
		}
	});

	return {
		domH: importedH !== null && boundOnlyByImport(importedH, counts) ? importedH : null,
		domHtml: importedHtml !== null && boundOnlyByImport(importedHtml, counts) ? importedHtml : null,
		uiH: importedUiH !== null && boundOnlyByImport(importedUiH, counts) ? importedUiH : null,
		uiHtml: importedUiHtml !== null && boundOnlyByImport(importedUiHtml, counts) ? importedUiHtml : null,
		assert: importedAssert,
		uiIcon: importedIcon !== null && boundOnlyByImport(importedIcon, counts) ? importedIcon : null,
		binds: new Set(counts.keys()),
		names,
	};
};

/**
 * A name nothing in the file uses.
 *
 * Params:
 *   base: the name to start from
 *   taken: the names already spoken for
 *
 * Returns: `base` when it is free, and otherwise `base` with the first number that is.
 *
 * Example:
 *   const name = freshName('h', bindings.names);
 */
export const freshName = (base: string, taken: ReadonlySet<string>): string => {
	if (!taken.has(base)) return base;
	for (let i = 1; ; i++) {
		const name = `${base}${i}`;
		if (!taken.has(name)) return name;
	}
};

/**
 * A prefix no name in the file already numbers off.
 *
 * A generated name is the prefix and a count, and how high the count goes is not known when the
 * prefix is picked, so it is not enough for the prefix itself to be free: nothing in the file may
 * be the prefix followed by digits.
 *
 * Params:
 *   base: the prefix to start from
 *   taken: the names already spoken for
 *
 * Returns: `base`, or `base` with as many underscores as it takes.
 *
 * Example:
 *   const prefix = freshPrefix('_t', bindings.names);
 */
export const freshPrefix = (base: string, taken: ReadonlySet<string>): string => {
	for (let prefix = base; ; prefix += '_') {
		const clash = [...taken].some((name) =>
			name.startsWith(prefix) && /^[0-9]+$/.test(name.slice(prefix.length)));
		if (!clash) return prefix;
	}
};
