// The vocabulary that describes how the stack was built, kept out of the tree that describes
// what the stack is.
//
// A sentence that says who decided something, when, or through which review is about the work and
// not about the code. It reads as noise to someone using the stack and it goes stale the day the
// process changes. The rule is a list of words, because a list is checkable and a sentiment is
// not; each entry names the word and what to write instead.
//
// What this reads: every line of every file it is handed, as text. It does not know a comment
// from a string, so a word the code needs (a `session` in auth, a `batch` in a delivery loop) is
// matched only in the spelling the process used and not in the bare word. The list errs toward
// missing a sentence rather than refusing a legitimate one; a reader catches what a word list
// cannot.

/** One file to read. */
export interface WordSource {
	/** The path, as it will be reported. */
	readonly path: string;
	readonly text: string;
}

/** One line carrying a word from the list. */
export interface WordViolation {
	/** The file, as it was handed in. */
	readonly path: string;
	/** One-based. */
	readonly line: number;
	/** The entry that matched, by its name in the list. */
	readonly word: string;
	/** What to write instead. */
	readonly fix: string;
	/** The line, trimmed. */
	readonly text: string;
}

interface Rule {
	readonly word: string;
	readonly pattern: RegExp;
	readonly fix: string;
}

const RULES: readonly Rule[] = [
	{ word: 'a calls file id', pattern: /\bCALLS\b/, fix: 'state the rule the call settled' },
	{ word: 'a process file', pattern: /\b(?:CALLS|OPEN|PARKED|validation)\.md\b/, fix: 'the file is gone; state what it said or drop the pointer' },
	{ word: 'a record id', pattern: /\brecords? \d{3}\b/i, fix: 'cite `design NNN` in `docs/design/`' },
	{ word: 'a decision id', pattern: /\bdecisions? \d{3}\b/i, fix: 'cite `design NNN` in `docs/design/`' },
	{ word: 'the old records directory', pattern: /docs\/decisions/, fix: '`docs/design/`' },
	{ word: 'a decided-by header', pattern: /^Decided by:/m, fix: 'drop the line' },
	{ word: 'a concept header', pattern: /^Concept:/m, fix: 'drop the line' },
	{ word: 'a log id', pattern: /\blog \d{3}\b/i, fix: 'state what the log recorded, or drop the pointer' },
	{ word: 'the logs application', pattern: /Logs app|session log/i, fix: 'the repo cites nothing outside itself' },
	{ word: 'a mutant', pattern: /\bmutants?\b/i, fix: 'name the test that pins the behaviour' },
	{ word: 'a review step', pattern: /\bcheck-in\b|\bdocs-only\b|\bfresh-context\b|\bsigned off\b|\bsign-off\b|\busability run\b/i, fix: 'state the finding, not the review that found it' },
	{ word: 'a worktree', pattern: /\bworktrees?\b/i, fix: 'drop it' },
	{ word: 'a work order', pattern: /\bwork orders?\b/i, fix: 'state the requirement' },
	{ word: 'a build batch', pattern: /\bbatch (?:one|two|three|four)\b|\bthis batch\b/i, fix: 'drop it' },
	{ word: 'a session', pattern: /\bthis session\b|\bthe session's\b|\bsession, log\b|\bsession that (?:built|wrote|decided)\b/i, fix: 'state what was done, not who did it' },
	{ word: 'a date', pattern: /\b2026-\d\d(?:-\d\d)?\b/, fix: 'the changelog carries dates; prose does not' },
];

/**
 * Reads every line of every source against the list and reports each line that carries a word.
 *
 * Params:
 *   sources: the files, each with the path it will be reported under
 *
 * Returns: one violation per matching line and rule, in file order then line order. A line
 * carrying two words from the list is reported twice. An empty array means the text is clean.
 *
 * Example:
 *   checkWords([{ path: 'a.md', text: 'Decided by: the maintainer.' }]);
 *   // [{ path: 'a.md', line: 1, word: 'a decided-by header', fix: 'drop the line', text: '...' }]
 */
export const checkWords = (sources: readonly WordSource[]): WordViolation[] => {
	const found: WordViolation[] = [];
	for (const source of sources) {
		const lines = source.text.split('\n');
		for (let index = 0; index < lines.length; index++) {
			const text = lines[index]!;
			for (const rule of RULES) {
				// A line-anchored rule is written against the whole file; on one line, the start
				// of the string is the start of the line.
				if (rule.pattern.test(text)) {
					found.push({ path: source.path, line: index + 1, word: rule.word, fix: rule.fix, text: text.trim() });
				}
			}
		}
	}
	return found;
};

/** The names in the list, so a report can say what is checked without repeating the patterns. */
export const wordRules = (): readonly { readonly word: string; readonly fix: string }[] =>
	RULES.map(({ word, fix }) => ({ word, fix }));
