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

/** Where the text catalogs live under the bundler's root: the source one this writes, and one per language beside it. */
const TEXT_DIR = 'text';
const SOURCE_CATALOG = 'source.json';

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
	/**
	 * Tells the bundler to leave JSX to this plugin. Its own transform and its dependency scan
	 * read a `.tsx` file too, and without this they read the JSX as another library's and go
	 * looking for a runtime that is not installed.
	 */
	config(): { oxc: { jsx: 'preserve' } };
	/** Learns the root the text catalogs are written under. A bundler that has no such hook writes them under the working directory. */
	configResolved(config: { root?: string }): void;
	transform(code: string, id: string): { code: string; map: string } | null;
	/** With `text` on, writes `text/source.json` and says what each language's catalog lacks (design 277). */
	closeBundle(): Promise<void>;
	/** Claims an icon import the generator answers, and answers null for everything else. */
	resolveId(source: string, importer?: string): Promise<string | null>;
	/** The source of a claimed icon import, and null for every other id. */
	load(id: string): Promise<string | null>;
}

/** A path as the catalog names it: relative to the root, with forward slashes. */
const relativeTo = (root: string, file: string): string => {
	const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
	const path = file.replace(/\\/g, '/');
	return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
};

// A file under `node_modules` is a package's compiled output, which a server render reads as it
// is; wrapped in the bundle alone, the two sides would render different trees. A package's own
// strings are `text()` calls in its source, and its `text.json` names them (design 278).
const INSTALLED = /[\\/]node_modules[\\/]/;

/** The catalogs the installed stack packages ship, read from the nearest `node_modules` above the root. */
const shippedCatalogs = async (root: string): Promise<Map<string, string>> => {
	const fs = await import('node:fs/promises');
	const path = await import('node:path');
	const found = new Map<string, string>();
	for (let dir = root; ; dir = path.dirname(dir)) {
		const scope = path.join(dir, 'node_modules', '@aweftjs');
		let names: string[] = [];
		try {
			names = await fs.readdir(scope);
		} catch {
			if (path.dirname(dir) === dir) break;
			continue;
		}
		for (const name of names.sort()) {
			let shipped: unknown;
			try {
				shipped = JSON.parse(await fs.readFile(path.join(scope, name, 'text.json'), 'utf8'));
			} catch {
				continue;
			}
			if (shipped === null || typeof shipped !== 'object' || Array.isArray(shipped)) continue;
			for (const key of Object.keys(shipped as Record<string, unknown>)) {
				if (!found.has(key)) found.set(key, `@aweftjs/${name}/text.json`);
			}
		}
		break;
	}
	return found;
};

/**
 * Write the source catalog and read the language ones back, through `node:fs`, which is loaded
 * here and not at the top so this file still reaches a browser that only wants `transform`.
 */
const writeCatalogs = async (root: string, own: ReadonlyMap<string, Set<string>>): Promise<void> => {
	const fs = await import('node:fs/promises');
	const dir = `${root.replace(/\/+$/, '')}/${TEXT_DIR}`;
	await fs.mkdir(dir, { recursive: true });
	// The application's own keys, then the ones the installed stack packages show, so one catalog
	// covers the sign-in form and the dialog's close button beside the page's own words.
	const found = new Map<string, Set<string>>(own);
	for (const [key, from] of await shippedCatalogs(root)) {
		let files = found.get(key);
		if (files === undefined) {
			files = new Set();
			found.set(key, files);
		}
		files.add(from);
	}
	const keys = [...found.keys()].sort();
	const source: Record<string, string[]> = {};
	for (const key of keys) source[key] = [...found.get(key)!].sort();
	await fs.writeFile(`${dir}/${SOURCE_CATALOG}`, `${JSON.stringify(source, null, '\t')}\n`);

	for (const name of (await fs.readdir(dir)).sort()) {
		if (!name.endsWith('.json') || name === SOURCE_CATALOG) continue;
		let catalog: Record<string, unknown>;
		try {
			const parsed: unknown = JSON.parse(await fs.readFile(`${dir}/${name}`, 'utf8'));
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a catalog is an object from key to message');
			catalog = parsed as Record<string, unknown>;
		} catch (fault) {
			console.warn(`aweft text: ${TEXT_DIR}/${name} could not be read: ${fault instanceof Error ? fault.message : String(fault)}`);
			continue;
		}
		const missing = keys.filter((key) => !Object.hasOwn(catalog, key));
		const unused = Object.keys(catalog).filter((key) => !found.has(key)).sort();
		const said: string[] = [];
		if (missing.length > 0) said.push(`lacks ${missing.length}: ${missing.map((key) => JSON.stringify(key)).join(', ')}`);
		if (unused.length > 0) said.push(`holds ${unused.length} nothing uses: ${unused.map((key) => JSON.stringify(key)).join(', ')}`);
		if (said.length > 0) console.warn(`aweft text: ${TEXT_DIR}/${name} ${said.join('; ')}`);
	}
};

/**
 * The plugin for a bundler that takes rollup's shape, vite among them.
 *
 * Params:
 *   options: `release`, which removes assert calls; `defaultH`, the package a file with no `h`
 *            gets one from; `text`, which finds the text the page shows and writes
 *            `text/source.json` under the bundler's root when the bundle closes. The filename
 *            comes from the bundler.
 *
 * Returns: the plugin. It handles `.js`, `.jsx`, `.ts` and `.tsx` and answers null for anything
 * else, which leaves the file to the rest of the pipeline. It also answers the icon imports the
 * transform writes, and tells the bundler to leave JSX to it, so one plugin is still the whole
 * registration. With `text` on it finds the text in the application's own files and never in one
 * under `node_modules`, folds the keys every installed `@aweftjs` package ships in its `text.json`
 * into the source catalog, and warns, when the bundle closes, about the keys each `text/<tag>.json`
 * beside it lacks and the entries it holds that no file uses; it never fails a build for either.
 *
 * Throws: out of `load`, whatever `@aweftjs/icons/node` refuses with: `set-not-installed` for a
 * set the application has not installed, naming the install command, and `icon-not-in-set` for a
 * name the set does not have.
 *
 * Example:
 *   export default { plugins: [aweft({ release: true, text: true })] };
 */
export const aweft = (options: Omit<TransformOptions, 'filename'> = {}): Plugin => {
	let root = process.cwd();
	// Key to the files it was found in, over every file the bundle read.
	const found = new Map<string, Set<string>>();
	return {
		name: 'aweft',
		enforce: 'pre',
		config: () => ({ oxc: { jsx: 'preserve' } }),
		configResolved(config) {
			if (typeof config.root === 'string' && config.root !== '') root = config.root;
		},
		transform(code, id) {
			const filename = id.split('?')[0]!;
			if (!HANDLED.test(filename)) return null;
			const finding = options.text === true && !INSTALLED.test(filename);
			const result = transform(code, { ...options, filename, ...(finding ? {} : { text: false }) });
			if (finding) {
				const file = relativeTo(root, filename);
				for (const key of result.text) {
					let files = found.get(key);
					if (files === undefined) {
						files = new Set();
						found.set(key, files);
					}
					files.add(file);
				}
			}
			return { code: result.code, map: result.map.toString() };
		},
		async closeBundle() {
			if (options.text !== true) return;
			await writeCatalogs(root, found);
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
	};
};
