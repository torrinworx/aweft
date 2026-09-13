// The operator sweep: where a source file can be flipped, and what each flip looks like.
//
// The test policy's own rule for whether a guarantee is checked is to delete the code that
// implements it and watch for red. This is that rule one operator at a time (design 287): a
// comparison, a logical operator or a boolean a function returns, each turned into its nearest
// wrong neighbour. The finder is deliberately dumb so that a survivor line explains itself:
// an operator needs a space on both sides, a line with a comment is left alone, and a site
// inside a string is skipped by counting the quotes before it.

/** One place a source file can be flipped. */
export interface Site {
	/** One-based. */
	readonly line: number;
	/** Zero-based offset of the operator on its line. */
	readonly column: number;
	readonly from: string;
	readonly to: string;
}

/** Each operator and the neighbour it flips to. Spaces are part of the match on purpose. */
const FLIPS: ReadonlyArray<readonly [string, string]> = [
	[' === ', ' !== '],
	[' !== ', ' === '],
	[' <= ', ' < '],
	[' >= ', ' > '],
	[' < ', ' <= '],
	[' > ', ' >= '],
	[' && ', ' || '],
	[' || ', ' && '],
	['return true', 'return false'],
	['return false', 'return true'],
];

const NEWLINE = String.fromCharCode(10);

// A `//` counts as a comment where one can start: at the line's start or after a space. The
// `//` inside a URL in a string follows a colon and is not one.
const isComment = (line: string): boolean => {
	const trimmed = line.trimStart();
	return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || /(^|\s)\/\//.test(line);
};

/** Whether an offset sits inside a string on its line: an odd count of any one quote before it. */
const inString = (line: string, column: number): boolean => {
	const before = line.slice(0, column);
	for (const quote of ["'", '"', '`']) {
		if ((before.split(quote).length - 1) % 2 === 1) return true;
	}
	return false;
};

/**
 * Every site in a source text, in file order.
 *
 * Params:
 *   text: the source
 *
 * Returns: the sites, one per operator occurrence per line, in line then column order. A line
 * that is or carries a comment has none, and an occurrence inside a string is left out. The
 * operators are matched with their spaces, so ` <= ` is one site and never also a ` < ` one.
 *
 * Example:
 *   sweepSites('if (a < b && c) return true;');
 *   // [{ line: 1, column: 5, from: ' < ', to: ' <= ' }, { line: 1, column: 9, from: ' && ', to: ' || ' }, ...]
 */
export const sweepSites = (text: string): Site[] => {
	const sites: Site[] = [];
	const lines = text.split(NEWLINE);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		if (isComment(line)) continue;
		const found: Site[] = [];
		for (const [from, to] of FLIPS) {
			let at = line.indexOf(from);
			while (at !== -1) {
				if (!inString(line, at)) found.push({ line: index + 1, column: at, from, to });
				at = line.indexOf(from, at + 1);
			}
		}
		found.sort((a, b) => a.column - b.column);
		sites.push(...found);
	}
	return sites;
};

/**
 * The source with one site flipped.
 *
 * Params:
 *   text: the source the site was found in
 *   site: one of its sites
 *
 * Returns: the same text with that one operator replaced, every other byte unchanged.
 *
 * Example:
 *   flipSite('if (a < b) go();', { line: 1, column: 5, from: ' < ', to: ' <= ' });
 *   // 'if (a <= b) go();'
 */
export const flipSite = (text: string, site: Site): string => {
	const lines = text.split(NEWLINE);
	const line = lines[site.line - 1]!;
	if (line.slice(site.column, site.column + site.from.length) !== site.from) {
		throw new Error(`no ${JSON.stringify(site.from)} at ${String(site.line)}:${String(site.column)}`);
	}
	lines[site.line - 1] = line.slice(0, site.column) + site.to + line.slice(site.column + site.from.length);
	return lines.join(NEWLINE);
};
