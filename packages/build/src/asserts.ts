// Removing asserts from a release build (design 097).
//
// One shape goes: a statement that is nothing but a call to a name imported by name from a
// neighbouring `assert` module. Once the calls are gone the import goes too, if nothing else in
// the file still names it.

import type MagicString from 'magic-string';

import { type Node, walk } from './ast.ts';

/** A range of the source to take out. `solo` is a range something else reads as a statement. */
interface Cut {
	readonly start: number;
	readonly end: number;
	readonly solo: boolean;
}

// Where the language wants one statement and a block is only one way to write it. Take the
// statement away here and the structure reads whatever follows as its body, which is a different
// program or no program at all: `if (x) assert(x); return x;` would become `if (x) return x;`.
const SOLO: Readonly<Record<string, readonly string[]>> = {
	IfStatement: ['consequent', 'alternate'],
	ForStatement: ['body'],
	ForInStatement: ['body'],
	ForOfStatement: ['body'],
	WhileStatement: ['body'],
	DoWhileStatement: ['body'],
	LabeledStatement: ['body'],
};

// An identifier that names a member rather than reading the binding. `log.assert(x)` and the key
// of `{ assert: fn }` both spell the name, and neither keeps the import alive.
const MEMBER = new Set(['MemberExpression', 'OptionalMemberExpression']);
const KEYED = new Set(['ObjectProperty', 'ObjectMethod', 'ClassMethod', 'ClassProperty', 'ClassPrivateProperty', 'PropertyDefinition']);

/**
 * Remove the assert calls and, when nothing is left using it, the import that brought them.
 *
 * Params:
 *   program: the parsed file's Program node
 *   local: the local name the assert was imported under
 *   magic: the source being edited
 *
 * Returns: how many calls were removed.
 *
 * Example:
 *   const removed = stripAsserts(ast.program, bindings.assert, magic);
 */
export const stripAsserts = (program: Node, local: string, magic: MagicString): number => {
	const cuts: Cut[] = [];
	const uses: number[] = [];
	// Both are filled by the parent, which the walk reaches before the child they are about.
	const solo = new Set<Node>();
	const named = new Set<Node>();

	walk(program, (node) => {
		if (node.type === 'ImportDeclaration') return false;

		for (const key of SOLO[node.type] ?? []) {
			const child = node[key];
			if (child !== null && child !== undefined) solo.add(child as Node);
		}
		if (MEMBER.has(node.type) && node['computed'] !== true) named.add(node['property'] as Node);
		if (KEYED.has(node.type) && node['computed'] !== true) named.add(node['key'] as Node);

		if (node.type === 'Identifier' && node['name'] === local && !named.has(node)) uses.push(node.start);
		if (node.type !== 'ExpressionStatement') return true;
		const call = node['expression'] as Node;
		if (call.type !== 'CallExpression') return true;
		const callee = call['callee'] as Node;
		if (callee.type !== 'Identifier' || callee['name'] !== local) return true;
		cuts.push({ start: node.start, end: node.end, solo: solo.has(node) });
		return false;
	});

	// An empty statement where the language requires one, and nothing where a list is allowed.
	for (const cut of cuts) {
		if (cut.solo) magic.overwrite(cut.start, cut.end, ';');
		else magic.remove(cut.start, cut.end);
	}

	// A use inside a statement that just went is not a use any more.
	const inside = (at: number): boolean => cuts.some((cut) => at >= cut.start && at < cut.end);
	if (!uses.some((at) => !inside(at))) removeImport(program, local, magic);

	return cuts.length;
};

/** Take the specifier out of its import, and the whole import when that was its only one. */
const removeImport = (program: Node, local: string, magic: MagicString): void => {
	for (const statement of program['body'] as Node[]) {
		if (statement.type !== 'ImportDeclaration') continue;
		const specifiers = statement['specifiers'] as Node[];
		const at = specifiers.findIndex((specifier) => (specifier['local'] as Node)['name'] === local);
		if (at < 0) continue;

		if (specifiers.length === 1) {
			magic.remove(statement.start, statement.end);
			return;
		}
		const specifier = specifiers[at]!;
		// Take the comma with it, on whichever side there is one to take.
		if (at === specifiers.length - 1) magic.remove(specifiers[at - 1]!.end, specifier.end);
		else magic.remove(specifier.start, specifiers[at + 1]!.start);
		return;
	}
};
