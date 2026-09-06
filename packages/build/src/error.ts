// A fault in the source, reported where it is.
//
// The markup pass makes every refusal the runtime parser makes, but at build time, so the fault
// has a position in a file rather than a stack in a browser (design 096).
//
// It is the one refusal in the stack that stays a class, because a caller catches it with
// `instanceof` and the README says so. The reason and the fix are the same three-part shape
// every other package throws, built by `codecError` so the message renders identically
// (design 101).

import { codecError } from '@aweftjs/codec';

/**
 * What `transform` throws when the source says something a compiled template cannot mean.
 *
 * Every fault the runtime markup parser raises is raised here instead where the transform can
 * see it in the source: an unterminated tag, a closing tag with nothing open, a spread written
 * without `=`, a namespaced JSX tag or attribute, an attribute given no value. The build stops
 * rather than the page.
 *
 * Params:
 *   message: what is wrong, in the words the runtime parser uses
 *   at: the offset in the source it is at
 *
 * Returns: the error. `at` is an offset into the source `transform` was given, not a line and
 * column, so a caller that wants a position works it out from the source it passed in.
 *
 * Example:
 *   try { transform(source, { filename: 'page.ts' }); } catch (error) {
 *     if (error instanceof TransformError) report(source.slice(0, error.at).split('\n').length);
 *   }
 */
export class TransformError extends Error {
	/** The offset in the source the fault is at. */
	readonly at: number;
	/** The stable token naming the rule the source broke. Branch on this, never on the message. */
	readonly reason: string;
	/** One sentence saying what to write instead. */
	readonly fix: string;

	constructor(message: string, at: number, reason: string, fix: string) {
		super(message);
		this.name = 'TransformError';
		this.at = at;
		this.reason = reason;
		this.fix = fix;
	}
}

/**
 * Refuse a fault in the source at the offset it is at.
 *
 * Params:
 *   reason: the stable token for the rule that was broken
 *   detail: what was actually written, for a person reading the message
 *   fix: one sentence saying what to write instead, in the imperative
 *   at: the offset in the file the fault is at
 */
export const transformError = (reason: string, detail: string, fix: string, at: number): TransformError => {
	const refusal = codecError(reason, detail, fix);
	return new TransformError(refusal.message, at, reason, fix);
};
