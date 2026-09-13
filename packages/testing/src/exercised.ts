// What a package's own suite must name: every value it exports and every reason it refuses with.
//
// `surface.txt` is what a package hands out and `errors.txt` is every reason it can throw. Both
// are generated from the source, so both are true; what neither can say is whether a caller
// could reach the export or the refusal, and branch coverage cannot say it either, because a
// guard runs on the way to the value it protects whether or not any test asked for the refusal.
// The scan here is the floor the policy can check: the name appears in a test that is not the
// surface list and not a white-box file (design 285).

/** One test file of the package. */
export interface TestSource {
	/** The path, as it will be reported. */
	readonly path: string;
	readonly text: string;
}

const NEWLINE = String.fromCharCode(10);

/** The value exports a surface file lists, main entry and subpaths alike. */
const surfaceValues = (surface: string): string[] => {
	const names = new Set<string>();
	for (const line of surface.split(NEWLINE)) {
		const found = /^(?:\S+ )?value ([A-Za-z_$][A-Za-z0-9_$]*):/.exec(line);
		if (found !== null) names.add(found[1]!);
	}
	return [...names].sort();
};

/** The reasons an errors file lists, once each. */
const errorReasons = (errors: string): string[] => {
	const reasons = new Set<string>();
	for (const line of errors.split(NEWLINE)) {
		const found = /^([a-z][a-z0-9-]*):/.exec(line);
		if (found !== null) reasons.add(found[1]!);
	}
	return [...reasons].sort();
};

// A name in a comment is a mention, not a use. Block comments go first so a `//` inside one does
// not eat the rest of the line, then line comments, which start at the line's start or after a
// space so the `//` of a URL in a string is left alone. Strings are kept: a reason is only ever
// reached as a string, and a test that quotes it is what the check asks for.
const withoutComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/gm, '$1');

/** Whether a test file counts: not the surface list, not a white-box file. */
const countsAsExercise = (path: string): boolean => {
	const file = path.split('/').at(-1) ?? path;
	return file.endsWith('.test.ts') && file !== 'surface.test.ts' && !file.startsWith('internal.');
};

/**
 * Every export and every reason the suite does not name.
 *
 * Params:
 *   name: the package, for the report
 *   surface: the text of its `surface.txt`
 *   errors: the text of its `errors.txt`, empty when it refuses for no reason
 *   tests: its test files; the ones that count are chosen here, so hand in the directory
 *
 * Returns: one line per miss, naming the package and the export or reason, empty when the suite
 * names them all. An export counts as named when it appears as a whole word outside a comment;
 * a reason when it appears quoted, or as the whole of a regular expression, since a refusal's
 * message opens with its reason and `assert.throws(fn, /reason/)` is the shortest way to ask.
 *
 * Example:
 *   checkExercised('store', surface, errors, tests);
 *   // ['store: projectionOf is exported and no test names it', "store: 'not-open' is a refusal and no test quotes it"]
 */
export const checkExercised = (
	name: string,
	surface: string,
	errors: string,
	tests: readonly TestSource[],
): string[] => {
	const corpus = tests
		.filter((test) => countsAsExercise(test.path))
		.map((test) => withoutComments(test.text))
		.join(NEWLINE);

	const misses: string[] = [];
	for (const value of surfaceValues(surface)) {
		const escaped = value.replace(/\$/g, '\\$');
		if (!new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`).test(corpus)) {
			misses.push(`${name}: ${value} is exported and no test names it`);
		}
	}
	for (const reason of errorReasons(errors)) {
		if (!new RegExp(`(?<=["'\`/])${reason}(?=["'\`/])`).test(corpus)) {
			misses.push(`${name}: '${reason}' is a refusal and no test quotes it`);
		}
	}
	return misses;
};
