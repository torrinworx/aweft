// Modules from a directory. On its own subpath, `@aweftjs/modules/node`, because it reads the
// filesystem and the main entry has to load in a browser (design 062).

import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Candidate, ModuleExports, Source } from './contract.ts';
import { nameOfPath } from './names.ts';

const EXTENSIONS = ['.js', '.mjs', '.ts'];

// Script by its name, in any case. One of these this source does not import is left out and said,
// once a process, because left out quietly a module is simply absent. Said rather than refused,
// because a module beside it may import it, and that directory works (design 307).
const SCRIPT = /\.[cm]?[jt]sx?$/i;
const said = new Set<string>();

const isModuleFile = (file: string): boolean =>
	!file.endsWith('.d.ts') && EXTENSIONS.some((ending) => file.endsWith(ending));

const sayLeftOut = (file: string, shown: string): void => {
	if (said.has(file)) return;
	said.add(file);
	console.warn(`modules: fromDirectory imports .js, .mjs and .ts files and leaves ${shown} out, so it is no module. `
		+ 'If it is one, rename it .ts, or list it with fromBundle in a process run under @aweftjs/build/loader. '
		+ 'If a module imports it, it can stay, or move out of the directory to quiet this.');
};

/**
 * A source over a directory tree.
 *
 * Params:
 *   path: the directory. A relative path is resolved by `node:fs` against the process's working
 *         directory, not against the file that called this, so a program run from anywhere else
 *         finds nothing; pass an absolute path built from `import.meta.url`, as the example does
 *
 * Returns: a source over every `.js`, `.mjs` and `.ts` file under the directory (never a
 * `.d.ts`), named by the file's path relative to the directory with `/` separators and no
 * extension, so `<path>/auth/Session.ts` is `auth/Session`. Listing walks the tree; evaluating
 * a candidate is `import()` of its file. Two files that would share one name, `thing.js` beside
 * `thing.ts`, are refused by the loader as `duplicate`. Any other file is left out: one that is
 * not code (a `.json`, a `.md`) quietly, and one that is but is not imported here (`.tsx`,
 * `.jsx`, `.mts`, `.cts`, `.cjs`, or an extension in capitals) with one warning per file and
 * process, since a module written that way would otherwise be absent with nothing saying why.
 *
 * Throws: a `ModulesError` with reason `invalid-name`, out of the `load` that lists it, for a
 * file whose name is nothing but an extension.
 *
 * Example:
 *   const here = fileURLToPath(new URL('.', import.meta.url));
 *   const loader = createLoader({ sources: [fromDirectory(join(here, 'modules'))] });
 */
export const fromDirectory = (path: string): Source => {
	const walk = async (dir: string): Promise<string[]> => {
		const out: string[] = [];
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) out.push(...await walk(full));
			else if (!entry.isFile()) continue;
			else if (isModuleFile(entry.name)) out.push(full);
			else if (SCRIPT.test(entry.name) && !/\.d\.[cm]?ts$/i.test(entry.name)) {
				sayLeftOut(full, relative(path, full).split(sep).join('/'));
			}
		}
		return out;
	};

	return {
		candidates: async () => (await walk(path)).sort().map((file): Candidate => ({
			name: nameOfPath(relative(path, file).split(sep).join('/')),
			exports: async () => await import(pathToFileURL(file).href) as ModuleExports,
		})),
	};
};
