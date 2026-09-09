// A stack of disclosures where opening one closes the rest (design 202).
//
// The exclusive behaviour is the platform's: a group of `<details>` sharing one `name` keeps one of
// them open, and the one that closes fires its own `toggle`, so every `DropDown`'s `open` cell
// follows with nothing written here. What this component adds is the name and the lines between.

import { type Mounter, mount } from '@aweftjs/dom';

import { DropDown } from './drop-down.tsx';
import { elementFor } from './control.ts';
import { h } from './h.ts';
import { use } from './render.ts';

/** One section, for the common case where every section is a label and a block. */
export interface AccordionItem {
	/** The words on the summary. */
	readonly label?: unknown;
	/** What shows while it is open. Anything mountable. */
	readonly content?: unknown;
}

/** What `Accordion` takes. Everything not named here goes to the element. */
export interface AccordionProps {
	/**
	 * The name every `<details>` in this group shares. One is minted off the render when it is left
	 * off, so a server render and the hydration that adopts it agree.
	 */
	readonly name?: unknown;
	/** The sections. Leave it off and pass `DropDown`s as children instead. */
	readonly items?: readonly AccordionItem[];
	/** The summaries' button variant, handed to every `DropDown` this renders. */
	readonly type?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly children?: unknown[];
	readonly [prop: string]: unknown;
}

/**
 * A stack of sections, one of them open.
 *
 * Params:
 *   props: `name`, `items`, `type`, `element`, and anything else, which goes to the element
 *   children: `DropDown`s of your own, for anything `items` does not cover
 *
 * Returns: a `<div>` on the `accordion` entry. Each `DropDown` it renders wears `accordion_item`,
 * which is the `$border` line between one section and the next, and carries the group's `name`.
 *
 * Children are mounted as they are: an `Accordion` never reads or rewrites another component's
 * props. So a caller passing their own `DropDown`s passes `name` and `theme="accordion_item"` on
 * each of them, and `items` is the shorthand that does it for you.
 *
 * Example:
 *   <Accordion items={[{ label: 'Shipping', content: <Shipping /> },
 *     { label: 'Returns', content: <Returns /> }]} />
 */
export const Accordion = (props: AccordionProps): Mounter => (elem, _item, before, context) => {
	const { name, items, type, element, theme, children, ...rest } = props;

	// The render's counter, which is where every id in this package that has to survive a hydration
	// comes from (design 109).
	const group = name === undefined || name === null ? use(context).ids.next('accordion') : String(name);

	const sections = (items ?? []).map((item) => h(DropDown, {
		name: group,
		label: item.label,
		type,
		theme: 'accordion_item',
	}, item.content ?? null));

	const node = h(elementFor(element, 'div'), {
		...rest,
		theme: ['accordion', theme],
	}, ...sections, ...(children ?? []));

	return mount(elem, node, before, context);
};
