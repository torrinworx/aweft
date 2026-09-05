// The bundler plugin: the transform, and nothing else.
//
// It runs before anything else in the pipeline sees the file, because the file it is handed has
// JSX and markup in it and the rest of the pipeline does not read those. Everything it decides,
// it decides by calling `transform`, so a file compiled by a bundler and the same file compiled
// in a browser cannot come out different.

import { type TransformOptions, transform } from './transform.ts';

const HANDLED = /\.(?:jsx?|tsx?)$/;

/** What a bundler asks of a plugin, and all this one answers. */
export interface Plugin {
	readonly name: string;
	readonly enforce: 'pre';
	transform(code: string, id: string): { code: string; map: string } | null;
}

/**
 * The plugin for a bundler that takes rollup's shape, vite among them.
 *
 * Params:
 *   options: `release`, which removes assert calls. The filename comes from the bundler.
 *
 * Returns: the plugin. It handles `.js`, `.jsx`, `.ts` and `.tsx` and answers null for anything
 * else, which leaves the file to the rest of the pipeline.
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
});
