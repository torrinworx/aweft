// The properties `h` set on a node, kept so hydration can set them on the server node that
// takes its place (design 078). Attributes are in the markup already; properties are not.

const applied = new WeakMap<object, [string, unknown][]>();
const made = new WeakSet<object>();

// Only a hydration reads any of this, so only a hydration pays for it (design 098). The flag
// is on outside every mount, because `h` runs before anything has said what will happen to
// the node: `hydrate(target, h('main', ...))` builds the element first. Inside a mount the
// root knows, and `withRoot` sets the flag from it.
let recording = true;

/** Set whether to record, and answer what it was, so the caller can put it back. */
export const setRecording = (on: boolean): boolean => {
	const was = recording;
	recording = on;
	return was;
};

/** Nodes the binding made are the ones hydration may claim; a node the application made is
 * inserted as it is (design 078). */
export const markMade = <N extends object>(node: N): N => {
	if (recording) made.add(node);
	return node;
};

export const isMade = (node: object): boolean => made.has(node);

export const recordProperty = (node: object, name: string, value: unknown): void => {
	if (!recording) return;
	let list = applied.get(node);
	if (list === undefined) {
		list = [];
		applied.set(node, list);
	}
	list.push([name, value]);
};

export const propertiesOf = (node: object): readonly [string, unknown][] => applied.get(node) ?? [];

export const isRecordedProperty = (node: object, name: string): boolean =>
	(applied.get(node) ?? []).some(([n]) => n === name);

// Attributes a scope or cell drives are written when the element is bound, after pairing, so
// pairing must not read their absence on the fresh element as a difference.
const reactive = new WeakMap<object, Set<string>>();

export const recordReactiveAttribute = (node: object, name: string): void => {
	if (!recording) return;
	let names = reactive.get(node);
	if (names === undefined) {
		names = new Set();
		reactive.set(node, names);
	}
	names.add(name);
};

export const isReactiveAttribute = (node: object, name: string): boolean => reactive.get(node)?.has(name) ?? false;
