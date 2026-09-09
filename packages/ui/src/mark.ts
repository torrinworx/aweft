// Marks: the one way a component takes more than one slot of children.
//
// A mark is not a node and is never mounted. It is a tagged value the parent component reads out
// of its own `children`, which is what lets `Shown` take a then and an else, and `Detached` take
// an anchor and a popup, with one syntax and an error message that names the slots it knows.

import { assert } from './assert.ts';

const MARKED: unique symbol = Symbol('aweft.marked');
const MAKER: unique symbol = Symbol('aweft.mark');

/** One slot's contents, as the parent component reads it. */
export interface Marked {
	readonly [MARKED]: string;
	/** The slot's name. */
	readonly name: string;
	/** Everything written on the mark, with its children under `children`. */
	readonly props: Record<string, unknown> & { readonly children: unknown[] };
}

/** What `mark.name` is: a tag `ui`'s `h` turns into a mark rather than an element. */
export type MarkMaker = ((props?: Record<string, unknown>, ...children: unknown[]) => unknown)
	& { readonly [MAKER]: string };

const makers = new Map<string, MarkMaker>();

const makerFor = (name: string): MarkMaker => {
	let held = makers.get(name);
	if (held === undefined) {
		const maker = (() => undefined) as unknown as { [MAKER]: string };
		maker[MAKER] = name;
		held = maker as MarkMaker;
		makers.set(name, held);
	}
	return held;
};

/** The slot name a tag stands for, or null when the tag is not a mark. */
export const markNameOf = (tag: unknown): string | null => {
	if (typeof tag !== 'function') return null;
	const name = (tag as Partial<MarkMaker>)[MAKER];
	return name === undefined ? null : name;
};

/** Build the mark itself. */
export const makeMark = (name: string, props: Record<string, unknown> | null, children: unknown[]): Marked => ({
	[MARKED]: name,
	name,
	props: { ...(props ?? {}), children },
});

/** Whether a child is a mark. */
export const isMark = (value: unknown): value is Marked =>
	typeof value === 'object' && value !== null && typeof (value as Marked)[MARKED] === 'string';

/**
 * What `mark` is: callable by name, and a tag under any slot name.
 *
 * The eight slots this package's own components read are declared one by one rather than left to
 * the index signature, because `noUncheckedIndexedAccess` widens every read of an index signature
 * with `undefined`, and a JSX tag whose type may be undefined is not a tag the compiler will call.
 * A slot name outside that list works at run time and is written `mark('name', props, ...children)`
 * in a TypeScript file.
 */
export interface Mark {
	/** Build a mark by name. */
	(name: string, props?: Record<string, unknown> | null, ...children: unknown[]): Marked;
	readonly then: MarkMaker;
	readonly else: MarkMaker;
	readonly case: MarkMaker;
	readonly default: MarkMaker;
	readonly popup: MarkMaker;
	readonly anchor: MarkMaker;
	readonly tabs: MarkMaker;
	readonly panels: MarkMaker;
	/** `mark.popup` is the tag; `ui`'s `h` turns it into a mark rather than an element. */
	readonly [slot: string]: MarkMaker;
}

/**
 * A named slot of children, for a component that takes more than one.
 *
 * Written as a tag, `<mark.popup>...</mark.popup>`, which `ui`'s `h` reads. Called directly,
 * `mark('popup', props, ...children)`, for a file that does not write JSX. A mark never reaches
 * `mount`: the component it was written inside reads it with `categories`.
 *
 * Example:
 *   <Detached enabled={open}>
 *     <button>menu</button>
 *     <mark.popup><Menu /></mark.popup>
 *   </Detached>
 */
export const mark: Mark = new Proxy(
	((name: string, props: Record<string, unknown> | null = null, ...children: unknown[]) =>
		makeMark(name, props, children)) as unknown as Mark,
	{
		get: (target, key, receiver) => {
			if (typeof key !== 'string' || Reflect.has(target, key)) return Reflect.get(target, key, receiver) as unknown;
			return makerFor(key);
		},
	},
);

/** One slot's children, with every mark of that name merged into `props`. */
export interface Category {
	/** The children written into this slot, in order. */
	readonly items: unknown[];
	/** Everything written on the marks of this slot, later marks winning. */
	readonly props: Record<string, unknown>;
}

/**
 * Split a component's children into its named slots.
 *
 * Params:
 *   children: the component's own `props.children`
 *   names: the slots this component knows, in the order the caller wants them back
 *   fallback: the slot a bare child goes in. Omitted, a bare child is refused
 *
 * Returns: one category per name, in that order. A category with nothing in it is empty rather
 * than absent, so a caller can destructure without checking.
 *
 * Throws: an assert, loud in development and stripped in a release build, naming the slots this
 * component knows, for a mark it does not know or a bare child with no slot to go in, and for a
 * name given twice in `names`.
 *
 * Example:
 *   const [then, otherwise] = categories(props.children, ['then', 'else'], 'then');
 */
export const categories = (
	children: readonly unknown[],
	names: readonly string[],
	fallback?: string,
): Category[] => {
	const found = new Map<string, Category>();
	for (const name of names) {
		// Two slots of one name are one slot, and the caller would get the same category twice and
		// mount its children twice.
		assert(!found.has(name), `this component names the slot ${name} twice; give the second one another name`);
		found.set(name, { items: [], props: {} });
	}

	for (const child of children) {
		if (isMark(child)) {
			const bucket = found.get(child.name);
			assert(bucket !== undefined,
				`this component knows the slots ${names.join(', ')} and was given ${child.name}; rename the mark or drop it`);
			if (bucket === undefined) continue;
			const { children: inner, ...rest } = child.props;
			bucket.items.push(...inner);
			Object.assign(bucket.props, rest);
			continue;
		}
		if (child === null || child === undefined) continue;
		const bucket = fallback === undefined ? undefined : found.get(fallback);
		assert(bucket !== undefined,
			`this component takes only the slots ${names.join(', ')}; wrap this child in one of them`);
		bucket?.items.push(child);
	}

	return names.map((name) => found.get(name)!);
};
