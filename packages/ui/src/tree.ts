// Walking the tree by hand, because the light tree has no `contains` and no bubbling.
//
// One walk, called from the three places that need it: the dialog deciding which top-level branch
// to leave reachable, `dismiss` deciding whether a mousedown landed inside, and the drop zone
// deciding whether a click was already the input's own or a button's.
//
// This is not exported from the package.

interface Walkable {
	readonly parentNode?: unknown;
	readonly firstChild?: unknown;
	readonly nextSibling?: unknown;
	readonly nodeType?: number;
}

/** Whether `node` is one of `nodes`, or sits under one of them. */
export const within = (node: unknown, nodes: readonly unknown[]): boolean => {
	for (let at = node as Walkable | null; at !== null && at !== undefined;
		at = (at.parentNode ?? null) as Walkable | null) {
		if (nodes.includes(at)) return true;
	}
	return false;
};

/** Whether `node` is an element with this tag name, or sits under one. */
export const under = (node: unknown, tag: string): boolean => {
	for (let at = node as Walkable | null; at !== null && at !== undefined;
		at = (at.parentNode ?? null) as Walkable | null) {
		if ((at as { localName?: string }).localName === tag) return true;
	}
	return false;
};

/** The first element at or under `root` that `wanted` says yes to, walked depth first. */
export const find = (root: unknown, wanted: (element: unknown) => boolean): unknown => {
	const node = root as Walkable | null;
	if (node === null || node === undefined) return null;
	if (node.nodeType === 1 && wanted(node)) return node;
	for (let at = (node.firstChild ?? null) as Walkable | null; at !== null && at !== undefined;
		at = (at.nextSibling ?? null) as Walkable | null) {
		const found = find(at, wanted);
		if (found !== null) return found;
	}
	return null;
};

/**
 * The first element the event can reach that `wanted` says yes to: at or under the event's target,
 * then at or under each ancestor of it in turn.
 *
 * A component may not keep the node it made. A hydration adopts the markup the server sent and
 * drops what the component built, so a captured node is an orphan by the time anything is clicked
 * (design 133). Resolving from the event is what survives that.
 */
export const findFrom = (target: unknown, wanted: (element: unknown) => boolean): unknown => {
	for (let at = target as Walkable | null; at !== null && at !== undefined;
		at = (at.parentNode ?? null) as Walkable | null) {
		const found = find(at, wanted);
		if (found !== null) return found;
	}
	return null;
};
