// Modules that live in a document (design 062).
//
// The document is an observable object keyed by module name; each entry carries `source`.
// Nothing here knows where the document came from, whether anything persists it, or who may
// write it (design 064).

import type { Candidate, Compile, Source } from './contract.ts';
import { modulesError } from './contract.ts';
import { compile as defaultCompile } from './compile.ts';

/** The `source` of one entry, or undefined when the entry is absent or carries none. */
export const sourceOf = (document: object, name: string): string | undefined => {
	const entry: unknown = (document as Record<string, unknown>)[name];
	if (entry === null || typeof entry !== 'object') return undefined;
	const source: unknown = (entry as { source?: unknown }).source;
	return typeof source === 'string' ? source : undefined;
};

/** Every entry name that carries a source right now. */
export const entryNames = (document: object): string[] =>
	Object.keys(document).filter((name) => sourceOf(document, name) !== undefined);

/**
 * A source over a document.
 *
 * Params:
 *   document: an observable object whose keys are module names and whose values carry a
 *     `source` string; other fields are yours and are ignored
 *   options.compile: what turns a source into exports; the default imports it as an ES module
 *
 * Returns: a source. It reads the document each time it is listed, so a module added to the
 * document is a candidate on the next `load`, and `exports()` compiles the source as it is at
 * that moment.
 *
 * Throws: a `ModulesError` with reason `missing`, out of the `load` that is using it, when an
 * entry leaves the document between being listed and being compiled.
 *
 * Example:
 *   const plugins = createObject({ 'plugin/Shout': { source: 'export default () => ({ ... })' } });
 *   const loader = createLoader({ sources: [fromDocument(plugins)] });
 */
export const fromDocument = (document: object, options: { readonly compile?: Compile } = {}): Source => {
	const compile = options.compile ?? defaultCompile;
	return {
		candidates: async () => entryNames(document).map((name): Candidate => ({
			name,
			exports: async () => {
				const source = sourceOf(document, name);
				if (source === undefined) {
					throw modulesError(
						'missing', name, `${name} has no source any more; it left the document after it was listed`,
						'Leave the entry in the document until the load is over.',
					);
				}
				return compile(source);
			},
		})),
	};
};
