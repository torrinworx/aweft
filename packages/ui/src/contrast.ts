// The development-time contrast warning (design 120).
//
// The gate check catches a component that wrote a colour instead of using a role. It cannot catch
// a theme whose named values happen to be unreadable together, because both sides are named. This
// measures the pair a compiled chain actually resolves and says so, at the moment the pair is
// first used.
//
// Nothing here runs in a release build: the one call site is the whole of an `assert` statement,
// which the release transform removes (design 097).

import { type Colour, luminance, readColour } from './color.ts';
import { foregroundFor, foregroundRoles } from './roles.ts';
import { type Lookup, type Part, parseValue, resolve } from './values.ts';

/** The ratio WCAG 2 asks of text. Large text and a control edge are 3, which this does not read. */
const TEXT_TARGET = 4.5;

const BACKGROUNDS = ['background', 'backgroundColor'];

/** One resolved declaration, and where its value came from. */
interface Resolved {
	readonly text: string;
	readonly parts: readonly Part[];
}

// A value is theme-derived when something in it came through a `$name` or a `$fn()`. A pair
// written as two literals is the page's own business, and measuring it would warn about a colour
// somebody chose on purpose.
const fromTheme = (parts: readonly Part[]): boolean => parts.some((part) => part.kind !== 'text');

// The one variable a value is, when that is all it is. `$surface` answers `surface`; `1px solid
// $border` and `$fn($a)` answer nothing, because neither names a role the pair convention can
// pair with.
const soleVariable = (parts: readonly Part[]): string | null =>
	(parts.length === 1 && parts[0]!.kind === 'var' ? parts[0]!.name : null);

// What a translucent colour looks like is the colour behind it mixed in, so measuring the opaque
// channels of `$alpha($foreground, 0.15)` reads a pale grey as if it were the near-black it was
// made from. Mix it here, per channel, before either luminance is taken.
const over = (colour: Colour, backdrop: Colour): Colour => ({
	r: colour.r * colour.a + backdrop.r * (1 - colour.a),
	g: colour.g * colour.a + backdrop.g * (1 - colour.a),
	b: colour.b * colour.a + backdrop.b * (1 - colour.a),
	a: 1,
});

/**
 * The WCAG 2 contrast ratio between a colour and the background behind it.
 *
 * Params:
 *   a: the colour in front, as the value language resolved it. Carrying alpha, it is composited
 *      over `b` first
 *   b: the background behind it, which has to be opaque
 *
 * Returns: the ratio, 1 to 21. Null when either side is not a colour, and null when the
 * background carries alpha: what is behind the background is the page, which this cannot see, and
 * a guess at it would be a ratio nobody can act on.
 *
 * Example:
 *   contrastRatio('#ffffff', '#1c2027');   // 15.94
 */
export const contrastRatio = (a: string, b: string): number | null => {
	const first = readColour(a);
	const second = readColour(b);
	if (first === null || second === null) return null;
	if (second.a < 1) return null;
	const front = first.a < 1 ? over(first, second) : first;
	const high = Math.max(luminance(front), luminance(second));
	const low = Math.min(luminance(front), luminance(second));
	return (high + 0.05) / (low + 0.05);
};

// The foreground to suggest. A background the pair table names has one answer. Anything else, a
// scale step or a name this package does not ship, gets the foreground roles that actually reach
// the target against it, measured here. Spelling a role name out of a pattern is what used to
// suggest `$backgroundForeground`, which nothing defines.
const advice = (role: string | null, paper: string, lookup: Lookup): string => {
	if (role !== null) {
		const paired = foregroundFor[role];
		if (paired !== undefined) return `Use $${paired}, the foreground paired with $${role}.`;
	}

	const fit = foregroundRoles
		.filter((name) => {
			const held = lookup.variable(name);
			return held !== null && (contrastRatio(held, paper) ?? 0) >= TEXT_TARGET;
		})
		.map((name) => `$${name}`);

	if (fit.length === 0) return `No foreground role this theme defines reaches ${TEXT_TARGET}:1 against that background.`;
	return fit.length === 1
		? `Use ${fit[0]!}, which reaches ${TEXT_TARGET}:1 against that background.`
		: `Use one of ${fit.join(', ')}, which reach ${TEXT_TARGET}:1 against that background.`;
};

const declaration = (entries: readonly Readonly<Record<string, unknown>>[], names: readonly string[], lookup: Lookup): Resolved | null => {
	let found: Resolved | null = null;
	// Later in the chain wins, which is the order the rules are emitted in, so the last one the
	// walk sees is the one the element gets.
	for (const entry of entries) {
		for (const name of names) {
			const value = entry[name];
			if (value === null || value === undefined) continue;
			const parts = parseValue(String(value));
			found = { text: resolve(parts, lookup), parts };
		}
	}
	return found;
};

/**
 * What is wrong with the pair a chain resolves, or null when nothing is.
 *
 * Params:
 *   entries: the chain's entries, lowest precedence first
 *   lookup: what a `$name` in that chain holds
 *   label: the chain's name, for the message
 *
 * Returns: the complaint, naming the measured ratio, the target and the role to use, or null.
 * Null when either side is missing, when either side was written as a literal, when either side
 * is not a colour, when the background carries alpha, or when the pair reaches the target. A
 * translucent colour is measured over the background behind it; a translucent background is
 * skipped, because what is behind that is the page and this cannot see it.
 *
 * Example:
 *   contrastComplaint([{ background: '$muted', color: '$border' }], lookup, 'card');
 */
export const contrastComplaint = (
	entries: readonly Readonly<Record<string, unknown>>[],
	lookup: Lookup,
	label: string,
): string | null => {
	const ink = declaration(entries, ['color'], lookup);
	const paper = declaration(entries, BACKGROUNDS, lookup);
	if (ink === null || paper === null) return null;
	if (!fromTheme(ink.parts) || !fromTheme(paper.parts)) return null;

	const ratio = contrastRatio(ink.text, paper.text);
	if (ratio === null || ratio >= TEXT_TARGET) return null;

	return `ui: theme chain "${label}" resolves color ${ink.text} on background ${paper.text} at `
		+ `${(Math.round(ratio * 100) / 100).toFixed(2)}:1, below the ${TEXT_TARGET}:1 WCAG 2 AA `
		+ `target for text. ${advice(soleVariable(paper.parts), paper.text, lookup)}`;
};

/**
 * Warn about the pair a chain resolves, in development only.
 *
 * Params: as `contrastComplaint`.
 *
 * Returns: true, always. The call is written as the condition of an `assert` so the whole
 * statement leaves a release build; it never refuses a theme.
 *
 * Example:
 *   assert(warnOnContrast(entries, lookup, 'card'), 'the contrast warning never refuses a theme');
 */
export const warnOnContrast = (
	entries: readonly Readonly<Record<string, unknown>>[],
	lookup: Lookup,
	label: string,
): boolean => {
	const complaint = contrastComplaint(entries, lookup, label);
	if (complaint !== null) console.warn(complaint);
	return true;
};
