// From candidates to a definition, and from definitions to an order (designs 061, 062).
//
// Pure: nothing here holds state, so two loaders can never disagree about what a set of
// candidates means.

import type { Candidate, Factory } from './contract.ts';
import { modulesError } from './contract.ts';
import { isPlainObject, merge } from './merge.ts';

/** One module, settled: which factory, which dependencies, and what configuration it gets. */
export interface Definition {
	readonly name: string;
	readonly deps: readonly string[];
	readonly factory: Factory;
	readonly config: Readonly<Record<string, unknown>>;
	readonly extensions: Readonly<Record<string, unknown>>;
}

/**
 * Settle one name from every candidate carrying it, in source order.
 *
 * The first candidate with a factory is the implementation and its `deps` and `defaults`
 * count. Every candidate's `config` and `extensions` contribute, the earliest winning, which
 * is what lets an application configure a library's module by writing a same-named file that
 * exports only `config`.
 */
export const resolve = async (name: string, candidates: readonly Candidate[]): Promise<Definition> => {
	if (candidates.length === 0) throw modulesError('missing', name, `${name} is not in any source`);

	const all = await Promise.all(candidates.map((c) => c.exports()));

	let factory: Factory | undefined;
	let deps: readonly string[] = [];
	let defaults: Readonly<Record<string, unknown>> = {};
	const configs: Readonly<Record<string, unknown>>[] = [];
	const extensions: Readonly<Record<string, unknown>>[] = [];

	for (const exports of all) {
		if (factory === undefined && typeof exports.default === 'function') {
			factory = exports.default;
			deps = Array.isArray(exports.deps) ? [...exports.deps] : [];
			if (isPlainObject(exports.defaults)) defaults = exports.defaults;
		}
		if (isPlainObject(exports.config)) configs.push(exports.config);
		if (isPlainObject(exports.extensions)) extensions.push(exports.extensions);
	}

	if (factory === undefined) {
		throw modulesError('no-implementation', name, `${name} has no implementation, only configuration`);
	}

	// Fold from the lowest precedence up, so the earliest source's contribution is merged last
	// and wins.
	let config: Record<string, unknown> = { ...defaults };
	for (let i = configs.length - 1; i >= 0; i--) config = merge(config, configs[i]!);
	let extension: Record<string, unknown> = {};
	for (let i = extensions.length - 1; i >= 0; i--) extension = merge(extension, extensions[i]!);

	return { name, deps, factory, config, extensions: extension };
};

/**
 * Dependency order over a set of definitions: every module after everything it depends on.
 *
 * A dependency outside `definitions` is taken as already satisfied; the loader passes only
 * what is not yet loaded, and checks the rest itself. A cycle is refused naming the modules
 * in it. Deterministic: the same set always gives the same order.
 */
export const order = (definitions: ReadonlyMap<string, Definition>): string[] => {
	const done = new Set<string>();
	const walking: string[] = [];
	const out: string[] = [];

	const visit = (name: string): void => {
		if (done.has(name)) return;
		const at = walking.indexOf(name);
		if (at >= 0) {
			const cycle = [...walking.slice(at), name].join(' -> ');
			throw modulesError('cycle', name, `a dependency cycle: ${cycle}`);
		}
		const definition = definitions.get(name);
		if (definition === undefined) return;

		walking.push(name);
		for (const dep of definition.deps) visit(dep);
		walking.pop();
		done.add(name);
		out.push(name);
	};

	for (const name of [...definitions.keys()].sort()) visit(name);
	return out;
};
