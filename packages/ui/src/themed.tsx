// The inherited theme prefix.
//
// A component built through `ThemeContext.use` is handed an `h` that puts the inherited segments
// in front of every `theme` prop it writes. Nothing per element has to remember to do it, and a
// component cannot forget.

import { type Mounter, h as domH, mount } from '@aweftjs/dom';

import type { Component } from './component.ts';

import { type Context, type ContextNode, type ProviderProps, createContext } from './contexts.ts';
import { h } from './h.ts';

const flat = (value: unknown, out: string[]): void => {
	if (value === null || value === undefined || value === false || value === '') return;
	if (Array.isArray(value)) {
		for (const item of value) flat(item, out);
		return;
	}
	out.push(String(value));
};

const base: Context<string[]> = createContext<string[]>([], (raw, parent) => {
	const own: string[] = [];
	flat(raw, own);
	return own.length === 0 ? parent : [...parent, ...own];
});

/** An `h` that carries the inherited theme. Same signature as `h`. */
export type Themed = (tag: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;

/** The theme prefix every element below inherits, and the `h` that applies it. */
export interface ThemeCascade {
	(props: ProviderProps): unknown;
	/** No prefix. A page that wants one puts a provider at the top. */
	readonly def: string[];
	/** The segments inherited at a point in the tree. */
	read(context: unknown): string[];
	/** The nearest provider's node, or null. */
	node(context: unknown): ContextNode<string[]> | null;
	/**
	 * A component whose `h` prepends the inherited segments.
	 *
	 * The prefix is added to any element that has a `theme` prop at all, including one written
	 * `theme=""`, and to no element that has none. So an element opts into the cascade by asking
	 * for a theme, and a plain `<div>` inside a themed component stays plain.
	 */
	use<P extends Record<string, unknown>>(build: (h: Themed) => Component<P>): Component<P>;
}

const used = <P extends Record<string, unknown>>(build: (h: Themed) => Component<P>): Component<P> =>
	((props: P & { children?: unknown[] }): Mounter => (elem, _item, before, context) => {
		const inherited = base.read(context);
		const themed: Themed = (tag, given = {}, ...children) => {
			const props2 = given ?? {};
			if (!('theme' in props2)) return h(tag, props2, ...children);
			return h(tag, { ...props2, theme: [...inherited, props2['theme']] }, ...children);
		};
		return mount(elem, domH(build(themed), props as Record<string, unknown>), before, context);
	}) as unknown as Component<P>;

/**
 * The theme every element below inherits.
 *
 * Params:
 *   value: one segment, or a list of them, added to what is already inherited
 *   children: the subtree that inherits it
 *
 * Example:
 *   <ThemeContext value="primary"><Panel /></ThemeContext>
 */
export const ThemeContext: ThemeCascade = Object.assign(base, { use: used }) as unknown as ThemeCascade;
