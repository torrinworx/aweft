// Every refusal a package can throw, written down so the vocabulary cannot drift in silence.
//
// A reason is a stable token a caller branches on (design 101), which makes it API even
// though it appears in no signature. `surface.txt` catches a changed export; nothing caught a
// renamed reason or a fix that was never written. This turns the throw sites into text, so the
// diff of a generated file is the diff of the vocabulary.
//
// Read from the AST rather than by matching text. A scanner over source misses the spellings
// nobody thought of, which this repo has already paid for once in the import checker.
//
// Three limits, stated because a checker whose gaps are unknown is worse than one whose gaps are
// written down.
//
// 1. Makers are keyed by their bare name across a package, so two functions sharing one name are
//    read as one. The cost is a call to the innocent one skipped as though it were a refusal.
// 2. Only a call written as a plain identifier is read. `codec.codecError(...)` through a
//    namespace import, and `const fail = codecError; fail(...)` through an alias, are both
//    missed, and a refusal thrown that way does NOT reach the index.
// 3. Two rounds of wrapper resolution, so a wrapper of a wrapper of a wrapper is missed.
//
// Limits 2 and 3 can drop a refusal. Nothing in this repo writes either shape today, and the
// gate below fails on the shapes that ARE written, so resolving names properly would mean
// carrying scopes through a checker that exists to read five factories. Revisit if a package
// starts importing `codec` as a namespace.
//
// Two shapes have to be followed rather than read where they stand. A package may wrap
// `codecError` in its own constructor (`jobsError`, `requestError`), and a file may hold a
// helper that takes the remedy from whoever called it. In both, the literal a reader will see
// sits at the call site, so the wrapper is found first and its callers are what get read.

import ts from 'typescript';

import { codecError } from '@aweftjs/codec';

/**
 * One refusal a package can throw: the token, and the remedy offered with it.
 *
 * Named for what it is rather than `Refusal`, which `core` and `schema` already use for the
 * different thing an application's own rule returns.
 */
export interface ThrownRefusal {
	readonly reason: string;
	readonly fix: string;
}

// Where each part of a refusal comes from at a call: a literal written here, or the argument
// at this index, which the callee forwards.
interface Source {
	readonly literal?: string;
	readonly at?: number;
}

interface Maker {
	readonly reason: Source;
	readonly fix: Source;
	/**
	 * This maker re-raises a refusal that came from somewhere else: it takes the reason it was
	 * handed and carries one fixed remedy of its own (design 101's wire exception). Its
	 * reasons cannot be enumerated here, because the far end chose them.
	 */
	readonly reraises?: boolean;
}

/** What the index calls a reason that came off the wire. */
const FROM_ELSEWHERE = '<whatever the far end refused for>';

const BUILT = '<built>';

// A string the reader will actually see. A template literal with substitutions in it is a
// message built at runtime, and its text here would be a lie.
const literal = (node: ts.Expression): string | undefined => {
	if (ts.isStringLiteral(node)) return node.text;
	if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateExpression(node)) return BUILT;
	return undefined;
};

const parametersOf = (node: ts.Node): ts.NodeArray<ts.ParameterDeclaration> | undefined =>
	ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)
		? node.parameters
		: undefined;

// A remedy shared by several sites is written once as a constant, which is good practice and
// invisible to a reader of the call. Resolving them keeps the index the text a reader sees.
const constantsIn = (source: ts.SourceFile): Map<string, string> => {
	const found = new Map<string, string>();
	const walk = (node: ts.Node): void => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
			const text = node.initializer;
			if (ts.isStringLiteral(text) || ts.isNoSubstitutionTemplateLiteral(text)) {
				found.set(node.name.text, text.text);
			}
		}
		ts.forEachChild(node, walk);
	};
	walk(source);
	return found;
};

/** The function a call sits in: what it is called, and what it takes. */
interface Enclosing {
	readonly name: string | undefined;
	readonly parameters: ts.NodeArray<ts.ParameterDeclaration> | undefined;
}

