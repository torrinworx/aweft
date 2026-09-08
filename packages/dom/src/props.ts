// The properties `h` set on a node, kept so hydration can set them on the server node that
// takes its place (design 078). Attributes are in the markup already; properties are not.

const applied = new WeakMap<object, [string, unknown][]>();
const made = new WeakSet<object>();

// Only a hydration reads any of this, so only a hydration pays for it (designs 098 and 157).
// The flag is off outside every mount: `hydrate` takes what makes the item and builds it
// inside the hydrating mount, so nothing a hydration will read is ever made out there. An
// element an application builds eagerly used to pay for a hydration that never came. Inside a
// mount the root knows, and `withRoot` sets the flag from it.
let recording = false;

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
