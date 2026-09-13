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
	// Every name an import brought in, and where each is used. The assert's own import goes when
	// its calls do, and so does any other import whose every use was inside one of those calls:
	// a helper that only an assert ever named has nothing left to do in the file.
	const uses = new Map<string, number[]>();
	for (const statement of program['body'] as Node[]) {
		if (statement.type !== 'ImportDeclaration') continue;
		for (const specifier of statement['specifiers'] as Node[]) uses.set((specifier['local'] as Node)['name'] as string, []);
	}
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

		if (node.type === 'Identifier' && !named.has(node)) uses.get(node['name'] as string)?.push(node.start);
		if (node.type !== 'ExpressionStatement') return true;
		const call = node['expression'] as Node;
		if (call.type !== 'CallExpression') return true;
		const callee = call['callee'] as Node;
		if (callee.type !== 'Identifier' || callee['name'] !== local) return true;
		// A call inside a call already cut goes with it. The walk still goes in, so a name used
		// only in there is seen to be used only in there.
		if (!cuts.some((cut) => node.start >= cut.start && node.end <= cut.end)) {
			cuts.push({ start: node.start, end: node.end, solo: solo.has(node) });
		}
		return true;
	});

	// An empty statement where the language requires one, and nothing where a list is allowed.
	for (const cut of cuts) {
		if (cut.solo) magic.overwrite(cut.start, cut.end, ';');
		else magic.remove(cut.start, cut.end);
	}

	// A use inside a statement that just went is not a use any more. The assert goes when no use
	// is left; another import goes when it had uses and every one was in there, because one
	// nothing ever named is the author's own and stays.
	const inside = (at: number): boolean => cuts.some((cut) => at >= cut.start && at < cut.end);
	const gone = new Set<string>();
	for (const [name, at] of uses) {
		if ((name === local || at.length > 0) && at.every(inside)) gone.add(name);
	}
	if (gone.size > 0) removeImports(program, gone, magic);

	return cuts.length;
};

/** Take the specifiers out of their imports, and a whole import when nothing of it is left. */
const removeImports = (program: Node, gone: ReadonlySet<string>, magic: MagicString): void => {
	for (const statement of program['body'] as Node[]) {
		if (statement.type !== 'ImportDeclaration') continue;
		const specifiers = statement['specifiers'] as Node[];
		const kept = specifiers.filter((specifier) => !gone.has((specifier['local'] as Node)['name'] as string));
		if (kept.length === specifiers.length) continue;
		if (kept.length === 0) {
			magic.remove(statement.start, statement.end);
			continue;
		}
		// The list written again with what is left, so the commas come out right whichever went.
		const first = specifiers[0]!;
		const last = specifiers[specifiers.length - 1]!;
		magic.overwrite(first.start, last.end, kept.map((specifier) => magic.original.slice(specifier.start, specifier.end)).join(', '));
	}
};