// The name a function is declared under, read on the way DOWN. A program built for the surface
// check parses without parent pointers, so nothing here may walk upward from a node.
const isFunction = (node: ts.Node | undefined): boolean =>
	node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

// Only a declaration that binds a FUNCTION names the scope below it. A plain `const error =
// codecError(...)` inside a factory is a value, and letting it name the scope would attribute
// the factory's own call to it, leaving the factory unregistered and its callers unread.
const declaredName = (node: ts.Node): string | undefined => {
	if (ts.isFunctionDeclaration(node)) return node.name?.text;
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunction(node.initializer)) {
		return node.name.text;
	}
	if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && isFunction(node.initializer)) {
		return node.name.text;
	}
	return undefined;
};

/**
 * Every call expression in a file, with the function it sits inside.
 *
 * Params:
 *   source: the parsed file
 *   visit: run for each call, with the name and parameters of the function around it
 *
 * Example:
 *   eachCall(source, (call, where) => { ... });
 */
export const eachCall = (
	source: ts.SourceFile,
	visit: (call: ts.CallExpression, where: Enclosing) => void,
): void => {
	const walk = (node: ts.Node, where: Enclosing): void => {
		let next = where;

		const named = declaredName(node);
		if (named !== undefined) next = { name: named, parameters: next.parameters };

		const parameters = parametersOf(node);
		if (parameters !== undefined) next = { name: next.name, parameters };

		if (ts.isCallExpression(node)) visit(node, where);
		ts.forEachChild(node, (child) => walk(child, next));
	};
	walk(source, { name: undefined, parameters: undefined });
};

// Where one argument of a call comes from, given the parameters of the function it sits in.
const sourceOf = (
	arg: ts.Expression | undefined,
	parameters: ts.NodeArray<ts.ParameterDeclaration> | undefined,
	constants?: ReadonlyMap<string, string>,
): Source | undefined => {
	if (arg === undefined) return undefined;
	if (ts.isIdentifier(arg)) {
		if (parameters !== undefined) {
			const at = parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === arg.text);
			if (at >= 0) return { at };
		}
		const held = constants?.get(arg.text);
		return held === undefined ? undefined : { literal: held };
	}
	const text = literal(arg);
	return text === undefined ? undefined : { literal: text };
};

/**
 * Every function in these files that makes a refusal, `codecError` itself included.
 *
 * Params:
 *   sources: the parsed files of one package
 *
 * Returns: the name of each maker, and where it takes its reason and fix from. A package's own
 * wrapper is found here so its callers can be read as the refusal sites they are.
 *
 * Example:
 *   const makers = makersIn(sources);
 */
export const makersIn = (sources: readonly ts.SourceFile[]): Map<string, Maker> => {
	const makers = new Map<string, Maker>([
		['codecError', { reason: { at: 0 }, fix: { at: 2 } }],
	]);

	// Two rounds, so a wrapper written above the thing it wraps is still found, and so is a
	// wrapper of a wrapper. Two is enough for every shape in this repo; a third would be
	// speculation.
	for (let round = 0; round < 2; round++) {
		for (const source of sources) {
			const constants = constantsIn(source);
			eachCall(source, (call, where) => {
				if (where.name === undefined || makers.has(where.name)) return;
				if (!ts.isIdentifier(call.expression)) return;

				const called = makers.get(call.expression.text);
				if (called === undefined) return;

				const reason = called.reason.at === undefined
					? called.reason
					: sourceOf(call.arguments[called.reason.at], where.parameters, constants);
				const fix = called.fix.at === undefined
					? called.fix
					: sourceOf(call.arguments[called.fix.at], where.parameters, constants);

				// A maker FORWARDS at least one part of the refusal from its own parameters. A
				// function that merely throws one, with both parts written where they stand, is
				// an ordinary throw site and must be read as one: registering it would make every
				// one of its own callers look like a refusal.
				const forwards = reason?.at !== undefined || fix?.at !== undefined;
				if (reason !== undefined && fix !== undefined && forwards) {
					// A maker handed its reason but holding its own remedy is re-raising something
					// that was refused elsewhere. Its call sites cannot name a literal reason and
					// demanding one would be asking for a fact this end does not have.
					const reraises = reason.at !== undefined && fix.literal !== undefined;
					makers.set(where.name, reraises ? { reason, fix, reraises } : { reason, fix });
				}
			});
		}
	}
	return makers;
};

