// A fault in the source, reported where it is.
//
// The markup pass makes every refusal the runtime parser makes, but at build time, so the fault
// has a position in a file rather than a stack in a browser (design 096).

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

	constructor(message: string, at: number) {
		super(message);
		this.name = 'TransformError';
		this.at = at;
	}
}
