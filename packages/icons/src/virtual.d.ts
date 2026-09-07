// The types for the modules nobody wrote (design 141).
//
// TypeScript allows exactly one `*` in an ambient module pattern (TS5061 for two), so the
// standard selection is declared first and the general one second: two patterns whose prefixes
// are the same length are decided by the order they are written in, and the specific one has to
// win. A real subpath on the exports map, `@aweftjs/icons` and `@aweftjs/icons/node`, resolves
// normally and neither pattern shadows it.
//
// `@aweftjs/icons/<set>` and `@aweftjs/icons/<set>/<name>` cannot be told apart by one pattern,
// so the general one is the union of what the two give. Both `Icon`'s `name` and `Icons`' value
// take `unknown`, so the union costs nothing where these modules are actually used.
//
// These types reach a file that has `@aweftjs/icons` itself somewhere in its program, because
// `src/index.ts` refers to this file. A page that imports only the virtual modules writes
// `/// <reference path="node_modules/@aweftjs/icons/src/virtual.d.ts" />` once.

declare module '@aweftjs/icons/*/+standard' {
	import type { IconPack } from '@aweftjs/ui';
	/** The standard names this set publishes, as a pack. */
	const pack: IconPack;
	export default pack;
}

declare module '@aweftjs/icons/*' {
	import type { IconData, IconPack } from '@aweftjs/ui';
	/** One icon where the path names one, and the whole set where it names a set. */
	const contents: IconData | IconPack;
	export default contents;
}
