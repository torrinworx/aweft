// Module text to module exports, with no dependency (design 062).

import type { Compile, ModuleExports } from './contract.ts';

/**
 * The default compile: import the text as an ES module through a data URL.
 *
 * Params:
 *   source: the text of a module, exporting what a module exports
 *
 * Returns: its exports. The source runs with this process's own privileges, the same as any
 * `import()`; nothing here isolates anything (design 065).
 *
 * Every distinct source stays in the runtime's module cache for the life of the process:
 * `bench/compile.ts` measured about 5.6 KB of heap per distinct source on Node 25 (10,000
 * sources, 53 MB), and the same text imported twice is the same module. An application that
 * compiles many versions of many modules passes its own compile to `fromDocument` instead.
 *
 * Example:
 *   const { deps, default: factory } = await compile(entry.source);
 */
export const compile: Compile = async (source: string): Promise<ModuleExports> => {
	const url = `data:text/javascript,${encodeURIComponent(source)}`;
	// The URL is built at run time on purpose; the hint keeps a bundler's import analysis from
	// warning about it on every page that reaches this file.
	return await import(/* @vite-ignore */ url) as ModuleExports;
};
