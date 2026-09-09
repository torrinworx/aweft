// Modules from a directory. On its own subpath, `@aweftjs/modules/node`, because it reads the
// filesystem and the main entry has to load in a browser (design 062).

import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Candidate, ModuleExports, Source } from './contract.ts';
import { nameOfPath } from './names.ts';

const EXTENSIONS = ['.js', '.mjs', '.ts'];

const isModuleFile = (file: string): boolean =>
	!file.endsWith('.d.ts') && EXTENSIONS.some((ending) => file.endsWith(ending));

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
 * `thing.ts`, are refused by the loader as `duplicate`.
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
			else if (entry.isFile() && isModuleFile(entry.name)) out.push(full);
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
