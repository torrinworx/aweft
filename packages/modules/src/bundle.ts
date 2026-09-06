// Modules a bundler already gathered: a record of path to exports, or of path to a function
// that loads them (design 062).

import type { Candidate, ModuleExports, Source } from './contract.ts';
import { nameOfPath } from './names.ts';

/** One entry of a bundle map: the exports, or a function that loads them. */
export type BundleEntry = ModuleExports | (() => Promise<ModuleExports>);

/**
 * A source over a bundle map.
 *
 * Params:
 *   map: path to entry, in the shape a bundler's glob import produces, eager or lazy
 *   options.prefix: the leading part of every key to drop; without it, a leading `./` is
 *     dropped
 *
 * Returns: a source whose names are the keys without that prefix and without the file
 * extension, so `./modules/auth/Session.js` is `auth/Session` under `prefix: './modules/'`.
 *
 * Throws: a `ModulesError` with reason `invalid-name`, at once, for a key that leaves no name
 * once its extension is removed.
 *
 * Example:
 *   const source = fromBundle(import.meta.glob('./modules/**\/*.js'), { prefix: './modules/' });
 */
export const fromBundle = (
	map: Readonly<Record<string, BundleEntry>>,
	options: { readonly prefix?: string } = {},
): Source => {
	const candidates: Candidate[] = Object.entries(map).map(([key, entry]) => ({
		name: nameOfPath(key, options.prefix),
		exports: async () => (typeof entry === 'function' ? await entry() : entry),
	}));

	return { candidates: async () => candidates };
};
