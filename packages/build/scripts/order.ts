// The order the packages compile in (design 256).
//
// `tsc` resolves a bare `@aweftjs/x` through that package's `exports` map, whose `types` entry
// is under `dist/`, so a package compiles only once every package it imports has been built.
// Alphabetical order puts `auth` before `client` and fails from a clean tree; this reads each
// manifest's workspace dependencies and answers an order every dependency comes first in.

/** A manifest as this reads it: the package's directory name and the workspace names it depends on. */
export interface Manifest {
	readonly name: string;
	readonly dependencies?: Readonly<Record<string, string>> | undefined;
	readonly peerDependencies?: Readonly<Record<string, string>> | undefined;
	readonly optionalDependencies?: Readonly<Record<string, string>> | undefined;
}

const SCOPE = '@aweftjs/';

/** The workspace packages a manifest names, by directory name, in any of the three fields. */
export const workspaceDependencies = (manifest: Manifest): string[] => {
	const names = new Set<string>();
	for (const field of [manifest.dependencies, manifest.peerDependencies, manifest.optionalDependencies]) {
		for (const name of Object.keys(field ?? {})) if (name.startsWith(SCOPE)) names.add(name.slice(SCOPE.length));
	}
	return [...names].sort();
};

/**
 * The packages in an order every dependency precedes its dependents, alphabetical where the
 * graph leaves a choice, so the order is the same on every run.
 *
 * Params:
 *   manifests: one per package, keyed by directory name
 *
 * Returns: every key once, dependencies first.
 *
 * Throws: an `Error` naming the packages in a cycle, since no order can build those.
 */
export const buildOrder = (manifests: ReadonlyMap<string, Manifest>): string[] => {
	const names = [...manifests.keys()].sort();
	const waiting = new Map<string, Set<string>>();
	for (const name of names) {
		const needs = workspaceDependencies(manifests.get(name)!).filter((dep) => manifests.has(dep) && dep !== name);
		waiting.set(name, new Set(needs));
	}
	const order: string[] = [];
	while (waiting.size > 0) {
		const ready = [...waiting.entries()].filter(([, needs]) => needs.size === 0).map(([name]) => name).sort();
		if (ready.length === 0) {
			throw new Error(`the packages ${[...waiting.keys()].join(', ')} depend on each other in a cycle, so there is no order to build them in`);
		}
		for (const name of ready) {
			order.push(name);
			waiting.delete(name);
			for (const needs of waiting.values()) needs.delete(name);
		}
	}
	return order;
};
