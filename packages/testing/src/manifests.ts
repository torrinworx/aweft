// The dependency allowlist: what a package may declare.
//
// The test policy promises one runner, one assertion library, and no DOM emulation, and a
// promise about dependencies is checkable in one place: the manifests. Stack packages may
// depend on each other; anything else must be named in the allowlist a caller provides.

/** The dependency-bearing part of one package.json. */
export interface Manifest {
	readonly name: string;
	readonly dependencies?: Readonly<Record<string, string>> | undefined;
	readonly devDependencies?: Readonly<Record<string, string>> | undefined;
}

/**
 * Every dependency declaration the allowlist does not cover.
 *
 * Params:
 *   manifests: the packages' manifests
 *   allowed: dependency names permitted anywhere; `@aweftjs/` packages are always permitted
 *   perPackage: extra names permitted for specific packages, by package name
 *
 * Returns: one line per violation, naming the package and the dependency, empty when clean.
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
		for (const group of [manifest.dependencies, manifest.devDependencies]) {
			for (const name of Object.keys(group ?? {})) {
				if (name.startsWith('@aweftjs/')) continue;
				if (allowed.includes(name) || extra.includes(name)) continue;
				violations.push(`${manifest.name} declares ${name}, which is not in the allowlist`);
			}
		}
	}
	return violations;
};
