// What a module is (design 061), and where one comes from (design 062).
//
// A module is the set of exports a file, a bundle entry or a document entry hands over. A
// source lists candidates, each a name and a way to get those exports, and evaluates nothing
// until a loader asks. Nothing here runs code.

import { codecError } from '@aweftjs/codec';

/**
 * What a module's factory receives.
 *
 * The three named fields win over anything of the same name in the loader's props, which are
 * spread in first.
 */
export interface ModuleProps {
	/** The instances of the modules named in `deps`, keyed by the last segment of each name. */
	readonly imports: Readonly<Record<string, unknown>>;
	/** `defaults`, with every extension's `config` merged over it, the earliest source winning. */
	readonly config: Readonly<Record<string, unknown>>;
	/** Every extension's `extensions`, merged the same way. */
	readonly extensions: Readonly<Record<string, unknown>>;
	/** Whatever the loader was made with. */
	readonly [key: string]: unknown;
}

/** Builds a module's instance. May return a promise. Whatever it returns is the instance. */
export type Factory = (props: ModuleProps) => unknown;

/**
 * What a module exports.
 *
 * An implementation exports `default`, usually `deps`, and sometimes `defaults`. An extension
 * exports `config` or `extensions` and no `default`; its contribution merges into the module
 * of the same name from another source. One file may do both.
 */
export interface ModuleExports {
	readonly deps?: readonly string[];
	readonly defaults?: Readonly<Record<string, unknown>>;
	readonly config?: Readonly<Record<string, unknown>>;
	readonly extensions?: Readonly<Record<string, unknown>>;
	readonly default?: Factory;
}

/** One module a source can hand over: its name, and the way to get its exports when asked. */
export interface Candidate {
	readonly name: string;
	/** Evaluate the candidate. Called by `load` and by nothing else. */
	exports(): Promise<ModuleExports>;
}

/** Somewhere modules come from. Listing evaluates nothing. */
export interface Source {
	candidates(): Promise<readonly Candidate[]>;
}

/** Turns module text into its exports. The default is `compile`; an application may pass its own. */
export type Compile = (source: string) => Promise<ModuleExports>;

/**
 * An error this package raises, with a reason a caller can branch on.
 *
 * Reasons: `missing` (a name is in no source, or left it while it was being loaded),
 * `no-implementation` (only extensions for it), `duplicate` (one source lists a name twice),
 * `invalid-name` (a path that leaves no name), `cycle`, `ambiguous-import` (two dependencies
 * share a last segment), `failed` (a factory threw; `cause` carries what it threw).
 */
export interface ModulesError extends Error {
	readonly reason: string;
	readonly module: string;
}

export const modulesError = (reason: string, module: string, detail: string, fix: string, cause?: unknown): ModulesError =>
	Object.assign(codecError(reason, detail, fix), cause === undefined ? { module } : { module, cause });
