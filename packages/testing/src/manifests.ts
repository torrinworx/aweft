// The dependency allowlist: what a package may declare.
//
// The test policy promises one runner, one assertion library, and no DOM emulation, and a
// promise about dependencies is checkable in one place: the manifests. Stack packages may
// depend on each other; anything else must be named in the allowlist a caller provides.
//
// Peers are read too, because an optional peer is how the stack takes an external package it
// can use but must not require (AGENTS.md, optional external dependencies; design 140). A
// peer that is not marked optional is a dependency wearing another name.

/** The dependency-bearing part of one package.json. */
export interface Manifest {
	readonly name: string;
	readonly dependencies?: Readonly<Record<string, string>> | undefined;
	readonly devDependencies?: Readonly<Record<string, string>> | undefined;
	readonly peerDependencies?: Readonly<Record<string, string>> | undefined;
	readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>> | undefined;
}

/** Whether an allowlist entry covers a name. A trailing `/*` covers a whole family. */
const covers = (entry: string, name: string): boolean =>
	(entry.endsWith('/*') ? name.startsWith(entry.slice(0, -1)) : entry === name);

const allows = (names: readonly string[], name: string): boolean =>
	names.some((entry) => covers(entry, name));

/**
 * Every dependency declaration the allowlist does not cover.
 *
 * Params:
 *   manifests: the packages' manifests
 *   allowed: dependency names permitted anywhere; `@aweftjs/` packages are always permitted.
 *            An entry ending `/*` covers a family, so `@iconify-json/*` is one entry
 *   perPackage: extra names permitted for specific packages, by package name, in the same
 *               spelling
 *
 * Returns: one line per violation, naming the package and the dependency, empty when clean. A
 * third-party peer that is not marked optional is a violation even when the allowlist names it.
 *
 * Example:
 *   const violations = checkManifests(manifests, ['typescript'], {});
 */
export const checkManifests = (
	manifests: readonly Manifest[],
	allowed: readonly string[],
	perPackage: Readonly<Record<string, readonly string[]>> = {},
): string[] => {
	const violations: string[] = [];

	for (const manifest of manifests) {
		const extra = perPackage[manifest.name] ?? [];
		for (const group of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies]) {
			for (const name of Object.keys(group ?? {})) {
				if (name.startsWith('@aweftjs/')) continue;
				if (!allows(allowed, name) && !allows(extra, name)) {
					violations.push(`${manifest.name} declares ${name}, which is not in the allowlist`);
					continue;
				}
				if (group !== manifest.peerDependencies) continue;
				if (manifest.peerDependenciesMeta?.[name]?.optional !== true) {
					violations.push(
						`${manifest.name} declares the peer ${name} without `
						+ 'peerDependenciesMeta.optional, so installing the package installs it',
					);
				}
			}
		}
	}
	return violations;
};