/**
 * Every refusal thrown in these files.
 *
 * Params:
 *   files: absolute paths to the source files of one package
 *   program: a program those files belong to
 *
 * Returns: one entry per distinct reason and fix, sorted by reason then fix. A reason thrown
 * from several places with several remedies appears once per remedy, because that difference
 * is exactly what a reader needs to see in a diff.
 *
 * Throws: `not-in-program` when a path is not part of the program handed in, `reason-not-literal`
 * when a token is built at runtime, and `fix-missing` or `fix-not-literal` when the remedy is
 * absent or built, which would make the index a description of code rather than of what a
 * reader is told.
 *
 * Example:
 *   const refusals = errorsOf(files, program);
 */
export const errorsOf = (files: readonly string[], program: ts.Program): ThrownRefusal[] => {
	const sources = files.map((path) => {
		const source = program.getSourceFile(path);
		if (source === undefined) {
			throw codecError('not-in-program', path, 'Add the file to the program before reading it.');
		}
		return source;
	});

	const makers = makersIn(sources);
	const found = new Map<string, ThrownRefusal>();

	// A re-raiser carries one fixed remedy and whatever reason it was handed, so its entry is
	// known where it is defined. Recording it here rather than at its call sites also covers the
	// one that is only ever called from outside this package.
	for (const maker of makers.values()) {
		if (maker.reraises === true && maker.fix.literal !== undefined && maker.fix.literal !== '') {
			found.set(FROM_ELSEWHERE + ' ' + maker.fix.literal,
				{ reason: FROM_ELSEWHERE, fix: maker.fix.literal });
		}
	}

	for (const source of sources) {
		const constants = constantsIn(source);
		eachCall(source, (call, where) => {
			if (!ts.isIdentifier(call.expression)) return;
			const maker = makers.get(call.expression.text);
			if (maker === undefined) return;

			// A call inside a maker's own body is that maker being defined, not a refusal being
			// thrown. Its arguments are parameters, and the literals a reader will actually see
			// are at ITS callers, which this same walk reaches separately.
			if (where.name !== undefined && makers.has(where.name)) return;

			const at = source.getLineAndCharacterOfPosition(call.getStart(source)).line + 1;
			const place = source.fileName + ':' + String(at);

			const pick = (from: Source): string | undefined =>
				from.at === undefined ? from.literal : sourceOf(call.arguments[from.at], undefined, constants)?.literal;

			// Already recorded where it was defined, and its call sites cannot name a literal
			// reason: the far end chose it.
			if (maker.reraises === true) return;

			const fix = pick(maker.fix);

			const reason = pick(maker.reason);
			if (reason === undefined || reason === BUILT) {
				throw codecError('reason-not-literal', place,
					'Write the reason as a plain string; a token built at runtime cannot be branched on.');
			}
			if (fix === undefined || fix === '') {
				throw codecError('fix-missing', place,
					'Give the refusal a third argument saying what to do about it.');
			}
			if (fix === BUILT) {
				throw codecError('fix-not-literal', place,
					'Write the fix as a plain string; move anything variable into the detail.');
			}
			found.set(reason + ' ' + fix, { reason, fix });
		});
	}

	return [...found.values()].sort((a, b) =>
		a.reason === b.reason ? (a.fix < b.fix ? -1 : 1) : a.reason < b.reason ? -1 : 1);
};

/**
 * The refusals as the lines that go in `errors.txt`.
 *
 * Params:
 *   refusals: what `errorsOf` returned
 *
 * Returns: one line per refusal, reason then colon then the fix.
 *
 * Example:
 *   const text = errorLines(refusals).join(String.fromCharCode(10));
 */
export const errorLines = (refusals: readonly ThrownRefusal[]): string[] =>
	refusals.map(({ reason, fix }) => reason + ': ' + fix);
