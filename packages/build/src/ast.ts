// Reading the parsed file.
//
// The parser hands back a tree of plain objects, each with a `type` and a range into the source.
// Nothing here knows what any node means; it knows how to get from a node to its children and
// how to ask what a node is. Every pass walks with these.

/** One node of the parsed file. `start` and `end` are offsets into the source it came from. */
export interface Node {
	readonly type: string;
	readonly start: number;
	readonly end: number;
	readonly [key: string]: unknown;
}

// Position, comments and the parser's own bookkeeping hang off every node and are not children.
const NOT_CHILDREN = new Set([
	'loc', 'start', 'end', 'range', 'extra', 'errors', 'comments',
	'leadingComments', 'trailingComments', 'innerComments',
]);

export const isNode = (value: unknown): value is Node =>
	typeof value === 'object' && value !== null
	&& typeof (value as { type?: unknown }).type === 'string'
	&& typeof (value as { start?: unknown }).start === 'number';

/** Every child node, in the order the parser stored them. */
export const forEachChild = (node: Node, fn: (child: Node) => void): void => {
	for (const key of Object.keys(node)) {
		if (NOT_CHILDREN.has(key)) continue;
		const value = node[key];
		if (isNode(value)) {
			fn(value);
		} else if (Array.isArray(value)) {
			for (const entry of value) if (isNode(entry)) fn(entry);
		}
	}
};

/**
 * Walk a subtree. `visit` returning false stops the walk at that node, so a pass that handles a
 * node whole does not then see the inside of it a second time.
 */
export const walk = (node: Node, visit: (node: Node) => boolean): void => {
	if (!visit(node)) return;
	forEachChild(node, (child) => walk(child, visit));
};

/** Every name a node binds, for each pattern a declaration or a parameter can be written as. */
export const patternNames = (node: Node, add: (name: string) => void): void => {
	switch (node.type) {
		case 'Identifier':
			add(node['name'] as string);
			return;
		case 'ObjectPattern':
			for (const property of node['properties'] as Node[]) {
				if (property.type === 'RestElement') patternNames(property['argument'] as Node, add);
				else patternNames(property['value'] as Node, add);
			}
			return;
		case 'ArrayPattern':
			for (const element of node['elements'] as (Node | null)[]) if (element !== null) patternNames(element, add);
			return;
		case 'AssignmentPattern':
			patternNames(node['left'] as Node, add);
			return;
		case 'RestElement':
			patternNames(node['argument'] as Node, add);
			return;
		default:
			return;
	}
};
