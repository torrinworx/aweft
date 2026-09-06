// A context is a real tree, not a lookup (design 114).
//
// Providing pushes a node onto the value `mount` threads. Consuming walks up from wherever the
// consumer sits. A node knows its parent and its live children, so something above can watch
// what appeared below it, which is what a router and a form validator both need and what a
// plain upward lookup cannot do.

import { type MutableArray, mutableArray } from '@aweftjs/core';
import { type Mounter, h, mount, watch } from '@aweftjs/dom';

import type { Component } from './component.ts';

import { drop } from './registry.ts';
import { slotOf, use, withSlot } from './render.ts';

/** One live provider. */
export interface ContextNode<T> {
	/** Stable for this render, and the same on a server and in the hydration that adopts it. */
	readonly id: string;
	/** The nearest provider above, or null at the top. */
	readonly parent: ContextNode<T> | null;
	/** The providers directly below, in mount order. Watch it to follow them. */
	readonly children: MutableArray<ContextNode<T>>;
	/** The resolved value. Computed on first read, and again after `value` changes. */
	value(): T;
}

/** What a provider takes: the value for the subtree below it. */
export interface ProviderProps {
	/** The raw value. A cell here keeps the resolved value live. */
	readonly value?: unknown;
	/** The subtree below. Optional in the type because JSX children reach `h` as its rest
	 * arguments rather than as a prop; `h` always fills it in. */
	readonly children?: unknown[];
}

/**
 * How a provider's raw value becomes the value below it.
 *
 * `raw` is what the provider was given, exactly as written: a cell arrives as the cell, because a
 * transform that writes back into one needs it. Read one with `.get()`. The result is cached until
 * `raw` changes, so a cell keeps the value live and a plain value costs one call.
 */
export type Transform<T> = (raw: unknown, parent: T, children: MutableArray<ContextNode<T>>) => T;

/** A context: the provider component, and the four ways to reach what it holds. */
export interface Context<T> {
	(props: ProviderProps): unknown;
	/** The value with no provider above. */
	readonly def: T;
	/** The resolved value, read from a mount context rather than from inside a consumer. */
	read(context: unknown): T;
	/** The nearest provider's node, or null when there is none. */
	node(context: unknown): ContextNode<T> | null;
	/** A component built from the resolved value, once, when the component is built. */
	use<P extends Record<string, unknown>>(build: (value: T) => Component<P>): Component<P>;
}

const inherited = <T>(raw: unknown, parent: T): T => (raw === undefined || raw === null ? parent : raw as T);

/**
 * Make a context.
 *
 * Params:
 *   def: the value where no provider is above
 *   transform: how a provider's raw value, the value above it, and its live children become
 *              the value below it. Omitted, the raw value wins and a null one inherits
 *
 * Returns: the provider component, carrying `def`, `read`, `node` and `use`.
 *
 * Example:
 *   const Tone = createContext('plain');
 *   const Button = Tone.use((tone) => (props) => h('button', { theme: ['button', tone] }, props['label']));
 *   mount(document.body, h(Tone, { value: 'accent' }, h(Button, { label: 'Go' })));
 */
export const createContext = <T>(def: T, transform: Transform<T> = inherited): Context<T> => {
	const KEY: unique symbol = Symbol('aweft.context');

	const node = (value: unknown): ContextNode<T> | null =>
		(slotOf(value, KEY) as ContextNode<T> | undefined) ?? null;

	const read = (value: unknown): T => {
		const found = node(value);
		return found === null ? def : found.value();
	};

	const provider = (props: ProviderProps): Mounter => (elem, _item, before, context) => {
		const parent = node(context);
		const children = mutableArray<ContextNode<T>>();
		let held: T | undefined;
		let known = false;

		const made: ContextNode<T> = {
			id: use(context).ids.next('ctx'),
			parent,
			children,
			value: () => {
				if (!known) {
					held = transform(props.value, parent === null ? def : parent.value(), children);
					known = true;
				}
				return held as T;
			},
		};

		// A raw value that is a cell keeps the resolved value live: the next read runs the
		// transform again. A plain value calls back once, here, and never again.
		const forget = watch(props.value, () => { known = false; });

		if (parent !== null) parent.children.push(made);
		const remove = mount(elem, props.children ?? [], before, withSlot(context, KEY, made));

		return (arg) => {
			if (arg !== undefined) return remove(arg);
			forget();
			if (parent !== null) drop(parent.children, made);
			return remove();
		};
	};

	const used = <P extends Record<string, unknown>>(build: (value: T) => Component<P>): Component<P> =>
		((props: P & { children?: unknown[] }): Mounter => (elem, _item, before, context) =>
			mount(elem, h(build(read(context)), props as Record<string, unknown>), before, context)
		) as unknown as Component<P>;

	return Object.assign(provider as unknown as (props: ProviderProps) => unknown, {
		def, read, node, use: used,
	}) as Context<T>;
};
