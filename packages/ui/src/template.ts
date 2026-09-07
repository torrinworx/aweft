// The hoisted template for a `ui` file (design 108).
//
// `build` emits a call to this instead of to `dom`'s where the file's `h` came from this
// package, and it puts every property in the per-instance edits rather than in the prototype.
// So the static shape still hoists, and what `ui` claims off an element is applied per instance
// with the mount context in hand, exactly as `h` does it.

import { type ElementLike, type Template, type TemplateEdit, type TemplateElement, template as domTemplate } from '@aweftjs/dom';

import { type Claimed, dress, splitProps } from './wrapper.ts';

const WRAP: unique symbol = Symbol('aweft.ui.wrap');

// The property name the marker rides in on. It starts with `$`, so `dom` reads it as a property
// rather than an attribute, and its value is a source, so `dom` files it as a property signal
// carrying the element it belongs to. That is how this reaches each element without walking the
// instance, which cannot work once the varying children have shifted the child indices.
const MARKER = '$aweftUiClaimed';

interface Marker {
	readonly [WRAP]: Claimed;
	/** Where this element's properties sat in the edit list, which is document order. */
	readonly at: number;
	get(): unknown;
	effect(fn: (value: unknown) => void): () => void;
}

const marker = (claimed: Claimed, at: number): Marker => ({
	[WRAP]: claimed,
	at,
	get: () => null,
	effect: () => () => undefined,
});

/** What `dom`'s template hands back when anything in the instance is reactive. */
interface Bound {
	readonly node: ElementLike;
	readonly signals: { readonly source?: unknown; readonly element?: ElementLike }[];
}

const markerOf = (source: unknown): Marker | null => {
	if (typeof source !== 'object' || source === null) return null;
	const held = (source as Partial<Marker>)[WRAP];
	return held === undefined ? null : source as Marker;
};

/**
 * Take the markers back out, and answer the elements they named, in document order.
 *
 * The order matters and is not the order `dom` binds signals in. `dom` applies an element's
 * properties deepest first, so a property that rewrites its element's content still wins, and the
 * markers come back in that order. What `ui` does with a claimed prop has to run in the order the
 * source wrote the elements, because the render's class cache hands out names as they are asked
 * for, and an element that got `aw0` when the page was written by hand has to get `aw0` when the
 * same page is compiled.
 */
const unmark = (made: unknown): Claimed[] => {
	const signals = (made as Partial<Bound>).signals;
	if (!Array.isArray(signals)) return [];
	const found: { claimed: Claimed; at: number }[] = [];
	for (let i = signals.length - 1; i >= 0; i -= 1) {
		const signal = signals[i]!;
		const mark = markerOf(signal.source);
		if (mark === null) continue;
		found.push({ claimed: mark[WRAP], at: mark.at });
		signals.splice(i, 1);
	}
	found.sort((a, b) => a.at - b.at);
	return found.map((one) => one.claimed);
};

/**
 * The static shape of a `ui` subtree, made once per document and instanced per use.
 *
 * The signature is `dom`'s, and so is everything about the shape: `build` emits a call to this
 * one instead when the file's `h` came from `@aweftjs/ui`. What differs is that each instance's
 * properties are split first, so `theme`, `style`, `onXxx` and the state cells do what `h` would
 * have done with them.
 *
 * Params:
 *   spec: the element, its literal attributes and its static children, nested
 *   edits: where something varies, in the order the source evaluates the values
 *
 * Returns: a function taking one value per edit. It answers what `ui`'s `h` would have answered
 * for the same subtree: the instance itself when `ui` claimed nothing anywhere in it, and
 * otherwise a mounter.
 *
 * Throws: whatever `dom`'s `template` throws, and the asserts `h` makes about a claimed prop.
 *
 * Example:
 *   const row = template(['li', null, ['span', null]], [['props', []], ['child', [0], -1]]);
 *   mount(list, row([{ theme: 'row' }, title]));
 */
export const template = (spec: TemplateElement, edits: readonly TemplateEdit[]): Template => {
	const inner = domTemplate(spec, edits);

	return (values) => {
		let marked = false;
		const out = values.slice();
		for (let i = 0; i < edits.length; i += 1) {
			if (edits[i]![0] !== 'props') continue;
			const props = values[i];
			if (props === null || props === undefined || typeof props !== 'object') continue;
			const { rest, claimed } = splitProps(props as Record<string, unknown>);
			if (claimed === null) {
				out[i] = rest;
				continue;
			}
			out[i] = { ...rest, [MARKER]: marker(claimed, i) };
			marked = true;
		}

		const made = inner(out);
		if (!marked) return made;
		const claims = unmark(made);
		return claims.length === 0 ? made : dress(made, claims);
	};
};
