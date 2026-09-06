// The Node hook that lets this repo run its own `.tsx`.
//
// Node strips types and refuses JSX, so a `.tsx` file cannot be imported as it stands. This
// reads the file, runs the same `transform` a bundler runs, and hands the result back as
// TypeScript, which Node then strips as it does every other file here (design 110).
//
// Registered with `--import @aweftjs/build/loader`. Nothing imports it as a module.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

import { transform } from './transform.ts';

interface LoadResult {
	format?: string;
	source?: string | Uint8Array;
	shortCircuit?: boolean;
	responseURL?: string;
}

type NextLoad = (url: string, context: unknown) => Promise<LoadResult>;

/** What the parser or the transform said about where the fault is: `:line:column`, or nothing. */
const positionOf = (fault: unknown, source: string): string => {
	const held = fault as { loc?: { line?: number; column?: number }; at?: number };
	const line = held.loc?.line;
	if (typeof line === 'number') return `:${line}:${held.loc?.column ?? 0}`;
	if (typeof held.at !== 'number') return '';
	// A `TransformError` carries an offset, which is what the source it was given was measured in.
	const before = source.slice(0, held.at).split('\n');
	return `:${before.length}:${before[before.length - 1]!.length}`;
};

/**
 * Node's `load` hook: compile a `.tsx` file, leave everything else alone.
 *
 * Params:
 *   url: the module's URL
 *   context: what Node hands the hook, passed on unchanged
 *   nextLoad: the rest of the chain
 *
 * Returns: for a `.tsx` file, its source with the JSX compiled, as `module-typescript` so
 * Node strips the types afterwards. For anything else, whatever the rest of the chain says.
 *
 * Throws: an `Error` naming the file and the line, with the fault as its `cause`. The fault is a
 * `TransformError` for a rule a compiled template cannot meet, and the parser's own `SyntaxError`
 * for source it cannot read. Neither names the file on its own, and a stack into a parser is not
 * where the reader has to look.
 */
export const load = async (url: string, context: unknown, nextLoad: NextLoad): Promise<LoadResult> => {
	if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
	const filename = fileURLToPath(url);
	const source = await readFile(filename, 'utf8');
	let code: string;
	try {
		code = transform(source, { filename }).code;
	} catch (fault) {
		const where = positionOf(fault, source);
		const said = fault instanceof Error ? fault.message : String(fault);
		throw new Error(`${filename}${where}: ${said}`, { cause: fault });
	}
	return { format: 'module-typescript', source: code, shortCircuit: true };
};

// Registering from the module Node was told to `--import` is what makes one flag enough: the
// hook has to run on a worker thread, and `register` is what puts it there.
register(import.meta.url);
