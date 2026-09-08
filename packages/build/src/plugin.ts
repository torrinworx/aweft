// The bundler plugin: the transform, and the icons the transform asks for.
//
// The transform runs before anything else in the pipeline sees the file, because the file it is
// handed has JSX and markup in it and the rest of the pipeline does not read those. Everything it
// decides, it decides by calling `transform`, so a file compiled by a bundler and the same file
// compiled in a browser cannot come out different.
//
// The other two hooks answer the imports the transform writes: `@aweftjs/icons/<set>/<name>` and
// its two neighbours are modules nobody wrote, generated from the set the application installed
// (design 141). `@aweftjs/icons/node` is loaded when one is actually asked for, so a page that
// names no icon loads no generator and this file has no `node:` import to reach a browser.

import { directoryOf, iconRequest } from './icons.ts';
import { type TransformOptions, transform } from './transform.ts';

const HANDLED = /\.(?:jsx?|tsx?)$/;

// A generated module's id. The leading NUL is what tells rollup and vite that nothing on disk
// answers it. The directory to resolve the set in follows as a query, encoded, because vite turns
// the id into a URL for the dev server and encodes only that first NUL: a second one reached
// Firefox raw, which cuts the URL there and asks for a module nothing answers.
const VIRTUAL = '\0aweft-icons:';
const FROM = '?from=';

/** What a bundler asks of a plugin, and all this one answers. */
export interface Plugin {
	readonly name: string;
	readonly enforce: 'pre';
	transform(code: string, id: string): { code: string; map: string } | null;
	/** Claims an icon import the generator answers, and answers null for everything else. */
	resolveId(source: string, importer?: string): Promise<string | null>;
	/** The source of a claimed icon import, and null for every other id. */
	load(id: string): Promise<string | null>;
}

/**
 * The plugin for a bundler that takes rollup's shape, vite among them.
 *
 * Params:
 *   options: `release`, which removes assert calls. The filename comes from the bundler.
 *
 * Returns: the plugin. It handles `.js`, `.jsx`, `.ts` and `.tsx` and answers null for anything
 * else, which leaves the file to the rest of the pipeline. It also answers the icon imports the
 * transform writes, so one plugin is still the whole registration.
 *
 * Throws: out of `load`, whatever `@aweftjs/icons/node` refuses with: `set-not-installed` for a
 * set the application has not installed, naming the install command, and `icon-not-in-set` for a
 * name the set does not have.
 *
 * Example:
 *   export default { plugins: [aweft({ release: true })] };
 */
export const aweft = (options: Omit<TransformOptions, 'filename'> = {}): Plugin => ({
	name: 'aweft',
	enforce: 'pre',
	transform(code, id) {
		const filename = id.split('?')[0]!;
		if (!HANDLED.test(filename)) return null;
		const result = transform(code, { ...options, filename });
		return { code: result.code, map: result.map.toString() };
	},
	async resolveId(source, importer) {
		const request = iconRequest(source);
		// With no importer there is no directory to resolve the set from, so the import is left
		// to ordinary resolution and fails where it was written.
		if (request === null || importer === undefined) return null;
		const from = directoryOf(importer);
		const { moduleFor } = await import('@aweftjs/icons/node');
		// A request the generator does not recognise is not an icon import at all, so it goes back
		// to the bundler unclaimed and resolves the ordinary way. A set or a name it does recognise
		// but cannot find is a refusal, and that one is `load`'s to raise, where the module being
		// built has a name.
		let known = true;
		try {
			known = moduleFor(request, from) !== null;
		} catch {
			// Claimed, so `load` asks again and refuses there.
		}
		if (!known) return null;
		return `${VIRTUAL}${request}${FROM}${encodeURIComponent(from)}`;
	},
	async load(id) {
		if (!id.startsWith(VIRTUAL)) return null;
		const at = id.lastIndexOf(FROM);
		const { moduleFor } = await import('@aweftjs/icons/node');
		return moduleFor(id.slice(VIRTUAL.length, at), decodeURIComponent(id.slice(at + FROM.length)));
	},
});
