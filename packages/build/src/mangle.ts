// The release mangle configuration for trailing-underscore properties (design 091).
//
// Two underscore meanings live in this stack and must never be conflated. A leading `_foo` is a
// behavioral rule: the property is runtime-private from wildcard observers, and renaming it
// changes what a watcher sees. A trailing `foo_` is a build rule: the property is internal
// surface a minifier may rename. Only the second is matched here.

/** Ends in exactly one underscore and does not begin with one. */
const PATTERN = /^[^_](?:.*[^_])?_$/;

export interface Mangle {
	/** What a manglable property name looks like. */
	readonly pattern: RegExp;
	/** The same rule shaped for terser's `mangle.properties`. */
	readonly terser: { readonly mangle: { readonly properties: { readonly regex: RegExp } } };
	/** The same rule shaped for esbuild's `mangleProps`. */
	readonly esbuild: { readonly mangleProps: RegExp };
}

/**
 * How a release build renames this stack's internal properties.
 *
 * A property whose name ends in exactly one underscore is internal surface and may be renamed.
 * A property whose name begins with an underscore is runtime-private and must keep its name,
 * because a wildcard observer decides what it delivers by looking at the name.
 *
 * Example:
 *   import { mangle } from '@aweftjs/build';
 *   await minify(code, mangle.terser);
 */
export const mangle: Mangle = {
	pattern: PATTERN,
	terser: { mangle: { properties: { regex: PATTERN } } },
	esbuild: { mangleProps: PATTERN },
};
