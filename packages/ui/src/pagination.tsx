// Which page of a long list is showing, and the buttons that move between them (design 201).
//
// A `<nav>` of `Button`s, so the keyboard, the disabled state and the focus ring are the button's
// own and nothing here writes any of them. The one thing this decides is which page numbers are
// worth a button, which is the ellipsis rule below.

import { type Mounter, mount } from '@aweftjs/dom';
import { all } from '@aweftjs/core';

import { Button } from './button.tsx';
import { elementFor } from './control.ts';
import { h } from './h.ts';
import { text } from './text.ts';
import { isWritable } from './source.ts';

/** What `Pagination` takes. Everything not named here goes to the `<nav>`. */
export interface PaginationProps {
	/** The page showing now, a cell, counted from 1. */
	readonly page?: unknown;
	/** How many pages there are. A number or a cell. */
	readonly count?: unknown;
	/** How many pages to show each side of the current one. 1 by default. */
	readonly siblings?: number;
	/** Called with the page number, after the cell has been written. */
	readonly onChange?: (page: number, event: unknown) => void;
	/** How big the buttons are: `sm`, `lg`, or nothing. */
	readonly size?: unknown;
	/** What the nav is called. `Pagination` when it is left off. */
	readonly label?: unknown;
	/** Decorate this node instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/**
 * The pages worth a button, with `null` where a run was left out.
 *
 * The first and the last page are always there, and so are `siblings` pages each side of the
 * current one. `count` 10 with 1 sibling is `1 2 … 10` on page 1, `1 … 4 5 6 … 10` on page 5 and
 * `1 … 9 10` on page 10.
 */
const windowOf = (page: number, count: number, siblings: number): (number | null)[] => {
	if (count <= 1) return count === 1 ? [1] : [];
	const from = Math.max(2, page - siblings);
	const to = Math.min(count - 1, page + siblings);
	const out: (number | null)[] = [1];
	if (from > 2) out.push(null);
	for (let at = from; at <= to; at += 1) out.push(at);
	if (to < count - 1) out.push(null);
	out.push(count);
	return out;
};

/**
 * The pages of a long list, as buttons.
 *
 * Params:
 *   props: `page` (a cell, counted from 1), `count`, `siblings`, `onChange`, `size`, `label`,
 *          `element`, and anything else, which goes to the `<nav>`
 *
 * Returns: a `<nav aria-label>` holding a previous button, the page buttons, and a next button,
 * all `type="quiet"`. The page showing now carries `aria-current="page"` and the `current`
 * segment, which is the filled look. Previous is disabled on page 1 and next on the last page.
 *
 * Pages left out are a `<span aria-hidden="true">` on `pagination_gap`, because an ellipsis is not
 * something to read out.
 *
 * Example:
 *   <Pagination page={page} count={12} onChange={(at) => load(at)} />
 */
export const Pagination = (
	props: PaginationProps,
	cleanup: (...fns: (() => void)[]) => void,
): Mounter =>
	(elem, _item, before, context) => {
		const { page, count, siblings, onChange, size, label, element, theme, ...rest } = props;

		const each = siblings === undefined ? 1 : siblings;
		const go = (next: number, event: unknown): void => {
			if (isWritable(page)) page.set(next);
			onChange?.(next, event);
		};

		// Both are read together, because which buttons there are depends on both and either may be a
		// cell. `all` takes a plain value beside a cell, so a fixed count needs no wrapping.
		const paged = all([page ?? 1, count ?? 1]).map(([held, total]) => {
			const pages = Math.max(0, Math.trunc(Number(total) || 0));
			const asked = Math.trunc(Number(held) || 1);
			// Clamped, because a page past the last one is a dead end: no button carries
			// `aria-current`, Next is off, and the only way back is Previous once per page skipped.
			// `count` shrinking under the page it was on is what a filter does every time.
			return { at: pages < 1 ? 0 : Math.min(Math.max(1, asked), pages), pages };
		});

		// The cell follows the clamp, so what is drawn and what the caller reads back cannot disagree,
		// and `onChange` fires because a caller loading the page it was told about has to hear that it
		// moved. There is no event, so the second argument is null. With no pages at all nothing is
		// written: there is no page to be on.
		cleanup(paged.effect((now) => {
			const { at } = now as { at: number };
			if (at < 1 || !isWritable(page) || Number(page.get()) === at) return;
			page.set(at);
			onChange?.(at, null);
		}));

		const buttons = paged.map(({ at, pages }) => {
			return [
				h(Button, {
					type: 'quiet',
					size,
					label: text('Previous'),
					disabled: at <= 1,
					onClick: (event: unknown) => { go(at - 1, event); },
				}),
				...windowOf(at, pages, each).map((number) => (number === null
					? h('span', { theme: ['pagination_gap'], 'aria-hidden': 'true' }, '…')
					: h(Button, {
						type: 'quiet',
						size,
						theme: number === at ? 'current' : null,
						label: String(number),
						'aria-current': number === at ? 'page' : null,
						onClick: (event: unknown) => { go(number, event); },
					}))),
				h(Button, {
					type: 'quiet',
					size,
					label: text('Next'),
					disabled: at >= pages,
					onClick: (event: unknown) => { go(at + 1, event); },
				}),
			];
		});

		const node = h(elementFor(element, 'nav'), {
			...rest,
			'aria-label': label ?? text('Pagination'),
			theme: ['pagination', theme],
		}, buttons);

		return mount(elem, node, before, context);
	};
