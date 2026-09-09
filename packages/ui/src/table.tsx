// Rows of data in the element the platform has for them (design 201).
//
// The entries are the point and the component is the convenience: an application that writes its own
// `<table theme="table">` with `<tr theme="table_line">` inside it gets the same look and never
// touches this file. What this adds is the common case, where the columns are a list and each cell
// is a function of the row.
//
// The rows go through `each`, so a row pushed onto a cell list inserts one `<tr>` rather than
// rebuilding the table. Every row therefore renders the same node shape, which is the list's rule
// and not this component's (`packages/dom/README.md`).

import { type Mounter, mount } from '@aweftjs/dom';

import { elementFor } from './control.ts';
import { empty } from './field.ts';
import { h } from './h.ts';
import { through } from './source.ts';

/** One column: which value it shows, what it is called, and how it sits. */
export interface TableColumn {
	/** The property of a row this column shows, and the key handed to `cell`. */
	readonly key: string;
	/** The heading. The key itself when it is left off. */
	readonly label?: unknown;
	/** Which way the cells line up: `left` (the default), `right` or `center`. */
	readonly align?: string;
	/** A CSS width for the column, written on its heading. */
	readonly width?: unknown;
}

/** What `Table` takes. Everything not named here goes to the `<table>`. */
export interface TableProps {
	/** The columns, in order: `{ key, label, align, width }` objects, or plain strings. */
	readonly columns?: readonly (TableColumn | string)[];
	/** The rows: an array, a document array, a mutable array, or a cell holding one. */
	readonly rows?: unknown;
	/** What one cell shows. Given the row and its column; `String(row[key])` by default. */
	readonly cell?: (row: unknown, column: TableColumn) => unknown;
	/** A line under the table saying what it is. A value or a cell. */
	readonly caption?: unknown;
	/** A summary row along the bottom. Anything mountable. */
	readonly foot?: unknown;
	/** What the table is, read out by a screen reader when there is no caption. */
	readonly label?: unknown;
	/** Tint every second body row. A value or a cell. */
	readonly striped?: unknown;
	/** Drop a step of padding out of every cell. A value or a cell. */
	readonly tight?: unknown;
	/** The theme variant. */
	readonly type?: unknown;
	/** Decorate this `<table>` instead of building one. */
	readonly element?: unknown;
	/** Extra theme segments, appended to this component's own. */
	readonly theme?: unknown;
	readonly [prop: string]: unknown;
}

/** A column written either way, as the object the rest of the file reads. */
const columnOf = (given: TableColumn | string): TableColumn =>
	(typeof given === 'string' ? { key: given } : given);

/** The alignment segment a column puts on its cells, or nothing for the default. */
const alignOf = (column: TableColumn): string | null =>
	(column.align === 'right' || column.align === 'center' ? column.align : null);

/**
 * A table of rows and columns.
 *
 * Params:
 *   props: `columns`, `rows`, `cell`, `caption`, `foot`, `label`, `striped`, `tight`, `type`,
 *          `element`, and anything else, which goes to the `<table>`
 *
 * Returns: a `<table>` inside a `<div>` on `table_scroll`, so a table wider than its box scrolls
 * in place rather than widening the page. The box is focusable, because one that scrolls and
 * cannot be focused is unreachable from a keyboard.
 *
 * `rows` goes through `each`, so pushing a row inserts one `<tr>` and moves nothing else. A `cell`
 * function that returns a different shape for different rows steps outside what a list can clone;
 * `packages/dom/README.md` says what that costs.
 *
 * Give it a `caption` or a `label`: without one the table has no name for a screen reader.
 *
 * Example:
 *   <Table columns={['name', 'size']} rows={files} caption="Everything in this folder" />
 *   <Table
 *     columns={[{ key: 'name', label: 'Name' }, { key: 'bytes', label: 'Size', align: 'right' }]}
 *     rows={files}
 *     cell={(file, column) => (column.key === 'bytes' ? readable(file.bytes) : file.name)}
 *   />
 */
export const Table = (props: TableProps): Mounter => (elem, _item, before, context) => {
	const {
		columns, rows, cell, caption, foot, label, striped, tight, type, element, theme, ...rest
	} = props;

	const shown = (columns ?? []).map(columnOf);
	const text = cell ?? ((row: unknown, column: TableColumn): unknown =>
		String((row as Record<string, unknown> | null)?.[column.key] ?? ''));
	const dense = through(tight, (held) => (held ? 'tight' : null));
	// A cell holds whatever the application put in it, and a list is only one of the things that
	// can be. Anything else reads as no rows, the way `Breadcrumb` and `ToggleGroup` read theirs,
	// rather than reaching `each` and throwing on the first render.
	const rowsOf = through(rows, (held) => (Array.isArray(held) ? held : []));

	// One component per row, so the list mounts it once per item and clones the rest. The cells are
	// built in column order, which is fixed for the life of the table, so every row is one shape.
	const Row = (item: { each?: unknown }): unknown =>
		h('tr', { theme: ['table_line'] },
			...shown.map((column) => h('td', {
				theme: ['table_cell', alignOf(column), dense],
			}, text(item.each, column))));

	const head = h('thead', { theme: ['table_head'] },
		h('tr', {},
			...shown.map((column) => h('th', {
				scope: 'col',
				theme: ['table_heading', alignOf(column), dense],
				// Only where the column asked for one: a `style` of nothing is still a claimed prop.
				...(column.width === undefined ? {} : { style: { width: column.width } }),
			}, column.label ?? column.key))));

	const table = h(elementFor(element, 'table'), {
		...rest,
		'aria-label': empty(label) ? null : label,
		theme: ['table', type, through(striped, (held) => (held ? 'striped' : null)), theme],
	},
	// The caption is first in the markup because the platform requires it there, and the theme
	// puts it under the table with `caption-side`.
	empty(caption) ? null : h('caption', { theme: ['table_caption'] }, caption),
	head,
	h('tbody', {}, h(Row, { each: rowsOf })),
	foot === undefined || foot === null
		? null
		: h('tfoot', { theme: ['table_foot'] },
			h('tr', { theme: ['table_line'] },
				h('td', { colspan: String(shown.length), theme: ['table_cell', dense] }, foot))));

	return mount(elem, h('div', { theme: ['table_scroll'], tabindex: '0' }, table), before, context);
};
