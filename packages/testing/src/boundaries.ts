// Package boundary checking: tiers and planes.
//
// A package may import from its own tier or any tier below it. Never upward, and never
// across the client/server plane boundary. Two exceptions, both named rather than implied:
// integrators compose across the whole stack by definition, and tooling sits outside the
// runtime rule.
//
// This is a function with tests rather than a lint config because an unenforceable rule is
// worse than no rule: it reads as a guarantee and delivers nothing.

/** Which side a package runs on. `isomorphic` may be imported from either. */
export type Plane = 'client' | 'server' | 'isomorphic';

/** A package's place in the table: how high it sits, and which side it runs on. */
export interface PackageInfo {
	/** Tier number, or 'integrator' for packages exempt from the ordering. */
	readonly tier: number | 'integrator';
	readonly plane: Plane;
}

/** One illegal import edge, and which rule it broke. */
export interface Violation {
	readonly from: string;
	readonly to: string;
	readonly rule: 'upward-tier' | 'cross-plane' | 'unknown-package';
	readonly detail: string;
}

/**
 * Check one import edge against the boundary rules.
 *
 * Params:
 *   from, to: package names as they appear in the table
 *   table: the tier and plane map, owned by .dependency-cruiser.cjs
 *
 * Returns: a Violation, or null when the edge is allowed.
 */
export const checkEdge = (
	from: string,
	to: string,
	table: Readonly<Record<string, PackageInfo>>,
): Violation | null => {
	if (from === to) return null;

	const a = table[from];
	const b = table[to];

	// An edge naming a package the table does not know is itself the finding. Silently
	// allowing it would let a new package skip the rules by not registering.
	if (!a) return { from, to, rule: 'unknown-package', detail: `${from} is not in the tier table` };
	if (!b) return { from, to, rule: 'unknown-package', detail: `${to} is not in the tier table` };

	// Integrators may reach anywhere. Nothing may reach an integrator: that would be a
	// lower tier depending on something that composes it.
	if (b.tier === 'integrator' && a.tier !== 'integrator') {
		return {
			from,
			to,
			rule: 'upward-tier',
			detail: `${to} is an integrator, so ${from} may not import it`,
		};
	}
	if (a.tier === 'integrator') return null;

	if (typeof b.tier === 'number' && b.tier > a.tier) {
		return {
			from,
			to,
			rule: 'upward-tier',
			detail: `${from} is tier ${a.tier} and may not import ${to} at tier ${b.tier}`,
		};
	}

	const crossesPlane =
		a.plane !== 'isomorphic' && b.plane !== 'isomorphic' && a.plane !== b.plane;

	if (crossesPlane) {
		return {
			from,
			to,
			rule: 'cross-plane',
			detail: `${from} is ${a.plane} and may not import ${to} on the ${b.plane} plane`,
		};
	}

	return null;
};

/**
 * Check a whole import graph.
 *
 * Params:
 *   edges: every package-to-package import in the repo
 *   table: the tier and plane map
 *
 * Returns: every violation found, in input order. Empty means the graph is legal.
 */
export const checkGraph = (
	edges: ReadonlyArray<readonly [string, string]>,
	table: Readonly<Record<string, PackageInfo>>,
): Violation[] => {
	const found: Violation[] = [];

	for (const [from, to] of edges) {
		const violation = checkEdge(from, to, table);
		if (violation) found.push(violation);
	}

	return found;
};
